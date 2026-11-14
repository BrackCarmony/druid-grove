import * as THREE from 'three';
import { mulberry32 } from './noise';
import { GLSL_NOISE, lightUniforms, sharedUniforms } from './terrain';

const MOON_POS = new THREE.Vector3(260, 330, -620);
/** Direction to the broken moon (it hangs in the same place all day and night). */
export const MOON_DIR = MOON_POS.clone().normalize();

// Sky dome: dusky gradient, stars overhead, a low sun, and the shattered moon
// whose debris ring arcs across the sky - the reason the world is broken.

let moonState: { set(t: number, flash: number): void } | null = null;

/** Mend the moon: 0 shattered, 1 whole (pieces flown home, bite filled, glowing). flash adds a burst of light. */
export function restoreMoon(t: number, flash = 0) {
  moonState?.set(t, flash);
}

export function createSky(): THREE.Group {
  const group = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { ...sharedUniforms, ...lightUniforms },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uFogColor, uSkyTop, uSkyMid, uSunGlow;
        uniform float uTime, uStars;
        varying vec3 vDir;
        ${GLSL_NOISE}
        float hash31(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.x+p.y)*p.z); }
        // One star per lucky cell, at a jittered spot near the cell's middle; radius in cell units.
        float stars(vec3 d, float n, float keep, float radius){
          vec3 g = d * n;
          vec3 c = floor(g);
          float h = hash31(c);
          if (h < keep) return 0.0;
          vec3 o = 0.3 + 0.4*vec3(hash31(c+1.7), hash31(c+5.3), hash31(c+9.1));
          float dist = length(g - c - o);
          float r = radius * (0.6 + 0.8*hash31(c+2.9));
          float tw = 0.6 + 0.4*sin(uTime*(1.5 + 2.0*hash31(c+4.4)) + h*60.0);
          return smoothstep(r, r*0.3, dist) * tw;
        }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uFogColor, uSkyMid, smoothstep(0.0, 0.25, h));
          col = mix(col, uSkyTop, smoothstep(0.2, 0.75, h));
          col = mix(col, uFogColor, smoothstep(0.0,-0.2,h)); // matches the haze at the edge of the drawn world
          float sd = max(dot(d, uSunDir), 0.0);
          float sunVis = smoothstep(-0.08, 0.02, uSunDir.y); // gone once it has set
          col += uSunGlow * pow(sd, 8.0) * 0.55 * sunVis;
          col += vec3(1.0,0.9,0.7) * smoothstep(0.9985, 0.9993, sd) * sunVis;
          // stars: round points in 3D cells over the sphere, so they're even all the way up
          float st = stars(d, 70.0, 0.965, 0.22) + stars(d, 32.0, 0.94, 0.16) * 1.4;
          col += st * smoothstep(0.15, 0.6, h) * 0.9 * uStars;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  group.add(dome);

  // Shattered moon: a cratered body with a wedge of chunks drifting away.
  const rng = mulberry32(42);
  const moonGroup = new THREE.Group();
  // Unlit (it shows by night as well as day), so it's shaded by hand: vertex colours darken
  // toward one limb and pick out a few grey "seas". By day it fades to a pale, see-through
  // daytime moon; only at night does it show at full strength.
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xc9bdd6, fog: false, transparent: true });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x8a789e, fog: false, transparent: true });
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xc9bdd6, fog: false, transparent: true, vertexColors: true });
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(60, 2), bodyMat);
  const posAttr = moon.geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const whole = new Float32Array(posAttr.count * 3); // the moon as it was, for restoring it
  const broken = new Float32Array(posAttr.count * 3);
  // Same bumpiness for every copy of a corner (the icosahedron repeats them per face).
  const bump = (p: THREE.Vector3) => 0.94 + 0.08 * (0.5 + 0.5 * Math.sin(p.x * 0.37 + p.y * 0.61 + p.z * 0.83));
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i);
    v.multiplyScalar(bump(v));
    v.toArray(whole, i * 3);
    // carve a bite out of one side
    if (v.x > 25 && v.y > -10) v.multiplyScalar(0.72);
    v.toArray(broken, i * 3);
    posAttr.setXYZ(i, v.x, v.y, v.z);
  }
  moon.geometry.computeVertexNormals();
  {
    // Light from the viewer's upper left (local +z faces the planet), and dark seas.
    const light = new THREE.Vector3(-0.45, 0.35, 1).normalize();
    const cols = new Float32Array(posAttr.count * 3);
    const n = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      n.fromArray(whole, i * 3).normalize();
      const lit = 0.42 + 0.58 * THREE.MathUtils.smoothstep(n.dot(light), -0.35, 0.75);
      const sea =
        Math.sin(n.x * 4.1 + 1.3) * Math.sin(n.y * 3.7 + 0.4) * Math.sin(n.z * 3.3 + 2.1) +
        0.5 * Math.sin(n.x * 9.3 + n.y * 7.1 + 0.7);
      const k = lit * (sea > 0.25 ? 0.72 : 1);
      cols.set([k, k, k], i * 3);
    }
    moon.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  moonGroup.add(moon);
  const chunks: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; spin: THREE.Euler; delay: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const r = 3 + rng() * 12;
    const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rng() > 0.5 ? moonMat : darkMat);
    const t = rng();
    chunk.position.set(60 + t * 260, -10 + (rng() - 0.3) * 60 * (0.3 + t), (rng() - 0.5) * 90);
    chunk.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    moonGroup.add(chunk);
    // Where it flies home to: somewhere in the bite.
    const to = new THREE.Vector3(1, 0.15 + rng() * 0.7, (rng() - 0.5) * 1.2).normalize().multiplyScalar(48);
    chunks.push({
      mesh: chunk,
      from: chunk.position.clone(),
      to,
      spin: chunk.rotation.clone(),
      delay: t * 0.35, // the nearest pieces go first
    });
  }
  // A soft halo that grows as the moon is made whole.
  const haloTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTex,
      color: 0xe8f4ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.scale.setScalar(240);
  moonGroup.add(halo);
  moonGroup.position.copy(MOON_POS);
  moonGroup.rotation.z = -0.35;
  moonGroup.lookAt(0, 0, 0);
  // Turned so the bite and the trail of broken pieces show from the ground, side-on.
  moonGroup.rotateY(-0.45);
  moonGroup.rotateZ(0.35);
  group.add(moonGroup);

  // Debris ring arcing across the sky.
  const ringCount = 5000;
  const ringPos = new Float32Array(ringCount * 3);
  for (let i = 0; i < ringCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = 700 + (rng() - 0.5) * 70 * (1 + rng());
    ringPos[i * 3] = Math.cos(a) * r;
    ringPos[i * 3 + 1] = (rng() - 0.5) * 12;
    ringPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  const ring = new THREE.Points(
    ringGeo,
    new THREE.PointsMaterial({
      color: 0xf3e3ff,
      size: 2.2,
      sizeAttenuation: true,
      fog: false,
      transparent: true,
      opacity: 0.75,
    }),
  );
  ring.rotation.set(0.42, 0, 0.28);
  ring.position.y = 120;
  group.add(ring);

  const brokenCol = bodyMat.color.clone();
  const wholeCol = new THREE.Color(0xdcd6e2); // mended: a touch brighter and greyer, not white
  let mended = 0;
  let flashNow = 0;
  // Each frame: pale by day, full by night; the halo only shows in the dark.
  moon.onBeforeRender = () => {
    const sunY = sharedUniforms.uSunDir.value.y;
    const day = THREE.MathUtils.smoothstep(sunY, -0.1, 0.25);
    const o = 1 - 0.6 * day;
    bodyMat.opacity = moonMat.opacity = darkMat.opacity = o;
    halo.material.opacity = 0.16 * mended * (1 - day) + flashNow;
  };
  const ease = (x: number) => x * x * (3 - 2 * x);
  moonState = {
    set(t: number, flash: number) {
      // Pieces fly home over the first 80%, shrinking into the surface as they arrive.
      for (const c of chunks) {
        const k = ease(THREE.MathUtils.clamp((t - c.delay) / 0.45, 0, 1));
        c.mesh.position.lerpVectors(c.from, c.to, k);
        c.mesh.rotation.set(c.spin.x + k * 4, c.spin.y + k * 3, c.spin.z);
        c.mesh.scale.setScalar(1 - THREE.MathUtils.smoothstep(k, 0.85, 1));
        c.mesh.visible = k < 1;
      }
      // The bite fills in as they land.
      const f = ease(THREE.MathUtils.clamp((t - 0.35) / 0.5, 0, 1));
      for (let i = 0; i < posAttr.count * 3; i++) posAttr.array[i] = broken[i] + (whole[i] - broken[i]) * f;
      posAttr.needsUpdate = true;
      moon.geometry.computeVertexNormals();
      bodyMat.color.lerpColors(brokenCol, wholeCol, f);
      mended = f;
      flashNow = flash;
      halo.scale.setScalar(170 + flash * 450);
      (ring.material as THREE.PointsMaterial).opacity = 0.75 - 0.55 * f;
    },
  };

  return group;
}
