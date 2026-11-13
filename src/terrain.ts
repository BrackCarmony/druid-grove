import * as THREE from 'three';
import { GLSL_PLANET, planetUniforms } from './planet';
import { HALF, SIZE, World } from './world';

// Custom shaders write display (sRGB) values directly, so this fog colour is stored raw.
export const FOG_HEX = 0xe9b7a6;
export const sharedUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.55, 0.42, -0.72).normalize() },
  uFogColor: { value: new THREE.Color().setRGB(0xe9 / 255, 0xb7 / 255, 0xa6 / 255, THREE.LinearSRGBColorSpace) },
  uFogDensity: { value: 0.0065 },
};

export const cursorUniforms = {
  uCursor: { value: new THREE.Vector3(0, 0, 0) }, // x, z, radius
  uCursorState: { value: 0 }, // 0 hidden, 1 ok, 2 blocked
};

// GLSL helpers for the sky (not periodic; the sky doesn't wrap).
export const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
`;

// Periodic noise for the ground: the lattice repeats every `per` cells, so with
// per = SIZE * frequency the pattern lines up perfectly across the planet's wrap.
const GLSL_PNOISE = /* glsl */ `
float phash(vec2 c){
  uvec2 q = uvec2(ivec2(c)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  n ^= n >> 16u; n *= 2246822519u; n ^= n >> 13u;
  return float(n) * (1.0 / 4294967296.0);
}
float pnoise(vec2 p, float per){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  vec2 i0 = mod(i, per); vec2 i1 = mod(i + 1.0, per);
  float a = phash(i0), b = phash(vec2(i1.x, i0.y)), c = phash(vec2(i0.x, i1.y)), d = phash(i1);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float pfbm(vec2 p, float per){ return pnoise(p,per)*0.55 + pnoise(p*2.0,per*2.0)*0.3 + pnoise(p*4.0,per*4.0)*0.15; }
float pcracks(vec2 p, float per){
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(x,y);
    vec2 c = mod(i+g, per);
    vec2 o = vec2(phash(c), phash(c + vec2(9001.0, 17.0)));
    float d = length(g+o-f);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; }
  }
  return d2-d1;
}
`;

/** A grid that's fine near the centre and coarser further out (spacing 1/2/4/8 m), out to ±R. */
function axisCoords(R: number): number[] {
  const out: number[] = [];
  let x = -R;
  while (x < R) {
    out.push(x);
    const a = Math.min(Math.abs(x), Math.abs(x + 1));
    x += a < 64 ? 1 : a < 128 ? 2 : a < 256 ? 4 : 8;
  }
  out.push(R);
  return out;
}

function gridGeometry(R: number) {
  const ax = axisCoords(R);
  const n = ax.length;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      pos[k] = ax[i];
      pos[k + 2] = ax[j];
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], q);
      q += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

export interface Terrain {
  mesh: THREE.Mesh;
  update(camera: THREE.Camera): void;
  /** Draw the ground out to this radius (m); the rim is hazed out. */
  setRadius(r: number): void;
}

export function createTerrain(world: World): Terrain {
  let radius = HALF;
  const geo = gridGeometry(radius);
  const drawR = planetUniforms.uDrawR;

  const gridOffset = { value: new THREE.Vector2() };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      ...cursorUniforms,
      ...planetUniforms,
      uState: { value: world.stateTex },
      uStatic: { value: world.staticTex },
      uHeight: { value: world.heightTex },
      uGridOffset: gridOffset,
      uHalf: { value: HALF },
      uSize: { value: SIZE },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uHeight;
      uniform vec2 uGridOffset;
      uniform float uHalf, uSize;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDist;
      varying float vFlat;
      ${GLSL_PLANET}
      float hAt(vec2 c){ return texelFetch(uHeight, ivec2(mod(c, uSize)), 0).r; }
      float heightAt(vec2 p){
        vec2 f = p + uHalf;
        vec2 i = floor(f);
        vec2 u = f - i;
        return mix(mix(hAt(i), hAt(i + vec2(1,0)), u.x), mix(hAt(i + vec2(0,1)), hAt(i + vec2(1,1)), u.x), u.y);
      }
      void main(){
        vec2 xz = position.xz + uGridOffset;
        float h = heightAt(xz);
        float hx = heightAt(xz + vec2(1,0)) - heightAt(xz - vec2(1,0));
        float hz = heightAt(xz + vec2(0,1)) - heightAt(xz - vec2(0,1));
        vNormal = normalize(vec3(-hx, 2.0, -hz));
        vWorld = vec3(xz.x, h, xz.y);
        vec3 wp = planetWarp(vWorld);
        vDist = length(wp - cameraPosition);
        vFlat = length(xz - cameraPosition.xz);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uState;
      uniform sampler2D uStatic;
      uniform float uHalf, uSize, uTime, uFogDensity, uDrawR;
      uniform vec3 uSunDir, uFogColor;
      uniform vec3 uCursor;
      uniform float uCursorState;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDist;
      varying float vFlat;
      ${GLSL_PNOISE}
      void main(){
        if (vFlat > uDrawR*0.97) discard; // outside the render distance (the grid is square)
        vec2 p = vWorld.xz;
        vec2 uv = (p + uHalf) / uSize;
        vec4 st = texture2D(uState, uv);
        vec4 sc = texture2D(uStatic, uv);
        float S = uSize;

        float n1 = pfbm(p*0.375, S*0.375);
        float n2 = pnoise(p*3.0, S*3.0);

        // --- barren ground ---
        vec3 dirt  = mix(vec3(0.36,0.29,0.24), vec3(0.47,0.38,0.31), n1);
        vec3 clay  = mix(vec3(0.52,0.30,0.21), vec3(0.64,0.40,0.28), n1);
        vec3 stone = mix(vec3(0.40,0.40,0.42), vec3(0.55,0.54,0.55), n1);
        vec3 barren = dirt;
        barren = mix(barren, clay, sc.r);
        barren = mix(barren, stone, sc.g);
        float cr = pcracks(p*2.5, S*2.5);
        if (sc.g > 0.01) cr = mix(cr, pcracks(p*4.0, S*4.0), sc.g);
        float crackLine = (1.0 - smoothstep(0.015, 0.05, cr)) * smoothstep(0.35, 0.6, pfbm(p*0.25+11.0, S*0.25));
        barren *= 1.0 - crackLine*0.3*(1.0-sc.b);
        barren *= 0.9 + n2*0.15;
        // dry creek bed: pale pebbles
        vec3 creekDry = mix(vec3(0.50,0.46,0.41), vec3(0.62,0.58,0.52), step(0.55, pnoise(p*5.0, S*5.0)));
        barren = mix(barren, creekDry, sc.b);

        // --- tended ground ---
        float s = st.r + (n1-0.5)*0.12;
        vec3 tilled = mix(vec3(0.24,0.17,0.12), vec3(0.32,0.23,0.16), n2);
        vec3 grassA = vec3(0.30,0.58,0.22);
        vec3 grassB = vec3(0.52,0.74,0.28);
        vec3 grass = mix(grassA, grassB, pfbm(p*0.625+7.0, S*0.625));
        grass *= 0.85 + pnoise(p*6.0, S*6.0)*0.25;
        // moss tint on stone glades once grown
        grass = mix(grass, vec3(0.38,0.62,0.40), sc.g*0.5);

        float workAmt = smoothstep(0.0, 0.2, s);
        vec3 col = mix(barren, tilled, workAmt*(1.0-sc.b));
        float sprout = smoothstep(0.34, 0.95, s);
        float speck = step(1.0 - sprout, pnoise(p*7.0 + 3.0, S*7.0));
        col = mix(col, grass, clamp(max(speck*0.85, smoothstep(0.75,1.0,s)), 0.0, 1.0) * (1.0-sc.b));

        // water returns to creeks of finished glades
        float wet = st.g;
        vec3 water = mix(vec3(0.18,0.45,0.62), vec3(0.45,0.78,0.88), pnoise(p*1.5 + vec2(uTime*0.6, uTime*0.3), S*1.5));
        col = mix(col, water, wet*sc.b);

        // --- lighting ---
        vec3 N = normalize(vNormal);
        float diff = max(dot(N, uSunDir), 0.0);
        vec3 sun = vec3(1.0,0.86,0.72)*1.05;
        vec3 sky = mix(vec3(0.42,0.36,0.55), vec3(0.75,0.62,0.68), N.y*0.5+0.5);
        vec3 lit = col*(sun*diff + sky*0.55);
        lit += wet*sc.b*pow(pnoise(p*8.0+uTime*2.0, S*8.0),12.0)*0.8;

        // tile cursor (compared the short way round the planet)
        if (uCursorState > 0.5) {
          vec2 d = p - uCursor.xy;
          d -= uSize * floor(d / uSize + 0.5);
          vec2 pc = uCursor.xy + d;
          vec2 cell = floor(pc);
          float inside = all(equal(cell, floor(uCursor.xy))) ? 1.0 : step(length(cell + 0.5 - uCursor.xy), uCursor.z);
          vec2 f = fract(pc);
          float e = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
          float edge = 1.0 - smoothstep(0.03, 0.07, e);
          vec3 hc = uCursorState > 1.5 ? vec3(1.0, 0.45, 0.4) : vec3(1.0, 0.97, 0.75);
          lit = mix(lit, hc, inside * (0.12 + edge * 0.55));
        }

        float fog = 1.0 - exp(-uFogDensity*uFogDensity*vDist*vDist);
        // Haze out the far rim of the drawn disc (only visible from high up).
        fog = max(fog, smoothstep(uDrawR*0.8, uDrawR*0.97, vFlat));
        gl_FragColor = vec4(mix(lit, uFogColor, fog), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.frustumCulled = false;
  mesh.userData.noPlanet = true; // its shader already warps
  return {
    mesh,
    setRadius(r) {
      r = Math.min(HALF, Math.round(r / 8) * 8);
      if (r === radius) return;
      radius = r;
      drawR.value = r;
      mesh.geometry.dispose();
      mesh.geometry = gridGeometry(r);
    },
    update(camera) {
      // Snap to the coarsest grid spacing so vertices don't swim as the camera moves.
      gridOffset.value.set(Math.round(camera.position.x / 8) * 8, Math.round(camera.position.z / 8) * 8);
    },
  };
}
