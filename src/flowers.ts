import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise';
import { planetize } from './planet';
import { sharedUniforms } from './terrain';
import { HALF, SIZE, Soil, World, wrap } from './world';

// Flowers and grass tufts, streamed in square chunks around the camera. A tile's
// flora is a pure function of the tile (seeded by its index), so chunks are rebuilt
// from the world's bloom state whenever they come into range and thrown away when
// they leave: a whole planet of flowers never has to sit in memory at once.

const CHUNK = 32; // tiles per chunk side
const NCH = SIZE / CHUNK;
const LOAD_DIST = 185;
const UNLOAD_DIST = 240;
const DRAW_DIST = 150;
const LOD_DIST = 60; // detailed flowers inside this, simple ones beyond
const TUFT_DIST = 85;
const BUILDS_PER_FRAME = 3;

function patchFlora(mat: THREE.Material, swayAmt: number, stemColor: THREE.Color | null) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         attribute float aBirth;
         ${stemColor ? 'attribute float aStem;' : ''}`,
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
    if (stemColor) {
      // Stems keep their own green instead of taking the flower's colour.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
         vColor.rgb = mix(vColor.rgb, color.rgb, aStem);`,
      );
    }
  };
  mat.customProgramCacheKey = () => `flora-${swayAmt}-${!!stemColor}`;
  planetize(mat);
}

/** Stem + leaf + head in one geometry; `aStem` marks the stem vertices. */
function flowerGeometry(detail: boolean) {
  const stemCol = new THREE.Color(0x4f8f3a);
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, rgb: [number, number, number], stem: number) => {
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(rgb, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aStem', new THREE.BufferAttribute(new Float32Array(n).fill(stem), 1));
    parts.push(g);
  };
  const green: [number, number, number] = [stemCol.r, stemCol.g, stemCol.b];
  if (detail) {
    const stem = new THREE.CylinderGeometry(0.008, 0.014, 0.42, 4, 1);
    stem.translate(0, 0.21, 0);
    tag(stem, green, 1);
    const leaf = new THREE.SphereGeometry(0.05, 4, 2);
    leaf.scale(1.4, 0.15, 0.5);
    leaf.translate(0.06, 0.14, 0);
    tag(leaf, green, 1);
    for (let k = 0; k < 5; k++) {
      const pg = new THREE.SphereGeometry(0.07, 5, 3);
      pg.scale(1, 0.35, 0.6);
      pg.translate(0.075, 0, 0);
      pg.rotateY((k / 5) * Math.PI * 2);
      pg.rotateX(-0.25);
      pg.translate(0, 0.42, 0);
      tag(pg, [1, 1, 1], 0);
    }
    const centre = new THREE.SphereGeometry(0.04, 5, 3);
    centre.scale(1, 0.6, 1);
    centre.rotateX(-0.25);
    centre.translate(0, 0.42, 0);
    tag(centre, [1.0, 0.75, 0.2], 0);
  } else {
    const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.42, 3, 1);
    stem.translate(0, 0.21, 0);
    tag(stem, green, 1);
    const head = new THREE.IcosahedronGeometry(0.12, 0);
    head.scale(1, 0.35, 1);
    head.translate(0, 0.42, 0);
    tag(head, [1, 1, 1], 0);
  }
  return mergeGeometries(parts)!;
}

function tuftGeometry() {
  const blades: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const b = new THREE.ConeGeometry(0.03, 0.3 + (k % 3) * 0.08, 3, 1).toNonIndexed();
    b.translate(0, 0.15, 0);
    b.rotateZ((k - 2) * 0.22);
    b.rotateY(k * 1.3);
    b.translate(Math.cos(k * 2.1) * 0.08, 0, Math.sin(k * 2.1) * 0.08);
    blades.push(b);
  }
  return mergeGeometries(blades)!;
}

/** One instance buffer drawn by a detailed and a simple mesh (only one is shown at a time). */
class Layer {
  hi: THREE.InstancedMesh;
  lo: THREE.InstancedMesh | null;
  birth: THREE.InstancedBufferAttribute;
  count = 0;
  private dirty: [number, number] = [Infinity, 0];

