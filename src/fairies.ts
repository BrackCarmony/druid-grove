import * as THREE from 'three';
import { Economy, WAYFARER } from './economy';
import { Particles } from './fx';
import { Garden, SeedPool } from './garden';
import { Cache, Stations } from './stations';
import { BCHUNK, HALF, NBC, SIZE, Soil, tileIndex, wdist, World, wrap } from './world';

// Planter fairies: bought with honey, they live in fairy rings the player places.
// Each fairy fetches seeds from the nearest seed hub or squirrel cache, flies
// out to the nearest unplanted ground within its ring's reach, and plants it.
// Wayfarer fairies have no ring: they roam the whole planet hunting for bare
// ground that no ring covers.

const MIN_SPACING = 8;
const RING_RANGE = 3;
const MAX_FAIRIES = 1024;
const CRUISE = 3.2; // metres above ground while travelling
const HOVER = 0.9; // while planting
const DRAW_DIST = 260;

const lam = (color: number, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });

type State = 'fetch' | 'seek' | 'fly' | 'plant' | 'idle';

interface Fairy {
  ring: Ring | null; // null: a wayfarer, roaming the whole planet
  chunk: number; // wayfarers: the bookkeeping chunk they're working
  pos: THREE.Vector3;
  state: State;
  seeds: number;
  target: number; // tile index, -1 when none
  tx: number;
  tz: number;
  wait: number;
  hue: number;
  phase: number;
  sparkle: number;
  pool: SeedPool;
}

export interface Ring {
  x: number;
  z: number;
  obj: THREE.Group;
  fairies: Fairy[];
  label: string;
  exhaustedUntil: number; // no plantable tiles in reach: don't rescan until then
  left: number; // plantable tiles left in reach (refreshed occasionally)
  locked: number; // bare tiles in reach whose soil isn't unlocked yet
  recount: number;
}

const WAYFARER_HUE = 0xfff1b8;
const PALETTE = [0xff9ee6, 0xb9a2ff, 0x9ef0ff, 0xfff59e, 0xa8ffb8];

