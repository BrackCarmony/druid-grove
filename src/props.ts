import * as THREE from 'three';
import { Circle, Colliders } from './colliders';
import { mulberry32 } from './noise';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Glade, HALF, Soil, SIZE, tileIndex, wdist, World } from './world';
import { barkMaterial, scaleUV, woodCylinder } from './wood';
import { leafGeo, paint, windSway } from './rig';
import { sharedUniforms } from './terrain';

// Scenery: dead stumps and boulders on the wasteland, the dormant heart-seed in
// each glade, and the heart tree that grows when a glade is restored.

export class DeadScenery {
  group = new THREE.Group();
  private stumps!: THREE.InstancedMesh;
  private stumpAt = new Map<number, number>(); // tile -> instance
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  private stumpCollider = new Map<number, Circle>();

  private rocks!: THREE.InstancedMesh;
  // tile -> boulder on it (at most one per tile)
  private rockAt = new Map<number, { i: number; x: number; y: number; z: number; r: number; c: Circle | null }>();
  /** Tiles whose boulder has been trampled to gravel (saved). */
  trampled = new Set<number>();

  constructor(
    world: World,
    private colliders: Colliders,
  ) {
    this.build(world);
  }

  /** Smash every boulder overlapping a circle. Calls onSmash for each one broken. */
  trample(x: number, z: number, r: number, onSmash: (x: number, y: number, z: number, size: number) => void) {
    const ci = Math.floor(x + HALF);
    const cj = Math.floor(z + HALF);
    const ri = Math.ceil(r + 1);
    for (let j = cj - ri; j <= cj + ri; j++) {
      for (let i = ci - ri; i <= ci + ri; i++) {
        const t = tileIndex(i, j);
        const rock = this.rockAt.get(t);
        if (!rock || wdist(x, z, rock.x, rock.z) > r + rock.r) continue;
        this.smash(t);
        onSmash(rock.x, rock.y, rock.z, rock.r);
      }
    }
  }

  smash(t: number) {
    const rock = this.rockAt.get(t);
    if (!rock) return;
    this.rocks.setMatrixAt(rock.i, this.zero);
    this.rocks.instanceMatrix.needsUpdate = true;
    if (rock.c) this.colliders.remove(rock.c);
    this.rockAt.delete(t);
    this.trampled.add(t);
  }

  /** Dead stumps crumble away once their tile blooms. */
  clearTile(t: number) {
    const i = this.stumpAt.get(t);
    if (i === undefined) return;
    this.stumps.setMatrixAt(i, this.zero);
    this.stumps.instanceMatrix.needsUpdate = true;
    this.stumpAt.delete(t);
    const c = this.stumpCollider.get(t);
    if (c) this.colliders.remove(c);
    this.stumpCollider.delete(t);
  }