  constructor(
    hiGeo: THREE.BufferGeometry,
    loGeo: THREE.BufferGeometry | null,
    mat: THREE.Material,
    readonly capacity: number,
  ) {
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(-100), 1);
    this.hi = this.mesh(hiGeo, mat);
    this.hi.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.lo = loGeo ? this.mesh(loGeo, mat) : null;
    if (this.lo) {
      this.lo.instanceMatrix = this.hi.instanceMatrix;
      this.lo.instanceColor = this.hi.instanceColor;
    }
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
    // Each chunk needs its own instance buffers, so wrap the shared geometry in a fresh shell.
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setAttribute('aBirth', this.birth);
    const m = new THREE.InstancedMesh(g, mat, this.capacity);
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }

  get full() {
    return this.count >= this.capacity;
  }

  add(matrix: THREE.Matrix4, color: THREE.Color, birth: number) {
    const i = this.count++;
    this.hi.setMatrixAt(i, matrix);
    this.hi.setColorAt(i, color);
    this.birth.setX(i, birth);
    this.hi.count = this.count;
    if (this.lo) this.lo.count = this.count;
    this.dirty[0] = Math.min(this.dirty[0], i);
    this.dirty[1] = Math.max(this.dirty[1], i + 1);
  }

  upload() {
    const [a, b] = this.dirty;
    if (b <= 0) return;
    const n = b - a;
    const im = this.hi.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(a * 16, n * 16);
    im.needsUpdate = true;
    this.birth.clearUpdateRanges();
    this.birth.addUpdateRange(a, n);
    this.birth.needsUpdate = true;
    const ic = this.hi.instanceColor!;
    ic.clearUpdateRanges();
    ic.addUpdateRange(a * 3, n * 3);
    ic.needsUpdate = true;
    this.dirty = [Infinity, 0];
  }

  setDetail(detail: boolean, visible: boolean) {
    this.hi.visible = visible && (detail || !this.lo);
    if (this.lo) this.lo.visible = visible && !detail;
  }

  dispose() {
    this.hi.geometry.dispose();
    this.lo?.geometry.dispose();
    this.hi.dispose();
    this.lo?.dispose();
  }
}

class Chunk {
  group = new THREE.Group();
  flowers!: Layer;
  tufts!: Layer;
  cx: number;
  cz: number;
  // centre in canonical coordinates
  x: number;
  z: number;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.x = cx * CHUNK - HALF + CHUNK / 2;
    this.z = cz * CHUNK - HALF + CHUNK / 2;
  }
}

export class Flowers {
  group = new THREE.Group();
  private hiGeo = flowerGeometry(true);
  private loGeo = flowerGeometry(false);
  private tuftGeo = tuftGeometry();
  private flowerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private tuftMat = new THREE.MeshLambertMaterial({ color: 0x6aa83f });
  private chunks = new Map<number, Chunk>();
  private dirty = new Set<Chunk>();
  /** Bloom times of tiles that are still mid grow-in, so a rebuilt chunk doesn't skip the animation. */
  private recent = new Map<number, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  private box = new THREE.Box3();

  constructor(private world: World) {
    patchFlora(this.flowerMat, 0.25, new THREE.Color(0x4f8f3a));
    patchFlora(this.tuftMat, 0.35, null);
  }

  /** A tile just bloomed: add its flora if its chunk is loaded. */
  bloomTile(t: number, time: number) {
    this.recent.set(t, time);
    const [x, z] = this.world.tileCenter(t);
    const key = Math.floor((x + HALF) / CHUNK) * NCH + Math.floor((z + HALF) / CHUNK);
    const ch = this.chunks.get(key);
    if (!ch) return;
    if (ch.flowers.capacity - ch.flowers.count < 3 || ch.tufts.full) {
      this.rebuild(ch); // out of room: rebuild bigger (includes this tile)
      return;
    }
    this.addTile(ch, t, time);
    this.dirty.add(ch);
  }

  private addTile(ch: Chunk, t: number, birth: number) {
    const w = this.world;
    const g = w.glades[w.gladeOf[t]];
    const [cx, cz] = w.tileCenter(t);
    const rng = mulberry32(t * 7919 + 13);
    const n = 1 + Math.floor(rng() * 3);
    const small = g.soil === Soil.Stone ? 0.75 : 1;
    for (let k = 0; k < n; k++) {
      const x = cx + (rng() - 0.5) * 0.9;
      const z = cz + (rng() - 0.5) * 0.9;
      const col = g.palette[Math.floor(rng() * g.palette.length)];
      this.compose(x, z, (0.75 + rng() * 0.55) * small, rng());
      ch.flowers.add(this.m, this.c.setHex(col), birth + k * 0.12);
    }
    const tx = cx + (rng() - 0.5) * 0.7;
    const tz = cz + (rng() - 0.5) * 0.7;
    this.compose(tx, tz, 0.8 + rng() * 0.6, rng());
    ch.tufts.add(this.m, this.c.setScalar(0.8 + rng() * 0.35), birth);
  }