function ringModel() {
  const g = new THREE.Group();
  const stem = lam(0xf3ead8);
  const caps = [lam(0xd94f6b), lam(0x9b6bd9), lam(0xe8913a)];
  const dots = lam(0xffffff);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const s = 0.7 + ((i * 37) % 5) * 0.12;
    const m = new THREE.Group();
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 6), stem);
    st.position.y = 0.2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), caps[i % 3]);
    cap.position.y = 0.38;
    cap.scale.y = 0.7;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), dots);
    dot.position.set(0.08, 0.5, 0.05);
    m.add(st, cap, dot);
    m.scale.setScalar(s);
    m.position.set(Math.cos(a) * 1.8, 0, Math.sin(a) * 1.8);
    g.add(m);
  }
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 24),
    new THREE.MeshBasicMaterial({ color: 0xe0b8ff, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.05;
  g.add(glow);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.9, 18, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xd9a8ff,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 9;
  g.add(beam);
  return g;
}

export class FairyRings {
  group = new THREE.Group();
  rings: Ring[] = [];
  wayfarers: Fairy[] = [];
  private wildExhaustedUntil = 0;
  private claimed = new Set<number>();
  private bodies: THREE.InstancedMesh;
  private wings: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(
    private world: World,
    private econ: Economy,
    private garden: Garden,
    private stations: Stations,
    private particles: Particles,
  ) {
    this.bodies = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_FAIRIES,
    );
    const wingGeo = new THREE.CircleGeometry(0.22, 10);
    wingGeo.scale(1, 0.55, 1);
    wingGeo.rotateX(-Math.PI / 2);
    wingGeo.translate(0.2, 0.04, 0);
    this.wings = new THREE.InstancedMesh(
      wingGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      MAX_FAIRIES * 2,
    );
    for (const m of [this.bodies, this.wings]) {
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
  }

  canBuildAt(x: number, z: number): string | null {
    for (const r of this.rings) {
      if (wdist(r.x, r.z, x, z) < MIN_SPACING) return 'Too close to another fairy ring';
    }
    return null;
  }

  build(x: number, z: number): Ring {
    const obj = ringModel();
    obj.position.set(x, this.world.heightAt(x, z), z);
    this.group.add(obj);
    const ring: Ring = {
      x,
      z,
      obj,
      fairies: [],
      label: `Fairy Ring ${this.rings.length + 1}`,
      exhaustedUntil: 0,
      left: 0,
      locked: 0,
      recount: 0,
    };
    this.rings.push(ring);
    this.syncFairies();
    this.countLeft(ring);
    return ring;
  }

  get fairyCount() {
    let n = 0;
    for (const r of this.rings) n += r.fairies.length;
    return n;
  }

  private makeFairy(ring: Ring | null, x: number, z: number, hue: number): Fairy {
    const f: Fairy = {
      ring,
      chunk: -1,
      pos: new THREE.Vector3(x, this.world.heightAt(x, z) + 1.5, z),
      state: 'fetch',
      seeds: 0,
      target: -1,
      tx: 0,
      tz: 0,
      wait: Math.random() * 0.5,
      hue,
      phase: Math.random() * 10,
      sparkle: 0,
      pool: null!,
    };
    f.pool = {
      get count() {
        return f.seeds;
      },
      take() {
        if (f.seeds < 1) return false;
        f.seeds--;
        return true;
      },
    };
    return f;
  }

  syncFairies() {
    const want = this.econ.fairiesPerRing;
    for (const r of this.rings) {
      while (r.fairies.length < want) {
        r.fairies.push(this.makeFairy(r, r.x, r.z, PALETTE[(this.fairyCount + r.fairies.length) % PALETTE.length]));
      }
    }
    // Wayfarers set out from the Seed Hollow.
    const h = this.stations.hollow;
    while (this.wayfarers.length < this.econ.wayfarers) {
      this.wayfarers.push(this.makeFairy(null, h.x, h.z + 2.5, WAYFARER_HUE));
    }
  }

  /** Take a ring away: its fairies (and whatever seeds they carry) go with it. */
  remove(r: Ring) {
    const i = this.rings.indexOf(r);
    if (i < 0) return;
    for (const f of r.fairies) this.release(f);
    this.group.remove(r.obj);
    this.rings.splice(i, 1);
    this.rings.forEach((ring, k) => (ring.label = `Fairy Ring ${k + 1}`));
    this.particles.burst(r.x, this.world.heightAt(r.x, r.z) + 1, r.z, 0xe0b8ff, 60, 1.5, 2);
  }

  refreshCounts() {
    for (const r of this.rings) this.countLeft(r);
  }

  nearby(pos: THREE.Vector3): Ring | null {
    for (const r of this.rings) if (wdist(r.x, r.z, pos.x, pos.z) < RING_RANGE) return r;
    return null;
  }

  private plantable(t: number) {
    const w = this.world;
    return w.isPlantable(t) && this.econ.canWork(w.soil[t] as Soil);
  }

  /** Count the tiles a ring's fairies still have to plant (for the HUD). */
  private countLeft(r: Ring) {
    const R = this.econ.ringRadius;
    const ci = Math.floor(r.x + HALF);
    const cj = Math.floor(r.z + HALF);
    const w = this.world;
    let n = 0;
    let locked = 0;
    for (let j = cj - R; j <= cj + R; j++) {
      for (let i = ci - R; i <= ci + R; i++) {
        const dx = i - ci;
        const dz = j - cj;
        if (dx * dx + dz * dz > R * R) continue;
        const t = tileIndex(i, j);
        if (!w.isPlantable(t)) continue;
        if (this.econ.canWork(w.soil[t] as Soil)) n++;
        else locked++;
      }
    }
    r.left = n;
    r.locked = locked;
  }

  /** Nearest unclaimed plantable tile to (x, z) that lies within the ring's reach. */
  private findTile(r: Ring, x: number, z: number): number {
    const R = this.econ.ringRadius;
    const ri = Math.floor(r.x + HALF);
    const rj = Math.floor(r.z + HALF);
    // Work in tile coordinates around the ring (unwrapped), indexing with wrap.
    const i0 = ri - R;
    const i1 = ri + R;
    const j0 = rj - R;
    const j1 = rj + R;
    const ci = Math.min(i1, Math.max(i0, ri + Math.round(wrap(x - r.x))));
    const cj = Math.min(j1, Math.max(j0, rj + Math.round(wrap(z - r.z))));
    const maxK = Math.max(ci - i0, i1 - ci, cj - j0, rj + R - cj);
    const test = (i: number, j: number) => {
      if (i < i0 || i > i1 || j < j0 || j > j1) return -1;
      const dx = i - ri;
      const dz = j - rj;
      if (dx * dx + dz * dz > R * R) return -1;
      const t = tileIndex(i, j);
      return !this.claimed.has(t) && this.plantable(t) ? t : -1;
    };
    // Expanding square rings around the fairy; the first hit is close enough to nearest.
    for (let k = 0; k <= maxK; k++) {
      for (let d = -k; d <= k; d++) {
        let t = test(ci + d, cj - k);
        if (t >= 0) return t;
        t = test(ci + d, cj + k);
        if (t >= 0) return t;
        if (d === -k || d === k) continue;
        t = test(ci - k, cj + d);
        if (t >= 0) return t;
        t = test(ci + k, cj + d);
        if (t >= 0) return t;
      }
    }
    return -1;
  }

  /** Bare plantable ground anywhere on the planet for a wayfarer, preferring spots no ring covers. */
  private findWild(f: Fairy): number {
    const w = this.world;
    const soils = [Soil.Dirt, Soil.Clay, Soil.Stone].filter((s) => this.econ.canWork(s));
    const R = this.econ.ringRadius;
    const half = BCHUNK / 2;
    // Spread wayfarers out: a chunk another wayfarer is working costs extra.
    const taken = new Map<number, number>();
    for (const o of this.wayfarers) if (o !== f && o.chunk >= 0) taken.set(o.chunk, (taken.get(o.chunk) ?? 0) + 1);
    const skip = new Set<number>();
    for (let attempt = 0; attempt < 6; attempt++) {
      let best = -1;
      let bestScore = Infinity;
      for (let k = 0; k < NBC * NBC; k++) {
        if (skip.has(k)) continue;
        let rem = 0;
        for (const s of soils) rem += w.remaining[k * 3 + s];
        if (rem <= 0) continue;
        const cx = (k % NBC) * BCHUNK - HALF + half;
        const cz = ((k / NBC) | 0) * BCHUNK - HALF + half;
        const d = wdist(f.pos.x, f.pos.z, cx, cz);
        const covered = this.rings.some((r) => wdist(r.x, r.z, cx, cz) + half * 1.42 < R);
        const score = d + (covered ? 3000 : 0) + (taken.get(k) ?? 0) * 250;
        if (score < bestScore) {
          bestScore = score;
          best = k;
        }
      }
      if (best < 0) return -1;
      // Nearest free tile inside that chunk.
      const i0 = (best % NBC) * BCHUNK;
      const j0 = ((best / NBC) | 0) * BCHUNK;
      let bt = -1;
      let bd = Infinity;
      for (let j = j0; j < j0 + BCHUNK; j++) {
        for (let i = i0; i < i0 + BCHUNK; i++) {
          const t = j * SIZE + i;
          if (this.claimed.has(t) || !this.plantable(t)) continue;
          const [x, z] = w.tileCenter(t);
          const d = wdist(f.pos.x, f.pos.z, x, z);
          if (d < bd) {
            bd = d;
            bt = t;
          }
        }
      }
      if (bt >= 0) {
        f.chunk = best;
        return bt;
      }
      skip.add(best);
    }
    return -1;
  }

  /** Nearest place with seeds: a hub (Hollow or waystone, bottomless) or a stocked squirrel cache. */
  private nearestSource(x: number, z: number) {
    const h = this.stations.nearestHub(x, z);
    let best: { x: number; z: number; cache: Cache | null } = {
      x: h.x,
      z: h.z + 2.6,
      cache: null,
    };
    let bestD = wdist(h.x, h.z, x, z);
    for (const c of this.stations.caches) {
      if (c.stock < 5) continue;
      const d = wdist(c.x, c.z, x, z);
      if (d < bestD) {
        bestD = d;
        best = { x: c.x, z: c.z, cache: c };
      }
    }
    return best;
  }

  private release(f: Fairy) {
    if (f.target >= 0) this.claimed.delete(f.target);
    f.target = -1;
  }

  /** Fly toward (x, z); returns true on arrival. */
  private flyTo(f: Fairy, x: number, z: number, dt: number, height: number, speedMul = 1) {
    const dx = wrap(x - f.pos.x); // the short way round
    const dz = wrap(z - f.pos.z);
    const d = Math.hypot(dx, dz);
    const step = this.econ.fairySpeed * speedMul * dt;
    if (d > 0.05) {
      const k = Math.min(1, step / d);
      f.pos.x = wrap(f.pos.x + dx * k);
      f.pos.z = wrap(f.pos.z + dz * k);
    }
    const ground = this.world.heightAt(f.pos.x, f.pos.z);
    const want = ground + (d < 3 ? height : CRUISE);
    f.pos.y += (want - f.pos.y) * Math.min(1, dt * 4);
    return d < 0.4;
  }

  update(dt: number, time: number, playerPos: THREE.Vector3) {
    for (const r of this.rings) {
      r.recount -= dt;
      if (r.recount <= 0) {
        r.recount = 3 + Math.random();
        this.countLeft(r);
      }
      for (const f of r.fairies) this.step(f, dt, time, playerPos);
    }
    for (const f of this.wayfarers) this.step(f, dt, time, playerPos);
    this.draw(time, playerPos);
  }

  private step(f: Fairy, dt: number, time: number, playerPos: THREE.Vector3) {
    const r = f.ring;
    const wild = !r;
    const carry = this.econ.fairyCarry * (wild ? WAYFARER.carryMul : 1);
    const speed = wild ? WAYFARER.speedMul : 1;
    const exhaustedUntil = r ? r.exhaustedUntil : this.wildExhaustedUntil;
    f.wait -= dt;
    switch (f.state) {
      case 'fetch': {
        const src = this.nearestSource(f.pos.x, f.pos.z);
        if (this.flyTo(f, src.x, src.z, dt, 1.6, speed)) {
          if (f.wait > 0) break;
          const need = carry - f.seeds;
          let got = need;
          if (src.cache) {
            got = Math.min(need, Math.floor(src.cache.stock));
            src.cache.stock -= got;
          }
          f.seeds += got;
          if (f.seeds >= carry * 0.5) f.state = 'seek';
          else f.wait = 0.8; // wait for the squirrels
        }
        break;
      }
      case 'seek': {
        if (time < exhaustedUntil) {
          f.state = 'idle';
          break;
        }
        const t = r ? this.findTile(r, f.pos.x, f.pos.z) : this.findWild(f);
        if (t < 0) {
          if (r) r.exhaustedUntil = time + 3;
          else this.wildExhaustedUntil = time + 4;
          f.chunk = -1;
          f.state = 'idle';
          break;
        }
        f.target = t;
        this.claimed.add(t);
        [f.tx, f.tz] = this.world.tileCenter(t);
        f.state = 'fly';
        break;
      }
      case 'fly':
        if (!this.plantable(f.target)) {
          this.release(f);
          f.state = 'seek';
        } else if (this.flyTo(f, f.tx, f.tz, dt, HOVER, speed)) f.state = 'plant';
        break;
      case 'plant':
        this.flyTo(f, f.tx, f.tz, dt, HOVER, speed);
        this.garden.workPatch(dt, f.tx, f.tz, 1.1, this.econ.fairyPower, f.pool);
        if (!this.plantable(f.target)) {
          this.release(f);
          f.state = f.seeds < 1 ? 'fetch' : 'seek';
        } else if (f.seeds < 1) {
          this.release(f);
          f.state = 'fetch';
        }
        break;
      case 'idle': {
        // Ring fairies dance around their ring; a wayfarer circles where it is.
        const a = time * 0.9 + f.phase;
        const cx = r ? r.x : f.tx;
        const cz = r ? r.z : f.tz;
        this.flyTo(f, cx + Math.cos(a) * 2.5, cz + Math.sin(a) * 2.5, dt, 1.8, speed);
        if (time >= exhaustedUntil && f.wait <= 0) {
          f.wait = 1 + Math.random();
          f.state = f.seeds < 1 ? 'fetch' : 'seek';
        }
        break;
      }
    }
    f.sparkle -= dt;
    if (f.sparkle <= 0 && f.state !== 'idle') {
      f.sparkle = wild ? 0.06 : 0.12;
      const near = wdist(playerPos.x, playerPos.z, f.pos.x, f.pos.z) < 80;
      if (near) this.particles.burst(f.pos.x, f.pos.y, f.pos.z, f.hue, 1, 0.1, 0.2);
    }
  }

  private draw(time: number, playerPos: THREE.Vector3) {
    let n = 0;
    for (const list of [...this.rings.map((r) => r.fairies), this.wayfarers]) {
      for (const f of list) {
        if (n >= MAX_FAIRIES) break;
        const size = f.ring ? 1 : 1.6;
        if (wdist(playerPos.x, playerPos.z, f.pos.x, f.pos.z) > DRAW_DIST) continue;
        const bob = Math.sin(time * 5 + f.phase) * 0.12;
        const heading =
          f.state === 'plant' ? time * 2 + f.phase : Math.atan2(wrap(f.tx - f.pos.x), wrap(f.tz - f.pos.z));
        this.v.set(f.pos.x, f.pos.y + bob, f.pos.z);
        this.m4.makeScale(size, size, size).setPosition(this.v);
        this.bodies.setMatrixAt(n, this.m4);
        this.bodies.setColorAt(n, this.col.set(f.hue));
        const flap = Math.sin(time * 38 + f.phase) * 0.7;
        for (const side of [-1, 1]) {
          this.e.set(0, heading + (side < 0 ? Math.PI : 0), side * (0.5 + flap), 'YXZ');
          this.q.setFromEuler(this.e);
          this.s.setScalar(size);
          this.m4.compose(this.v, this.q, this.s);
          this.wings.setMatrixAt(n * 2 + (side < 0 ? 0 : 1), this.m4);
        }
        n++;
      }
    }
    this.bodies.count = n;
    this.wings.count = n * 2;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
  }
}
