import * as THREE from 'three';
import { HALF, SIZE } from './world';

// Every object in the world goes through planetWarp() in its vertex shader:
// 1. positions wrap around the camera, so whatever is nearest the short way round
//    the planet is drawn there (seamless wrap with no duplicated objects), and
// 2. the ground falls away with distance, so the horizon curves like a small planet.

export const planetUniforms = {
  uWorldSize: { value: SIZE },
  uCurveR: { value: 900 }, // visual radius of curvature (m)
  uDrawR: { value: HALF }, // render distance: things fade into the haze approaching this ground distance
  uFogD: { value: 0.0065 }, // current fog density (mirrors scene.fog)
};

export const GLSL_PLANET = /* glsl */ `
uniform float uWorldSize;
uniform float uCurveR;
vec3 planetWarp(vec3 p){
  vec2 d = p.xz - cameraPosition.xz;
  d -= uWorldSize * floor(d / uWorldSize + 0.5);
  p.xz = cameraPosition.xz + d;
  p.y -= dot(d, d) / (2.0 * uCurveR);
  return p;
}
`;

/** Curvature drop (m) at a horizontal distance, matching the shader. */
export function curveDrop(d: number) {
  return (d * d) / (2 * planetUniforms.uCurveR.value);
}

const WARPED_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 planetWorld = modelMatrix * mvPosition;
planetWorld.xyz = planetWarp(planetWorld.xyz);
float planetFlat = length(planetWorld.xz - cameraPosition.xz);
mvPosition = viewMatrix * planetWorld;
gl_Position = projectionMatrix * mvPosition;
if (planetFlat > uDrawR) gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // beyond render distance: clipped away
`;

/** Patch a built-in material so it wraps and curves with the planet. Safe to call twice. */
export function planetize(mat: THREE.Material) {
  if (mat.userData.planet || mat.userData.noPlanet) return;
  if (mat instanceof THREE.ShaderMaterial) return; // custom shaders handle it themselves
  mat.userData.planet = true;
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uWorldSize = planetUniforms.uWorldSize;
    shader.uniforms.uCurveR = planetUniforms.uCurveR;
    shader.uniforms.uDrawR = planetUniforms.uDrawR;
    shader.uniforms.uFogD = planetUniforms.uFogD;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_PLANET}\nuniform float uDrawR, uFogD;`)
      .replace('#include <project_vertex>', WARPED_PROJECT)
      // Past the render distance, push the fog depth up so objects fade out with the ground.
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\n#ifdef USE_FOG\nvFogDepth = max(vFogDepth, smoothstep(uDrawR*0.8, uDrawR*0.97, planetFlat) * 3.0 / uFogD);\n#endif',
      );
  };
  mat.customProgramCacheKey = () => 'planet|' + prevKey();
  mat.needsUpdate = true;
}

/** Planetize every material under `root` (skipping subtrees marked `userData.noPlanet`).
 *  Objects are also exempt from frustum culling, since their canonical position may be
 *  on the far side of the wrap from where they draw. */
export function planetizeTree(root: THREE.Object3D) {
  if (root.userData.noPlanet) return;
  const mats = (root as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (mats) {
    root.frustumCulled = false;
    for (const m of Array.isArray(mats) ? mats : [mats]) planetize(m);
  }
  for (const c of root.children) planetizeTree(c);
}