  private compose(x: number, z: number, scale: number, spin: number) {
    this.q.setFromAxisAngle(this.yAxis, spin * Math.PI * 2);
    this.s.setScalar(scale);
    this.p.set(x, this.world.heightAt(x, z), z);
    this.m.compose(this.p, this.q, this.s);
  }

  private chunkTiles(ch: Chunk, fn: (t: number) => void) {
    for (let j = 0; j < CHUNK; j++) {
      const row = (ch.cz * CHUNK + j) * SIZE + ch.cx * CHUNK;
      for (let i = 0; i < CHUNK; i++) fn(row + i);
    }
  }

  private build(ch: Chunk) {
    let bloomed = 0;
    this.chunkTiles(ch, (t) => {
      if (this.world.bloomed[t]) bloomed++;
    });
    // Room for what's there plus a good margin for what's about to bloom.
    const tiles = Math.min(CHUNK * CHUNK, Math.ceil(bloomed * 1.3) + 48);
    ch.flowers = new Layer(this.hiGeo, this.loGeo, this.flowerMat, tiles * 3);
    ch.tufts = new Layer(this.tuftGeo, null, this.tuftMat, tiles);
    ch.group.add(ch.flowers.hi, ch.flowers.lo!, ch.tufts.hi);
    this.chunkTiles(ch, (t) => {
      if (this.world.bloomed[t]) this.addTile(ch, t, this.recent.get(t) ?? -100);
    });
    ch.flowers.upload();
    ch.tufts.upload();
  }

  private rebuild(ch: Chunk) {
    ch.group.clear();
    ch.flowers.dispose();
    ch.tufts.dispose();
    this.build(ch);
  }

  private unload(key: number, ch: Chunk) {
    this.group.remove(ch.group);
    ch.flowers.dispose();
    ch.tufts.dispose();
    this.chunks.delete(key);
    this.dirty.delete(ch);
  }

  /** Stream chunks in and out around the camera, upload new flowers, and cull. */
  update(camera: THREE.Camera, time: number) {
    for (const ch of this.dirty) {
      ch.flowers.upload();
      ch.tufts.upload();
    }
    this.dirty.clear();
    if (this.recent.size > 4000 || (this.recent.size && Math.random() < 0.02)) {
      for (const [t, b] of this.recent) if (time - b > 2) this.recent.delete(t);
    }

    const cam = camera.position;
    // Unload far chunks.
    for (const [key, ch] of this.chunks) {
      if (Math.hypot(wrap(ch.x - cam.x), wrap(ch.z - cam.z)) > UNLOAD_DIST) this.unload(key, ch);
    }
    // Load the nearest missing chunks, a few per frame.
    const r = Math.ceil(LOAD_DIST / CHUNK) + 1;
    const ccx = Math.floor((wrap(cam.x) + HALF) / CHUNK);
    const ccz = Math.floor((wrap(cam.z) + HALF) / CHUNK);
    const want: [number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = (((ccx + dx) % NCH) + NCH) % NCH;
        const cz = (((ccz + dz) % NCH) + NCH) % NCH;
        const key = cx * NCH + cz;
        if (this.chunks.has(key)) continue;
        const x = cx * CHUNK - HALF + CHUNK / 2;
        const z = cz * CHUNK - HALF + CHUNK / 2;
        const d = Math.hypot(wrap(x - cam.x), wrap(z - cam.z));
        if (d < LOAD_DIST) want.push([d, cx, cz]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min(BUILDS_PER_FRAME, want.length); k++) {
      const [, cx, cz] = want[k];
      const ch = new Chunk(cx, cz);
      this.build(ch);
      this.chunks.set(cx * NCH + cz, ch);
      this.group.add(ch.group);
    }

    // Cull: test each chunk's nearest copy (the short way round) against the view.
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    for (const ch of this.chunks.values()) {
      const x = cam.x + wrap(ch.x - cam.x);
      const z = cam.z + wrap(ch.z - cam.z);
      const d = Math.hypot(x - cam.x, z - cam.z) - CHUNK * 0.7;
      this.box.min.set(x - CHUNK / 2, -80, z - CHUNK / 2);
      this.box.max.set(x + CHUNK / 2, 80, z + CHUNK / 2);
      const vis = d < DRAW_DIST && this.frustum.intersectsBox(this.box);
      ch.flowers.setDetail(d < LOD_DIST, vis);
      ch.tufts.setDetail(true, vis && d < TUFT_DIST);
    }
  }

  /** Drop every streamed chunk so they rebuild from the current bloom state (after loading a save). */
  reset() {
    for (const [key, ch] of this.chunks) this.unload(key, ch);
    this.recent.clear();
  }

  get loadedChunks() {
    return this.chunks.size;
  }
}
