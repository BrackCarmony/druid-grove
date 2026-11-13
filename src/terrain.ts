import * as THREE from 'three';
import { fbm } from './noise';
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

// GLSL helpers shared by terrain + creatures.
export const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm3(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.1)*0.3 + vnoise(p*4.3)*0.15; }
// cellular cracks: distance to nearest cell edge
float cracks(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(x,y);
    vec2 o = vec2(hash21(i+g), hash21(i+g+17.0));
    float d = length(g+o-f);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; }
  }
  return d2-d1;
}
`;

export function createTerrain(world: World): THREE.Group {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SIZE, SIZE);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let v = 0; v < pos.count; v++) pos.setY(v, world.heights[v]);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      ...cursorUniforms,
      uState: { value: world.stateTex },
      uStatic: { value: world.staticTex },
      uHalf: { value: HALF },
      uSize: { value: SIZE },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uState;
      uniform sampler2D uStatic;
      uniform float uHalf, uSize, uTime, uFogDensity, uOuter;
      uniform vec3 uSunDir, uFogColor;
      uniform vec3 uCursor;
      uniform float uCursorState;
      varying vec3 vWorld;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec2 uv = (vWorld.xz + uHalf) / uSize;
        vec4 st = texture2D(uState, uv);
        vec4 sc = texture2D(uStatic, uv);
        if (uOuter > 0.5) {
          // Endless wasteland beyond the playable land.
          st = vec4(0.0);
          sc = vec4(0.0, smoothstep(0.4, 0.7, fbm3(vWorld.xz*0.004)), 0.0, 0.0);
        }
        vec2 p = vWorld.xz;

        float n1 = fbm3(p*0.35);
        float n2 = vnoise(p*3.0);

        // --- barren ground ---
        vec3 dirt  = mix(vec3(0.36,0.29,0.24), vec3(0.47,0.38,0.31), n1);
        vec3 clay  = mix(vec3(0.52,0.30,0.21), vec3(0.64,0.40,0.28), n1);
        vec3 stone = mix(vec3(0.40,0.40,0.42), vec3(0.55,0.54,0.55), n1);
        vec3 barren = dirt;
        barren = mix(barren, clay, sc.r);
        barren = mix(barren, stone, sc.g);
        float cr = cracks(p*(2.6 + sc.g*1.4));
        float crackLine = (1.0 - smoothstep(0.015, 0.05, cr)) * smoothstep(0.35, 0.6, fbm3(p*0.25+11.0));
        barren *= 1.0 - crackLine*0.3*(1.0-sc.b);
        barren *= 0.9 + n2*0.15;
        // dry creek bed: pale pebbles
        vec3 creekDry = mix(vec3(0.50,0.46,0.41), vec3(0.62,0.58,0.52), step(0.55, vnoise(p*5.0)));
        barren = mix(barren, creekDry, sc.b);

        // --- tended ground ---
        float s = st.r + (n1-0.5)*0.12;
        vec3 tilled = mix(vec3(0.24,0.17,0.12), vec3(0.32,0.23,0.16), n2);
        vec3 grassA = vec3(0.30,0.58,0.22);
        vec3 grassB = vec3(0.52,0.74,0.28);
        vec3 grass = mix(grassA, grassB, fbm3(p*0.6+7.0));
        grass *= 0.85 + vnoise(p*6.0)*0.25;
        // moss tint on stone glades once grown
        grass = mix(grass, vec3(0.38,0.62,0.40), sc.g*0.5);

        float workAmt = smoothstep(0.0, 0.2, s);
        vec3 col = mix(barren, tilled, workAmt*(1.0-sc.b));
        float sprout = smoothstep(0.34, 0.95, s);
        float speck = step(1.0 - sprout, vnoise(p*7.0 + 3.0));
        col = mix(col, grass, clamp(max(speck*0.85, smoothstep(0.75,1.0,s)), 0.0, 1.0) * (1.0-sc.b));

        // water returns to creeks of finished glades
        float wet = st.g;
        vec3 water = mix(vec3(0.18,0.45,0.62), vec3(0.45,0.78,0.88), vnoise(p*1.5 + vec2(uTime*0.6, uTime*0.3)));
        col = mix(col, water, wet*sc.b);

        // --- lighting ---
        vec3 N = normalize(vNormal);
        float diff = max(dot(N, uSunDir), 0.0);
        vec3 sun = vec3(1.0,0.86,0.72)*1.05;
        vec3 sky = mix(vec3(0.42,0.36,0.55), vec3(0.75,0.62,0.68), N.y*0.5+0.5);
        vec3 lit = col*(sun*diff + sky*0.55);
        // water sparkle
        lit += wet*sc.b*pow(vnoise(p*8.0+uTime*2.0),12.0)*0.8;

        // tile cursor
        if (uCursorState > 0.5) {
          vec2 cell = floor(p);
          float inside = all(equal(cell, floor(uCursor.xy))) ? 1.0 : step(length(cell + 0.5 - uCursor.xy), uCursor.z);
          vec2 f = fract(p);
          float e = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
          float edge = 1.0 - smoothstep(0.03, 0.07, e);
          vec3 hc = uCursorState > 1.5 ? vec3(1.0, 0.45, 0.4) : vec3(1.0, 0.97, 0.75);
          lit = mix(lit, hc, inside * (0.12 + edge * 0.55));
        }

        float dist = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);
        gl_FragColor = vec4(mix(lit, uFogColor, fog), 1.0);
      }
    `,
  });

  mat.uniforms.uOuter = { value: 0 };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';

  // Outer wasteland ring rising into distant hills, so the world doesn't end in a cliff.
  const OUT = 1600;
  const seg = 200;
  const og = new THREE.PlaneGeometry(OUT, OUT, seg, seg);
  og.rotateX(-Math.PI / 2);
  const op = og.attributes.position as THREE.BufferAttribute;
  for (let v = 0; v < op.count; v++) {
    const x = op.getX(v);
    const z = op.getZ(v);
    const edge = Math.max(Math.abs(x), Math.abs(z)) - HALF;
    const cx = THREE.MathUtils.clamp(x, -HALF, HALF);
    const cz = THREE.MathUtils.clamp(z, -HALF, HALF);
    let h: number;
    if (edge < 0) h = world.heightAt(x, z) - 4;
    else {
      const base = world.heightAt(cx, cz);
      const k = Math.min(1, edge / 60);
      const hills = (fbm(x * 0.006, z * 0.006, 4, 3) - 0.35) * 160 * Math.pow(Math.min(1, edge / 500), 1.3);
      h = base * (1 - k) + (fbm(x * 0.03, z * 0.03, 3, 8) - 0.5) * 12 * k + Math.max(0, hills);
    }
    op.setY(v, h);
  }
  og.computeVertexNormals();
  const omat = mat.clone();
  omat.uniforms = { ...mat.uniforms, uOuter: { value: 1 } };
  const outer = new THREE.Mesh(og, omat);

  const group = new THREE.Group();
  group.add(mesh, outer);
  return group;
}
