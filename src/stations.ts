import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Colliders } from './colliders';
import { Economy } from './economy';
import { World } from './world';

// Seed sources: the Seed Hollow at the start (endless seeds) and squirrel caches
// the player builds. Each cache's squirrels run back and forth to the Hollow,
// so a far-flung cache refills more slowly than one close to home.

const HOLLOW_RANGE = 4.5;
const CACHE_RANGE = 3.5;
const MIN_CACHE_SPACING = 8;

const lam = (color: number, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });

function colored(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = c.r;
    arr[i + 1] = c.g;
    arr[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

// One merged mesh per squirrel keeps them to a single draw call each.
function squirrelGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const fur = 0xc4703a;
  const body = new THREE.SphereGeometry(0.16, 8, 6);
  body.scale(0.9, 0.9, 1.3);
  body.translate(0, 0.2, 0);
  parts.push(colored(body, fur));
  const head = new THREE.SphereGeometry(0.11, 8, 6);
  head.translate(0, 0.34, 0.17);
  parts.push(colored(head, fur));
  const belly = new THREE.SphereGeometry(0.1, 6, 4);
  belly.translate(0, 0.17, 0.1);
  parts.push(colored(belly, 0xf2d7b0));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.035, 0.08, 4);
    ear.translate(s * 0.06, 0.46, 0.15);
    parts.push(colored(ear, fur));
    const eye = new THREE.SphereGeometry(0.02, 4, 3);
    eye.translate(s * 0.06, 0.37, 0.26);
    parts.push(colored(eye, 0x111111));
  }
  const tail = new THREE.SphereGeometry(0.14, 8, 6);
  tail.scale(0.7, 1.6, 0.7);
  tail.rotateX(-0.5);
  tail.translate(0, 0.38, -0.22);
  parts.push(colored(tail, 0xd9884a));
  const acorn = new THREE.SphereGeometry(0.05, 6, 4);
  acorn.translate(0, 0.27, 0.27);
  parts.push(colored(acorn, 0x8a5a2b));
  return mergeGeometries(parts)!;
}

interface Squirrel {
  mesh: THREE.Mesh;
  phase: 'out' | 'back';
  t: number; // 0..1 along the path
  offset: number;
}

export interface Cache {
  x: number;
  z: number;
  stock: number;
  obj: THREE.Group;
  squirrels: Squirrel[];
  label: string;
}