  private build(world: World) {
    const g = this.group;
    const rng = mulberry32(99);
    const stump = woodCylinder(new THREE.CylinderGeometry(0.18, 0.28, 0.7, 7), 0x4a3a30, 0x7a6a5a, 1, 0.5);
    const stumpGeo = stump.geo.translate(0, 0.3, 0);
    const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
    const stumps = new THREE.InstancedMesh(stumpGeo, stump.materials, Math.ceil(SIZE * SIZE * 0.008));
    const rocks = new THREE.InstancedMesh(
      rockGeo,
      new THREE.MeshLambertMaterial({ color: 0x77727a }),
      Math.ceil(SIZE * SIZE * 0.03),
    );
    let ns = 0;
    let nr = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let t = 0; t < SIZE * SIZE; t++) {
      const soil = world.soil[t];
      if (soil === Soil.Creek) continue;
      const r = rng();
      const [x, z] = world.tileCenter(t);
      if (Math.hypot(x, z) < 13) continue; // keep spawn + Seed Hollow clear
      const ox = x + (rng() - 0.5) * 0.6;
      const oz = z + (rng() - 0.5) * 0.6;
      const y = world.heightAt(ox, oz);
      const rockChance = soil === Soil.Stone ? 0.05 : soil === Soil.Clay ? 0.012 : 0.004;
      if (r < rockChance && nr < rocks.count) {
        e.set(rng() * 3, rng() * 3, rng() * 3);
        q.setFromEuler(e);
        const sc = 0.4 + rng() * (soil === Soil.Stone ? 1.6 : 0.7);
        s.set(sc, sc * (0.5 + rng() * 0.4), sc);
        p.set(ox, y + sc * 0.1, oz);
        const c = sc > 0.45 ? this.colliders.add(ox, oz, sc * 0.5) : null;
        this.rockAt.set(t, { i: nr, x: ox, y: y + sc * 0.3, z: oz, r: sc * 0.5, c });
        rocks.setMatrixAt(nr++, m.compose(p, q, s));
      } else if (r > 0.993 && soil !== Soil.Stone && ns < stumps.count) {
        e.set((rng() - 0.5) * 0.3, rng() * 6, (rng() - 0.5) * 0.3);
        q.setFromEuler(e);
        const sc = 0.7 + rng() * 0.9;
        s.set(sc, sc * (0.6 + rng() * 1.6), sc);
        p.set(ox, y - 0.05, oz);
        this.stumpAt.set(t, ns);
        this.stumpCollider.set(t, this.colliders.add(ox, oz, 0.22 * sc));
        stumps.setMatrixAt(ns++, m.compose(p, q, s));
      }
    }
    stumps.count = ns;
    rocks.count = nr;
    g.add(stumps, rocks);
    this.stumps = stumps;
    this.rocks = rocks;
  }
}

const TREE_DIST = 330;

const LEAF_GREENS = [0x4f9e3e, 0x5fae4a, 0x6cbb4f, 0x84c95a, 0x3f8a3a];

function swaying(m: THREE.MeshLambertMaterial) {
  windSway(m, sharedUniforms.uTime, 6.5, 0.012);
  return m;
}

/**
 * A heart tree's crown: lumpy faceted clumps of foliage, shaded darker underneath, fringed
 * with leaves so the outline is leafy, and dotted with blossoms in the glade's colours.
 */
