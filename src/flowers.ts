import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sharedUniforms } from './terrain';

// Instanced flowers + grass tufts. Each instance stores its birth time so the
// grow-in pop and the wind sway both happen on the GPU.

function patchSway(mat: THREE.Material, swayAmt: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         attribute float aBirth;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float age = clamp((uTime - aBirth) / 0.9, 0.0, 1.0);
         float grow = (1.0 - pow(1.0 - age, 3.0)) * (1.0 + 0.3 * sin(age * 3.14159));
         transformed *= grow;
         vec3 ip = instanceMatrix[3].xyz;
         float w = sin(uTime * 1.6 + ip.x * 0.45 + ip.z * 0.3) + 0.5 * sin(uTime * 2.7 + ip.x * 1.3);
         transformed.x += w * ${swayAmt.toFixed(3)} * position.y * position.y;
         transformed.z += w * ${(swayAmt * 0.5).toFixed(3)} * position.y * position.y;`,
      );
  };
}

function makeLayer(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number) {
  const birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1e9), 1);
  birth.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aBirth', birth);
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, birth };
}

function upload(layer: { mesh: THREE.InstancedMesh; birth: THREE.InstancedBufferAttribute }, a: number, b: number) {
  const n = b - a;
  layer.mesh.instanceMatrix.clearUpdateRanges();
  layer.mesh.instanceMatrix.addUpdateRange(a * 16, n * 16);
  layer.mesh.instanceMatrix.needsUpdate = true;
  layer.birth.clearUpdateRanges();
  layer.birth.addUpdateRange(a, n);
  layer.birth.needsUpdate = true;
  const ic = layer.mesh.instanceColor;
  if (ic) {
    ic.clearUpdateRanges();
    ic.addUpdateRange(a * 3, n * 3);
    ic.needsUpdate = true;
  }
}

export class Flowers {
  group = new THREE.Group();
  private heads;
  private stems;
  private tufts;
  private capacity: number;
  private tuftCount = 0;
  private flowerCount = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private flowerDirty: [number, number] = [Infinity, 0];
  private tuftDirty: [number, number] = [Infinity, 0];

  constructor(capacity: number) {
    this.capacity = capacity;

    // Flower head: five petals around a gold centre.
    const petals: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const pg = new THREE.SphereGeometry(0.07, 5, 3);
      pg.scale(1, 0.35, 0.6);
      pg.translate(0.075, 0, 0);
      pg.rotateY((k / 5) * Math.PI * 2);
      petals.push(pg);
    }
    const centre = new THREE.SphereGeometry(0.04, 5, 3);
    centre.scale(1, 0.6, 1);
    const headGeo = mergeGeometries([...petals.map((g) => g.toNonIndexed()), centre.toNonIndexed()])!;
    // Gold centre via vertex colour; petals white so instanceColor tints only them.
    const colors: number[] = [];
    const centreStart = headGeo.attributes.position.count - centre.toNonIndexed().attributes.position.count;
    for (let v = 0; v < headGeo.attributes.position.count; v++) {
      if (v >= centreStart) colors.push(1.0, 0.75, 0.2);
      else colors.push(1, 1, 1);
    }
    headGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    headGeo.rotateX(-0.25);
    headGeo.translate(0, 0.42, 0);

    const stemGeo = new THREE.CylinderGeometry(0.008, 0.014, 0.42, 4, 1);
    stemGeo.translate(0, 0.21, 0);
    const leaf = new THREE.SphereGeometry(0.05, 4, 2);
    leaf.scale(1.4, 0.15, 0.5);
    leaf.translate(0.06, 0.14, 0);
    const stemFull = mergeGeometries([stemGeo.toNonIndexed(), leaf.toNonIndexed()])!;

    // Grass tuft: a few tapered blades.
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const b = new THREE.ConeGeometry(0.03, 0.3 + (k % 3) * 0.08, 3, 1);
      b.translate(0, 0.15, 0);
      b.rotateZ((k - 2) * 0.22);
      b.rotateY(k * 1.3);
      b.translate(Math.cos(k * 2.1) * 0.08, 0, Math.sin(k * 2.1) * 0.08);
      blades.push(b.toNonIndexed());
    }
    const tuftGeo = mergeGeometries(blades)!;

    const headMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x4f8f3a });
    const tuftMat = new THREE.MeshLambertMaterial({ color: 0x6aa83f });
    patchSway(headMat, 0.25);
    patchSway(stemMat, 0.25);
    patchSway(tuftMat, 0.35);

    this.heads = makeLayer(headGeo, headMat, capacity);
    this.stems = makeLayer(stemFull, stemMat, capacity);
    this.tufts = makeLayer(tuftGeo, tuftMat, capacity);
    this.heads.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.tufts.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.group.add(this.stems.mesh, this.heads.mesh, this.tufts.mesh);
  }

  addFlower(x: number, y: number, z: number, color: number, scale: number, time: number) {
    if (this.flowerCount >= this.capacity) return;
    const i = this.flowerCount++;
    this.q.setFromAxisAngle(this.yAxis, Math.random() * Math.PI * 2);
    this.s.setScalar(scale);
    this.p.set(x, y, z);
    this.m.compose(this.p, this.q, this.s);
    this.heads.mesh.setMatrixAt(i, this.m);
    this.stems.mesh.setMatrixAt(i, this.m);
    this.heads.mesh.setColorAt(i, this.c.setHex(color));
    this.heads.birth.setX(i, time);
    this.stems.birth.setX(i, time);
    this.heads.mesh.count = this.stems.mesh.count = this.flowerCount;
    this.flowerDirty[0] = Math.min(this.flowerDirty[0], i);
    this.flowerDirty[1] = Math.max(this.flowerDirty[1], i + 1);
  }

  addTuft(x: number, y: number, z: number, tint: number, time: number) {
    if (this.tuftCount >= this.capacity) return;
    const i = this.tuftCount++;
    this.q.setFromAxisAngle(this.yAxis, Math.random() * Math.PI * 2);
    this.s.setScalar(0.8 + Math.random() * 0.6);
    this.p.set(x, y, z);
    this.m.compose(this.p, this.q, this.s);
    this.tufts.mesh.setMatrixAt(i, this.m);
    this.tufts.mesh.setColorAt(i, this.c.setScalar(tint));
    this.tufts.birth.setX(i, time);
    this.tufts.mesh.count = this.tuftCount;
    this.tuftDirty[0] = Math.min(this.tuftDirty[0], i);
    this.tuftDirty[1] = Math.max(this.tuftDirty[1], i + 1);
  }

  // Upload only the contiguous range of instances added since the last frame.
  flush() {
    if (this.flowerDirty[1] > 0) {
      const [a, b] = this.flowerDirty;
      upload(this.heads, a, b);
      upload(this.stems, a, b);
      this.flowerDirty = [Infinity, 0];
    }
    if (this.tuftDirty[1] > 0) {
      const [a, b] = this.tuftDirty;
      upload(this.tufts, a, b);
      this.tuftDirty = [Infinity, 0];
    }
  }

  get count() {
    return this.flowerCount;
  }
}
