import * as THREE from 'three';
import { SIZE } from './world';

// Every object in the world goes through planetWarp() in its vertex shader:
// 1. positions wrap around the camera, so whatever is nearest the short way round
//    the planet is drawn there (seamless wrap with no duplicated objects), and
// 2. the ground falls away with distance, so the horizon curves like a small planet.

export const planetUniforms = {
  uWorldSize: { value: SIZE },
  uCurveR: { value: 900 }, // visual radius of curvature (m)
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
mvPosition = viewMatrix * planetWorld;
gl_Position = projectionMatrix * mvPosition;
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
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_PLANET}`)
      .replace('#include <project_vertex>', WARPED_PROJECT);
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
