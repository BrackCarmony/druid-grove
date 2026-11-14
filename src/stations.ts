import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Colliders } from './colliders';
import { Economy } from './economy';
import { grassTufts, mossMaterial } from './moss';
import { barkMaterial, endGrainMaterial, scaleUV } from './wood';
import { wdist, World, wrap } from './world';

// Seed sources: seed hubs (the Seed Hollow at home plus every waystone, all
// bottomless) and the squirrel caches the player builds. Each cache's squirrels
// run back and forth to the nearest hub, so a cache far from any hub refills slowly.

export interface SeedHub {
  x: number;
  z: number;
  label: string;
}

const HOLLOW_RANGE = 4.5;

/** The hollow log's radius at x (it tapers from 0.85 at the open end, x -1.8, to 0.95). */
const logR = (x: number) => 0.9 + (x / 1.8) * 0.05;

/** A blanket of moss over the top of the hollow log, its edges ragged where it trails down. */
function mossDrape() {
  const len = 3.3;
  const geo = new THREE.CylinderGeometry(1, 1, len, 14, 28, true, Math.PI / 2 - 1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i); // along the log
    const z = p.getZ(i);
    let a = Math.atan2(x, z) - Math.PI / 2; // -1..1 across the top
    // Trail further down in some places than others; the ends taper in.
    const edge = 0.2 * Math.sin(y * 3.1 + Math.sign(a) * 2) + 0.07 * Math.sin(y * 7.3 + 1);
    const endIn = 1 - Math.pow(Math.abs(y) / (len / 2), 3) * 0.6;
    a *= (1 + edge) * endIn;
    const wx = -y; // the log is turned on its side: geometry y runs along world -x
    const r = logR(wx) + 0.035 + 0.02 * Math.sin(a * 7 + y * 5);
    p.setXYZ(i, Math.sin(a + Math.PI / 2) * r, y, Math.cos(a + Math.PI / 2) * r);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mossMaterial(1.2, 2.2));
  m.rotation.z = Math.PI / 2;
  m.position.y = 0.75;
  return m;
}

function logTufts() {
  const spots: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  for (let i = 0; i < 14; i++) {
    const x = -1.4 + (i / 13) * 2.8 + Math.sin(i * 7.3) * 0.12;
    const a = Math.sin(i * 3.7) * 0.6; // around the log from the top
    const n = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    spots.push({ p: new THREE.Vector3(x, 0.75, 0).addScaledVector(n, logR(x) + 0.04), n });
  }
  return grassTufts(spots, 3, 0.9);
}
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
  hub: string; // where its squirrels fetch from
}

