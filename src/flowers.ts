import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sharedUniforms } from './terrain';
import { HALF } from './world';

// Instanced flowers + grass tufts, split into square chunks so only nearby
// chunks are drawn. Each instance stores its birth time so the grow-in pop and
// the wind sway both run on the GPU.

const CHUNK = 32; // tiles per chunk side
const PER_TILE_FLOWERS = 3;
const DRAW_DIST = 150;

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

interface Layer {
  mesh: THREE.InstancedMesh;
  birth: THREE.InstancedBufferAttribute;
  dirty: [number, number];
}

function makeLayer(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number, colored: boolean): Layer {
  // Each chunk needs its own aBirth buffer, so clone the (shared) geometry shell.
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
  const birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1e9), 1);
  birth.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aBirth', birth);
  const mesh = new THREE.InstancedMesh(g, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colored) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, birth, dirty: [Infinity, 0] };
}

function upload(layer: Layer) {
  const [a, b] = layer.dirty;
  if (b <= 0) return;
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
  layer.dirty = [Infinity, 0];
}

class Chunk {
  group = new THREE.Group();
  heads: Layer;
  stems: Layer;
  tufts: Layer;
  box: THREE.Box3;
  centre: THREE.Vector3;

  constructor(cx: number, cz: number, f: Flowers) {
    const tiles = CHUNK * CHUNK;
    this.heads = makeLayer(f.headGeo, f.headMat, tiles * PER_TILE_FLOWERS, true);
    this.stems = makeLayer(f.stemGeo, f.stemMat, tiles * PER_TILE_FLOWERS, false);
    this.tufts = makeLayer(f.tuftGeo, f.tuftMat, tiles, true);
    this.group.add(this.stems.mesh, this.heads.mesh, this.tufts.mesh);
    const x0 = cx * CHUNK - HALF;
    const z0 = cz * CHUNK - HALF;
    this.box = new THREE.Box3(new THREE.Vector3(x0, -60, z0), new THREE.Vector3(x0 + CHUNK, 60, z0 + CHUNK));
    this.centre = new THREE.Vector3(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
  }
}

export class Flowers {
  group = new THREE.Group();
  headGeo: THREE.BufferGeometry;
  stemGeo: THREE.BufferGeometry;
  tuftGeo: THREE.BufferGeometry;
  headMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  stemMat = new THREE.MeshLambertMaterial({ color: 0x4f8f3a });
  tuftMat = new THREE.MeshLambertMaterial({ color: 0x6aa83f });
  private chunks = new Map<number, Chunk>();
  private dirtyChunks = new Set<Chunk>();
  private total = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();

  constructor() {
    // Flower head: five petals around a gold centre.
    const petals: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const pg = new THREE.SphereGeometry(0.07, 5, 3);
      pg.scale(1, 0.35, 0.6);
      pg.translate(0.075, 0, 0);
      pg.rotateY((k / 5) * Math.PI * 2);
      petals.push(pg.toNonIndexed());
    }
    const centre = new THREE.SphereGeometry(0.04, 5, 3).toNonIndexed();
    centre.scale(1, 0.6, 1);
    const headGeo = mergeGeometries([...petals, centre])!;
    const colors: number[] = [];
    const centreStart = headGeo.attributes.position.count - centre.attributes.position.count;
    for (let v = 0; v < headGeo.attributes.position.count; v++) {
      if (v >= centreStart) colors.push(1.0, 0.75, 0.2);
      else colors.push(1, 1, 1);
    }
    headGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    headGeo.rotateX(-0.25);
    headGeo.translate(0, 0.42, 0);
    this.headGeo = headGeo;

    const stem = new THREE.CylinderGeometry(0.008, 0.014, 0.42, 4, 1).toNonIndexed();
    stem.translate(0, 0.21, 0);
    const leaf = new THREE.SphereGeometry(0.05, 4, 2).toNonIndexed();
    leaf.scale(1.4, 0.15, 0.5);
    leaf.translate(0.06, 0.14, 0);
    this.stemGeo = mergeGeometries([stem, leaf])!;

    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const b = new THREE.ConeGeometry(0.03, 0.3 + (k % 3) * 0.08, 3, 1).toNonIndexed();
      b.translate(0, 0.15, 0);
      b.rotateZ((k - 2) * 0.22);
      b.rotateY(k * 1.3);
      b.translate(Math.cos(k * 2.1) * 0.08, 0, Math.sin(k * 2.1) * 0.08);
      blades.push(b);
    }
    this.tuftGeo = mergeGeometries(blades)!;

    patchSway(this.headMat, 0.25);
    patchSway(this.stemMat, 0.25);
    patchSway(this.tuftMat, 0.35);
  }

  private chunkAt(x: number, z: number): Chunk {
    const cx = Math.floor((x + HALF) / CHUNK);
    const cz = Math.floor((z + HALF) / CHUNK);
    const k = cx * 1000 + cz;
    let ch = this.chunks.get(k);
    if (!ch) {
      ch = new Chunk(cx, cz, this);
      this.chunks.set(k, ch);
      this.group.add(ch.group);
    }
    return ch;
  }

  private place(layer: Layer, x: number, y: number, z: number, scale: number, time: number, color: THREE.Color) {
    const i = layer.mesh.count;
    if (i >= layer.birth.count) return;
    this.q.setFromAxisAngle(this.yAxis, Math.random() * Math.PI * 2);
    this.s.setScalar(scale);
    this.p.set(x, y, z);
    this.m.compose(this.p, this.q, this.s);
    layer.mesh.setMatrixAt(i, this.m);
    if (layer.mesh.instanceColor) layer.mesh.setColorAt(i, color);
    layer.birth.setX(i, time);
    layer.mesh.count = i + 1;
    layer.dirty[0] = Math.min(layer.dirty[0], i);
    layer.dirty[1] = Math.max(layer.dirty[1], i + 1);
  }

  addFlower(x: number, y: number, z: number, color: number, scale: number, time: number) {
    const ch = this.chunkAt(x, z);
    this.c.setHex(color);
    // heads and stems share a slot index and transform
    const i = ch.heads.mesh.count;
    this.place(ch.heads, x, y, z, scale, time, this.c);
    if (ch.heads.mesh.count > i) {
      ch.heads.mesh.getMatrixAt(i, this.m);
      ch.stems.mesh.setMatrixAt(i, this.m);
      ch.stems.birth.setX(i, time);
      ch.stems.mesh.count = i + 1;
      ch.stems.dirty = [Math.min(ch.stems.dirty[0], i), Math.max(ch.stems.dirty[1], i + 1)];
      this.total++;
    }
    this.dirtyChunks.add(ch);
  }

  addTuft(x: number, y: number, z: number, tint: number, time: number) {
    const ch = this.chunkAt(x, z);
    this.place(ch.tufts, x, y, z, 0.8 + Math.random() * 0.6, time, this.c.setScalar(tint));
    this.dirtyChunks.add(ch);
  }

  /** Upload newly added instances and cull far / off-screen chunks. */
  update(camera: THREE.Camera) {
    for (const ch of this.dirtyChunks) {
      upload(ch.heads);
      upload(ch.stems);
      upload(ch.tufts);
    }
    this.dirtyChunks.clear();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const cam = camera.position;
    for (const ch of this.chunks.values()) {
      const d = Math.hypot(ch.centre.x - cam.x, ch.centre.z - cam.z) - CHUNK * 0.7;
      ch.group.visible = d < DRAW_DIST && this.frustum.intersectsBox(ch.box);
    }
  }

  get count() {
    return this.total;
  }
}