function canopyParts(palette: number[], rng: () => number) {
  const parts: THREE.BufferGeometry[] = [];
  const leaf = leafGeo(0.5, 0.85, 0.3);
  const petal = leafGeo(0.2, 0.26, 0.15);
  const c = new THREE.Color();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const clumps: { x: number; y: number; z: number; r: number }[] = [];
  for (let i = 0; i < 13; i++) {
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : 1.2 + rng() * 2.2;
    const r = i === 0 ? 3 : 1.5 + rng() * 1.3;
    clumps.push({ x: Math.cos(a) * d, y: 8.2 + rng() * 3.2 + (i === 0 ? 1 : 0), z: Math.sin(a) * d, r });
  }
  for (const k of clumps) {
    const base = LEAF_GREENS[Math.floor(rng() * 3) + 1];
    const blob = new THREE.IcosahedronGeometry(k.r, 2).toNonIndexed();
    blob.deleteAttribute('uv');
    const p = blob.attributes.position;
    // Lumpy: push each corner in or out a little (same corner, same push, so faces stay joined).
    for (let i = 0; i < p.count; i++) {
      n.set(p.getX(i), p.getY(i), p.getZ(i));
      const bump = 1 + 0.13 * Math.sin(n.x * 2.7 + n.z * 1.9) * Math.cos(n.y * 2.3 + n.x);
      n.multiplyScalar(bump);
      p.setXYZ(i, n.x + k.x, n.y + k.y, n.z + k.z);
    }
    blob.computeVertexNormals(); // faceted
    const col = new Float32Array(p.count * 3);
    const nr = blob.attributes.normal;
    for (let f = 0; f < p.count; f += 3) {
      // Per face: darker below, sunlit above, and a little random dappling.
      const ny = nr.getY(f);
      c.setHex(base).multiplyScalar(0.86 + 0.24 * (ny * 0.5 + 0.5) + (rng() - 0.5) * 0.12);
      for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (f + v) * 3);
    }
    blob.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(blob);

    // A fringe of leaves, and a few blossoms, around the clump's upper and outer surface.
    const leaves = Math.round(k.r * k.r * 13);
    for (let i = 0; i < leaves; i++) {
      const u = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      n.set(Math.sqrt(1 - u * u) * Math.cos(t), u, Math.sqrt(1 - u * u) * Math.sin(t));
      if (n.y < -0.55) continue; // nobody sees the bottom
      const at = new THREE.Vector3(k.x, k.y, k.z).addScaledVector(n, k.r * 0.93);
      // Stem in the clump, tip pointing out and drooping a little.
      const dir = n.clone().addScaledVector(up, -0.35).normalize();
      q.setFromUnitVectors(up, dir);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rng() * Math.PI * 2));
      const sc = 0.75 + rng() * 0.6;
      const lg = leaf.clone().applyMatrix4(m.compose(at, q, new THREE.Vector3(sc, sc, sc)));
      parts.push(paint(lg, c.setHex(LEAF_GREENS[Math.floor(rng() * LEAF_GREENS.length)])));
    }
    const blooms = Math.round(k.r * 8);
    for (let i = 0; i < blooms; i++) {
      const u = -0.3 + rng() * 1.3;
      const t = rng() * Math.PI * 2;
      n.set(Math.sqrt(1 - u * u) * Math.cos(t), u, Math.sqrt(1 - u * u) * Math.sin(t));
      const at = new THREE.Vector3(k.x, k.y, k.z).addScaledVector(n, k.r * 1.0);
      q.setFromUnitVectors(up, n);
      const col = palette[Math.floor(rng() * palette.length)];
      for (let j = 0; j < 5; j++) {
        const pg = petal
          .clone()
          .rotateX(-1.1)
          .rotateY((j / 5) * Math.PI * 2);
        parts.push(paint(pg.applyMatrix4(m.compose(at, q, new THREE.Vector3(1.9, 1.9, 1.9))), col));
      }
      const centre = new THREE.IcosahedronGeometry(0.1, 0).applyMatrix4(m.compose(at, q, new THREE.Vector3(1, 1, 1)));
      parts.push(paint(centre, 0xffe066));
    }
  }
  return parts;
}

