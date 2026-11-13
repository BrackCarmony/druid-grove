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
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 top = vec3(0.10,0.08,0.24);
          vec3 mid = vec3(0.45,0.30,0.52);
          vec3 col = mix(uFogColor, mid, smoothstep(0.0, 0.25, h));
          col = mix(col, top, smoothstep(0.2, 0.75, h));
          col = mix(col, uFogColor*0.8, smoothstep(0.0,-0.2,h));
          float sd = max(dot(d, uSunDir), 0.0);
          col += vec3(1.0,0.62,0.38) * pow(sd, 8.0) * 0.55;
          col += vec3(1.0,0.9,0.7) * smoothstep(0.9985, 0.9993, sd);
          // stars
          vec2 sp = vec2(atan(d.z, d.x)*90.0, h*150.0);
          float star = step(0.985, hash21(floor(sp)));
          float tw = 0.6 + 0.4*sin(uTime*2.0 + hash21(floor(sp)+3.0)*30.0);
          col += star * tw * smoothstep(0.15, 0.6, h) * 0.9;
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
