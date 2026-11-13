import * as THREE from 'three';
import { Circle, Colliders } from './colliders';
import { mulberry32 } from './noise';
import { Glade, Soil, SIZE, World } from './world';

// Scenery: dead stumps and boulders on the wasteland, the dormant heart-seed in
// each glade, and the heart tree that grows when a glade is restored.

export class DeadScenery {
  group = new THREE.Group();
  private stumps!: THREE.InstancedMesh;
  private stumpAt = new Map<number, number>(); // tile -> instance
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  private stumpCollider = new Map<number, Circle>();

  constructor(
    world: World,
    private colliders: Colliders,
  ) {
    this.build(world);
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
    const stumpGeo = new THREE.CylinderGeometry(0.18, 0.28, 0.7, 6);
    stumpGeo.translate(0, 0.3, 0);
    const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
    const stumps = new THREE.InstancedMesh(
      stumpGeo,
      new THREE.MeshLambertMaterial({ color: 0x4a3a30 }),
      Math.ceil(SIZE * SIZE * 0.008),
    );
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
        rocks.setMatrixAt(nr++, m.compose(p, q, s));
        if (sc > 0.45) this.colliders.add(ox, oz, sc * 0.5);
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
  }
}

export class HeartTrees {
  group = new THREE.Group();
  private seeds = new Map<number, THREE.Object3D>();
  private trees = new Map<number, { obj: THREE.Object3D; born: number }>();
  private seedMat = new THREE.MeshLambertMaterial({ color: 0x9ce07a, emissive: 0x3c8a2a });
  private beamMat = new THREE.MeshBasicMaterial({
    color: 0xc8ffb0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  constructor(
    private world: World,
    private colliders: Colliders,
  ) {
    for (const g of world.glades) {
      if (g.heartTile < 0) continue;
      const [x, z] = world.tileCenter(g.heartTile);
      const y = world.heightAt(x, z);
      const seed = new THREE.Group();
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), this.seedMat);
      core.position.y = 0.6;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, 14, 10, 1, true), this.beamMat);
      beam.position.y = 7;
      seed.add(core, beam);
      seed.position.set(x, y, z);
      this.seeds.set(g.id, seed);
      this.group.add(seed);
    }
  }

  complete(g: Glade, time: number, instant = false) {
    if (g.heartTile < 0) return;
    const seed = this.seeds.get(g.id);
    if (seed) {
      this.group.remove(seed);
      this.seeds.delete(g.id);
    }
    const tree = buildTree(g);
    const [x, z] = this.world.tileCenter(g.heartTile);
    tree.position.set(x, this.world.heightAt(x, z) - 0.2, z);
    tree.scale.setScalar(instant ? 1 : 0.01);
    this.group.add(tree);
    this.colliders.add(tree.position.x, tree.position.z, 1.0);
    this.trees.set(g.id, { obj: tree, born: instant ? -100 : time });
  }

  update(time: number) {
    for (const seed of this.seeds.values()) {
      const core = seed.children[0];
      core.rotation.y = time * 0.8;
      core.position.y = 0.6 + Math.sin(time * 2) * 0.12;
    }
    for (const t of this.trees.values()) {
      const a = THREE.MathUtils.clamp((time - t.born) / 4, 0, 1);
      const s = 1 - Math.pow(1 - a, 3);
      t.obj.scale.setScalar(Math.max(0.01, s * (1 + 0.08 * Math.sin(a * Math.PI))));
      t.obj.rotation.y = Math.sin(time * 0.3) * 0.02;
    }
  }
}

function buildTree(g: Glade): THREE.Group {
  const rng = mulberry32(g.id * 31 + 5);
  const tree = new THREE.Group();
  const bark = new THREE.MeshLambertMaterial({ color: 0x6b4a33 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 7, 8), bark);
  trunk.position.y = 3.5;
  tree.add(trunk);
  for (let i = 0; i < 4; i++) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 3.5, 6), bark);
    const a = (i / 4) * Math.PI * 2 + rng();
    br.position.set(Math.cos(a) * 1.0, 6.5, Math.sin(a) * 1.0);
    br.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
    tree.add(br);
  }
  const leafA = new THREE.MeshLambertMaterial({ color: 0x5fae4a });
  const blossom = new THREE.MeshLambertMaterial({ color: g.palette[0], emissive: 0x221018 });
  for (let i = 0; i < 14; i++) {
    const r = 1.6 + rng() * 1.6;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rng() < 0.35 ? blossom : leafA);
    const a = rng() * Math.PI * 2;
    const d = rng() * 3.2;
    blob.position.set(Math.cos(a) * d, 8 + rng() * 3.5, Math.sin(a) * d);
    tree.add(blob);
  }
  return tree;
}