export class Stations {
  group = new THREE.Group();
  hollow = new THREE.Vector3();
  /** Other bottomless seed hubs (waystones); set by main. */
  extraHubs: () => SeedHub[] = () => [];
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
    // The log rests on the lowest ground along its length; higher ground just buries a bit of it.
    let lo = Infinity;
    for (const dx of [-1.8, -0.9, 0, 0.9, 1.8])
      for (const dz of [-0.6, 0.6]) lo = Math.min(lo, world.heightAt(hx + dx, hz + dz));
    this.hollow.set(hx, lo, hz);
    this.group.add(this.buildHollow());
    colliders.add(hx - 1.1, hz, 0.75);
    colliders.add(hx + 0.2, hz, 0.75);
    colliders.add(hx + 1.4, hz, 0.75);
  }

  private buildHollow() {
    const g = new THREE.Group();
    const log = new THREE.Mesh(
      scaleUV(new THREE.CylinderGeometry(0.85, 0.95, 3.6, 16, 1, true), 3, 2),
      barkMaterial(0x6b4a33, THREE.DoubleSide),
    );
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.75;
    // The closed end shows its growth rings.
    const end = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16), endGrainMaterial(0x9a7454));
    end.rotation.y = Math.PI / 2;
    end.position.set(1.8, 0.75, 0);
    g.add(end);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.8, 12), lam(0x2a1a10));
    inner.rotation.y = -Math.PI / 2;
    inner.position.set(-1.75, 0.75, 0);
    g.add(log, inner);
    // spilling seed pile
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 + Math.random() * 0.08, 0), lam(0x9a6a3a));
      s.position.set(-1.9 - Math.random() * 0.9, 0, (Math.random() - 0.5) * 1.2);
      s.name = 'ground';
      s.userData.lift = 0.06 + Math.random() * 0.1; // a loose heap
      g.add(s);
    }
    g.add(mossDrape(), logTufts());
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
    this.world.groundChildren(g, this.hollow.y);
    return g;
  }

  canBuildAt(x: number, z: number): string | null {
    if (wdist(this.hollow.x, this.hollow.z, x, z) < MIN_CACHE_SPACING) return 'Too close to the Seed Hollow';
    for (const c of this.caches) {
      if (wdist(c.x, c.z, x, z) < MIN_CACHE_SPACING) return 'Too close to another cache';
    }
    return null;
  }

  build(x: number, z: number, stock = 0): Cache {
    // On the highest ground under it (so the squirrel hole isn't buried); the stump runs
    // 2 m into the earth to meet lower ground.
    const y = this.world.heightRange(x, z, 0.7).max;
    const obj = new THREE.Group();
    const stump = new THREE.Mesh(
      scaleUV(new THREE.CylinderGeometry(0.55, 0.75, 3.1, 12, 1, true), 2.5, 2),
      barkMaterial(0x7a5236),
    );
    stump.position.y = 1.05 - 1.55;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.05, 12), endGrainMaterial(0xc9a27a));
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
    const cache: Cache = { x, z, stock, obj, squirrels: [], label: `Cache ${this.caches.length + 1}`, hub: '' };
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
  get hubs(): SeedHub[] {
    return [{ x: this.hollow.x, z: this.hollow.z, label: 'the Seed Hollow' }, ...this.extraHubs()];
  }

  /** The nearest bottomless seed source, the short way round. */
  nearestHub(x: number, z: number): SeedHub {
    let best!: SeedHub;
    let bd = Infinity;
    for (const h of this.hubs) {
      const d = wdist(h.x, h.z, x, z);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  nearby(pos: THREE.Vector3): { kind: 'hollow' } | { kind: 'cache'; cache: Cache } | null {
    if (wdist(this.hollow.x, this.hollow.z, pos.x, pos.z) < HOLLOW_RANGE) return { kind: 'hollow' };
    for (const c of this.caches) {
      if (wdist(c.x, c.z, pos.x, pos.z) < CACHE_RANGE) return { kind: 'cache', cache: c };
    }
    return null;
  }

  update(dt: number, time: number, playerPos: THREE.Vector3) {
    const cap = this.econ.cacheStockCap;
    const carry = this.econ.squirrelCarry;
    const speed = this.econ.squirrelSpeed;
    const fwd = new THREE.Vector3();
    const hubs = this.hubs;
    for (const c of this.caches) {
      // Squirrels run to whichever hub is nearest, the short way round the planet.
      let hub = hubs[0];
      let hd = Infinity;
      for (const h of hubs) {
        const d = wdist(h.x, h.z, c.x, c.z);
        if (d < hd) {
          hd = d;
          hub = h;
        }
      }
      c.hub = hub.label;
      const dist = Math.max(4, hd);
      const dx = wrap(hub.x - c.x) / dist;
      const dz = wrap(hub.z - c.z) / dist;
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
        // position: out = cache -> hub, back = hub -> cache
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
        s.mesh.visible = wdist(playerPos.x, playerPos.z, x, z) < 220;
      }
      // seed pile grows with stock
      const pile = c.obj.children[3];
      const f = c.stock / cap;
      pile.scale.set(0.3 + f * 0.7, 0.1 + f * 0.5, 0.3 + f * 0.7);
    }
  }
}