export class Stations {
  group = new THREE.Group();
  hollow = new THREE.Vector3();
  caches: Cache[] = [];
  private sqGeo = squirrelGeometry();
  private sqMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private seedPile = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), lam(0x9a6a3a));

  constructor(
    private world: World,
    private econ: Economy,
    private colliders: Colliders,
  ) {
    const hx = 5;
    const hz = 7;
    this.hollow.set(hx, world.heightAt(hx, hz), hz);
    this.group.add(this.buildHollow());
    colliders.add(hx - 1.1, hz, 0.75);
    colliders.add(hx + 0.2, hz, 0.75);
    colliders.add(hx + 1.4, hz, 0.75);
  }

  private buildHollow() {
    const g = new THREE.Group();
    const bark = lam(0x6b4a33);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 3.6, 12, 1, true), bark);
    log.material.side = THREE.DoubleSide;
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.75;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.8, 12), lam(0x2a1a10));
    inner.rotation.y = -Math.PI / 2;
    inner.position.set(-1.75, 0.75, 0);
    g.add(log, inner);
    // spilling seed pile
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 + Math.random() * 0.08, 0), lam(0x9a6a3a));
      s.position.set(-1.9 - Math.random() * 0.9, 0.1 + Math.random() * 0.15, (Math.random() - 0.5) * 1.2);
      g.add(s);
    }
    const moss = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x6aa83f));
    moss.scale.set(1.6, 0.35, 0.95);
    moss.position.y = 1.45;
    g.add(moss);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.6, 24, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd36b,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 12;
    g.add(beam);
    g.position.copy(this.hollow);
    return g;
  }

  canBuildAt(x: number, z: number): string | null {
    if (Math.hypot(x - this.hollow.x, z - this.hollow.z) < MIN_CACHE_SPACING) return 'Too close to the Seed Hollow';
    for (const c of this.caches) {
      if (Math.hypot(x - c.x, z - c.z) < MIN_CACHE_SPACING) return 'Too close to another cache';
    }
    return null;
  }

  build(x: number, z: number, stock = 0): Cache {
    const y = this.world.heightAt(x, z);
    const obj = new THREE.Group();
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.1, 9), lam(0x7a5236));
    stump.position.y = 0.5;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 9), lam(0xc9a27a));
    top.position.y = 1.07;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.2, 8), lam(0x24160c));
    hole.position.set(0, 0.6, 0.66);
    hole.rotation.x = -0.12;
    const pile = this.seedPile.clone();
    pile.position.y = 1.15;
    pile.scale.set(0.8, 0.4, 0.8);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 4), lam(0xffd36b, 0x664400));
    flag.position.y = 2.0;
    flag.rotation.x = Math.PI;
    obj.add(stump, top, hole, pile, flag);
    obj.position.set(x, y, z);
    this.group.add(obj);
    this.colliders.add(x, z, 0.7);
    const cache: Cache = { x, z, stock, obj, squirrels: [], label: `Cache ${this.caches.length + 1}` };
    this.caches.push(cache);
    this.syncSquirrels();
    return cache;
  }

  /** Make sure every cache has as many squirrels as the Family upgrade allows. */
  syncSquirrels() {
    const want = this.econ.squirrelsPerCache;
    for (const c of this.caches) {
      while (c.squirrels.length < want) {
        const mesh = new THREE.Mesh(this.sqGeo, this.sqMat);
        this.group.add(mesh);
        c.squirrels.push({
          mesh,
          phase: 'out',
          t: c.squirrels.length / want,
          offset: (Math.random() - 0.5) * 1.5,
        });
      }
    }
  }

  /** Seeds within reach: returns the source the player is standing at, if any. */
  nearby(pos: THREE.Vector3): { kind: 'hollow' } | { kind: 'cache'; cache: Cache } | null {
    if (Math.hypot(pos.x - this.hollow.x, pos.z - this.hollow.z) < HOLLOW_RANGE) return { kind: 'hollow' };
    for (const c of this.caches) {
      if (Math.hypot(pos.x - c.x, pos.z - c.z) < CACHE_RANGE) return { kind: 'cache', cache: c };
    }
    return null;
  }

  update(dt: number, time: number, playerPos: THREE.Vector3) {
    const cap = this.econ.cacheStockCap;
    const carry = this.econ.squirrelCarry;
    const speed = this.econ.squirrelSpeed;
    const fwd = new THREE.Vector3();
    for (const c of this.caches) {
      const dist = Math.max(4, Math.hypot(c.x - this.hollow.x, c.z - this.hollow.z));
      const dx = (this.hollow.x - c.x) / dist;
      const dz = (this.hollow.z - c.z) / dist;
      for (const s of c.squirrels) {
        // Squirrels idle at a full cache, hopping in place.
        const idle = c.stock >= cap && s.phase === 'out' && s.t <= 0.001;
        if (!idle) {
          s.t += (dt * speed) / dist;
          if (s.t >= 1) {
            s.t = 0;
            if (s.phase === 'out') s.phase = 'back';
            else {
              s.phase = 'out';
              c.stock = Math.min(cap, c.stock + carry);
            }
          }
        }
        // position: out = cache -> hollow, back = hollow -> cache
        const k = s.phase === 'out' ? s.t : 1 - s.t;
        const side = s.offset;
        let x = c.x + dx * dist * k - dz * side;
        let z = c.z + dz * dist * k + dx * side;
        if (idle) {
          const a = time * 0.8 + side * 4;
          x = c.x + Math.cos(a) * 1.2;
          z = c.z + Math.sin(a) * 1.2;
          fwd.set(-Math.sin(a), 0, Math.cos(a));
        } else {
          fwd.set(dx, 0, dz).multiplyScalar(s.phase === 'out' ? 1 : -1);
        }
        const hop = Math.abs(Math.sin(time * 9 + side * 7)) * 0.3;
        s.mesh.position.set(x, this.world.heightAt(x, z) + hop, z);
        s.mesh.rotation.y = Math.atan2(fwd.x, fwd.z);
        s.mesh.visible = Math.hypot(x - playerPos.x, z - playerPos.z) < 220;
      }
      // seed pile grows with stock
      const pile = c.obj.children[3];
      const f = c.stock / cap;
      pile.scale.set(0.3 + f * 0.7, 0.1 + f * 0.5, 0.3 + f * 0.7);
    }
  }
}