export class HeartTrees {
  /** Render-distance scale (1 = full). */
  viewScale = 1;
  group = new THREE.Group();
  private cores: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private seedIndex = new Map<number, number>(); // glade -> instance
  private seedPos: { x: number; y: number; z: number; alive: boolean }[] = [];
  private trees: { obj: THREE.Mesh; born: number; x: number; z: number; size: number; grown: boolean }[] = [];
  private treeGeos = new Map<number, { canopy: THREE.BufferGeometry; trunk: THREE.BufferGeometry }>();
  private treeMat = swaying(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  private trunkMat = barkMaterial(0x6b4a33);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private world: World,
    private colliders: Colliders,
  ) {
    const n = world.glades.length;
    this.cores = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.35, 0),
      new THREE.MeshLambertMaterial({ color: 0x9ce07a, emissive: 0x3c8a2a }),
      n,
    );
    this.beams = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.2, 0.5, 14, 10, 1, true).translate(0, 7, 0),
      new THREE.MeshBasicMaterial({
        color: 0xc8ffb0,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      n,
    );
    let k = 0;
    for (const g of world.glades) {
      if (g.heartTile < 0) continue;
      const [x, z] = world.tileCenter(g.heartTile);
      const y = world.heightAt(x, z);
      this.seedIndex.set(g.id, k);
      this.seedPos[k] = { x, y, z, alive: true };
      this.beams.setMatrixAt(k, this.m.makeTranslation(x, y, z));
      this.cores.setMatrixAt(k, this.m.makeTranslation(x, y + 0.6, z));
      k++;
    }
    this.cores.count = this.beams.count = k;
    this.group.add(this.cores, this.beams);
  }

  private treeGeometry(g: Glade) {
    let geo = this.treeGeos.get(g.paletteId);
    if (geo) return geo;
    const rng = mulberry32(g.paletteId * 31 + 5);
    // The trunk and branches are a separate, bark-textured mesh.
    const wood: THREE.BufferGeometry[] = [
      scaleUV(new THREE.CylinderGeometry(0.5, 1.1, 7, 10).translate(0, 3.5, 0), 3, 4),
    ];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng();
      const br = scaleUV(new THREE.CylinderGeometry(0.15, 0.35, 3.5, 6), 1, 2);
      br.rotateX(Math.sin(a) * 0.7);
      br.rotateZ(-Math.cos(a) * 0.7);
      br.translate(Math.cos(a) * 1.0, 6.5, Math.sin(a) * 1.0);
      wood.push(br);
    }
    const parts = canopyParts(g.palette, rng);
    geo = { canopy: mergeGeometries(parts)!, trunk: mergeGeometries(wood)! };
    this.treeGeos.set(g.paletteId, geo);
    return geo;
  }

  complete(g: Glade, time: number, instant = false) {
    if (g.heartTile < 0) return;
    const k = this.seedIndex.get(g.id);
    if (k !== undefined && this.seedPos[k].alive) {
      this.seedPos[k].alive = false;
      this.cores.setMatrixAt(k, this.zero);
      this.beams.setMatrixAt(k, this.zero);
      this.cores.instanceMatrix.needsUpdate = true;
      this.beams.instanceMatrix.needsUpdate = true;
    }
    const [x, z] = this.world.tileCenter(g.heartTile);
    const geo = this.treeGeometry(g);
    const tree = new THREE.Mesh(geo.canopy, this.treeMat);
    const trunk = new THREE.Mesh(geo.trunk, this.trunkMat);
    trunk.frustumCulled = false;
    tree.add(trunk);
    tree.position.set(x, this.world.heightAt(x, z) - 0.2, z);
    tree.rotation.y = (g.id * 2.39996) % (Math.PI * 2);
    const size = 0.85 + ((g.id * 0.618) % 1) * 0.3;
    tree.scale.setScalar(instant ? size : 0.01);
    tree.frustumCulled = false;
    this.group.add(tree);
    this.colliders.add(x, z, 1.0);
    this.trees.push({ obj: tree, born: instant ? -100 : time, x, z, size, grown: instant });
  }

  update(time: number, cam: THREE.Vector3) {
    // Bob the nearby seeds.
    let moved = false;
    for (let k = 0; k < this.seedPos.length; k++) {
      const p = this.seedPos[k];
      if (!p || !p.alive || wdist(p.x, p.z, cam.x, cam.z) > 200) continue;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), time * 0.8);
      this.v.set(p.x, p.y + 0.6 + Math.sin(time * 2 + k) * 0.12, p.z);
      this.cores.setMatrixAt(k, this.m.compose(this.v, this.q, this.s.set(1, 1, 1)));
      moved = true;
    }
    if (moved) this.cores.instanceMatrix.needsUpdate = true;
    for (const t of this.trees) {
      const vis = wdist(t.x, t.z, cam.x, cam.z) < TREE_DIST * this.viewScale;
      t.obj.visible = vis;
      if (!vis) continue;
      if (t.grown) continue;
      const a = THREE.MathUtils.clamp((time - t.born) / 4, 0, 1);
      const s = 1 - Math.pow(1 - a, 3);
      t.obj.scale.setScalar(Math.max(0.01, s * (1 + 0.08 * Math.sin(a * Math.PI)) * t.size));
      if (a >= 1) t.grown = true;
    }
  }
}
