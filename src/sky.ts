import * as THREE from 'three';
import { mulberry32 } from './noise';
import { GLSL_NOISE, sharedUniforms } from './terrain';

// Sky dome: dusky gradient, stars overhead, a low sun, and the shattered moon
// whose debris ring arcs across the sky - the reason the world is broken.

export function createSky(): THREE.Group {
  const group = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { ...sharedUniforms },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uFogColor;
        uniform float uTime;
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
          vec3 top = vec3(0.10,0.08,0.24);
          vec3 mid = vec3(0.45,0.30,0.52);
          vec3 col = mix(uFogColor, mid, smoothstep(0.0, 0.25, h));
          col = mix(col, top, smoothstep(0.2, 0.75, h));
          col = mix(col, uFogColor, smoothstep(0.0,-0.2,h)); // matches the haze at the edge of the drawn world
          float sd = max(dot(d, uSunDir), 0.0);
          col += vec3(1.0,0.62,0.38) * pow(sd, 8.0) * 0.55;
          col += vec3(1.0,0.9,0.7) * smoothstep(0.9985, 0.9993, sd);
          // stars: round points in 3D cells over the sphere, so they're even all the way up
          float st = stars(d, 70.0, 0.965, 0.22) + stars(d, 32.0, 0.94, 0.16) * 1.4;
          col += st * smoothstep(0.15, 0.6, h) * 0.9;
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
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xd9c9e6, fog: false });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x9a86b0, fog: false });
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(60, 2), moonMat);
  const posAttr = moon.geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i);
    // carve a bite out of one side
    if (v.x > 25 && v.y > -10) v.multiplyScalar(0.72);
    else v.multiplyScalar(0.94 + rng() * 0.08);
    posAttr.setXYZ(i, v.x, v.y, v.z);
  }
  moon.geometry.computeVertexNormals();
  moonGroup.add(moon);
  for (let i = 0; i < 40; i++) {
    const r = 3 + rng() * 12;
    const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rng() > 0.5 ? moonMat : darkMat);
    const t = rng();
    chunk.position.set(60 + t * 260, -10 + (rng() - 0.3) * 60 * (0.3 + t), (rng() - 0.5) * 90);
    chunk.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    moonGroup.add(chunk);
  }
  moonGroup.position.set(260, 330, -620);
  moonGroup.rotation.z = -0.35;
  moonGroup.lookAt(0, 0, 0);
  moonGroup.rotateY(Math.PI / 2);
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

  return group;
}
