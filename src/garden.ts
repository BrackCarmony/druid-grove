import * as THREE from 'three';
import { Economy, MountDef, MountId, SOILS, ToolId } from './economy';
import { Chimes, Particles } from './fx';
import { Flowers } from './flowers';
import { DeadScenery, HeartTrees } from './props';
import { curveDrop } from './planet';
import { Glade, HALF, SIZE, Soil, SOIL_NAMES, tileIndex, wdist, World, wrap } from './world';

// Core loop: apply planting effort to tiles under the cursor, grow seeded tiles,
// bloom them into flowers + pollen, and restore whole glades.

export const COMPLETE_AT = 0.9;
const SAVE_KEY = 'druid-grove-planet-v3';
/** Every tile of a glade lies within this many metres of its seed (cell + jitter + border warp). */
const GLADE_REACH = 58;

export type AimStatus = 'none' | 'ok' | 'far' | 'locked' | 'creek' | 'done' | 'empty';

/** Where planted seeds come from: the nymph's satchel, a mount's sack, or a fairy's basket. */
export interface SeedPool {
  readonly count: number;
  take(): boolean;
}

export interface GardenEvents {
  toast(msg: string, big?: boolean): void;
  earned(amount: number): void;
}

export class Garden {
  aim = new THREE.Vector3();
  aimValid = false;
  aimStatus: AimStatus = 'none';
  aimSoil: Soil = Soil.Dirt;
  private tmp = new THREE.Vector3();
  private lastTick = 0;
  // Tiles waiting their turn in a restored glade's outward bloom, bucketed by the
  // quarter-second they start growing. Kept out of world.growing so the per-frame
  // loop only touches tiles that are actually growing (a big batch of restored
  // glades used to queue tens of thousands of idle tiles there).
  private pending = new Map<number, number[]>();
  private nextBucket = -1;
  private now = 0;
  /** Tiles planted by fairies: they bloom without a chime so automation doesn't drown out the player. */
  private quiet = new Set<number>();
  private econPool: SeedPool;

  constructor(
    private world: World,
    private econ: Economy,
    private flowers: Flowers,
    private hearts: HeartTrees,
    private scenery: DeadScenery,
    private particles: Particles,
    private chimes: Chimes,
    private events: GardenEvents,
  ) {
    const e = this.econ;
    this.econPool = {
      get count() {
        return e.activeSeeds;
      },
      take: () => e.takeSeed(),
    };
  }

  // March along the camera ray until it dips below the (planet-curved) ground.
  updateAim(camera: THREE.Camera, player: THREE.Vector3) {
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    this.aimValid = false;
    let prev = 0;
    const maxDist = 400;
    for (let d = 0.2; d < maxDist; d += d < 20 ? 0.1 : 0.5) {
      this.tmp.copy(origin).addScaledVector(dir, d);
      if (this.below(this.tmp, origin)) {
        // refine
        let a = prev;
        let b = d;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          this.tmp.copy(origin).addScaledVector(dir, m);
          if (this.below(this.tmp, origin)) b = m;
          else a = m;
        }
        this.aim.copy(origin).addScaledVector(dir, b);
        this.aim.x = wrap(this.aim.x);
        this.aim.z = wrap(this.aim.z);
        this.aimValid = true;
        break;
      }
      prev = d;
    }

    if (!this.aimValid) {
      this.aimStatus = 'none';
      return;
    }
    const t = this.world.tileAt(this.aim.x, this.aim.z);
    const soil = t >= 0 ? (this.world.soil[t] as Soil) : Soil.Creek;
    this.aimSoil = soil === Soil.Creek && t >= 0 ? this.world.glades[this.world.gladeOf[t]].soil : soil;
    const dist = wdist(player.x, player.z, this.aim.x, this.aim.z);
    if (dist > this.econ.reach + this.econ.tool.radius) this.aimStatus = 'far';
    else if (soil === Soil.Creek) this.aimStatus = 'creek';
    else if (!this.econ.canWork(soil)) this.aimStatus = 'locked';
    else if (this.world.seeded[t] && this.econ.tool.radius === 0) this.aimStatus = 'done';
    else if (this.econ.activeSeeds < 1) this.aimStatus = 'empty';
    else this.aimStatus = 'ok';
  }

  private below(p: THREE.Vector3, eye: THREE.Vector3) {
    const d = Math.hypot(p.x - eye.x, p.z - eye.z);
    return p.y <= this.world.heightAt(p.x, p.z) - curveDrop(d);
  }

  tilesUnderCursor(): number[] {
    const out: number[] = [];
    const r = this.econ.tool.radius;
    const t0 = this.world.tileAt(this.aim.x, this.aim.z);
    if (r === 0) {
      if (t0 >= 0) out.push(t0);
      return out;
    }
    const ri = Math.ceil(r);
    const ci = Math.floor(this.aim.x + HALF);
    const cj = Math.floor(this.aim.z + HALF);
    for (let j = cj - ri; j <= cj + ri; j++) {
      for (let i = ci - ri; i <= ci + ri; i++) {
        const t = tileIndex(i, j);
        const [x, z] = this.world.tileCenter(t);
        if (t === t0 || wdist(this.aim.x, this.aim.z, x, z) <= r) out.push(t);
      }
    }
    return out;
  }

  /** Apply planting effort while the mouse is held. Returns true if anything was worked. */
  work(dt: number) {
    if (this.aimStatus !== 'ok') return false;
    return this.workTiles(this.tilesUnderCursor(), this.econ.power, dt, this.econPool, true);
  }

  /** Mounts plant everything in a circle around themselves, no clicking needed. */
  workMount(dt: number, x: number, z: number, m: MountDef) {
    return this.workTiles(this.tilesInCircle(x, z, m.radius), this.econ.mountPower(m), dt, this.econPool, true);
  }

  /** Fairies plant a small patch with seeds from their own basket. */
  workPatch(dt: number, x: number, z: number, r: number, power: number, pool: SeedPool) {
    return this.workTiles(this.tilesInCircle(x, z, r), power, dt, pool, false);
  }

  tilesInCircle(x: number, z: number, r: number) {
    const tiles: number[] = [];
    const ci = Math.floor(x + HALF);
    const cj = Math.floor(z + HALF);
    const ri = Math.ceil(r);
    for (let j = cj - ri; j <= cj + ri; j++) {
      for (let i = ci - ri; i <= ci + ri; i++) {
        const t = tileIndex(i, j);
        const [tx, tz] = this.world.tileCenter(t);
        if (wdist(x, z, tx, tz) <= r) tiles.push(t);
      }
    }
    return tiles;
  }

  private workTiles(tiles: number[], power: number, dt: number, pool: SeedPool, audible: boolean) {
    const w = this.world;
    let any = false;
    for (const t of tiles) {
      const soil = w.soil[t] as Soil;
      if (!w.isPlantable(t) || !this.econ.canWork(soil)) continue;
      // A tile only takes effort while there's a seed to put in it.
      if (pool.count < 1) break;
      w.work[t] += (power * dt) / SOILS[soil].hardness;
      any = true;
      if (w.work[t] >= 1) {
        if (!pool.take()) {
          w.work[t] = 0.99;
          break;
        }
        w.work[t] = 1;
        w.setSeeded(t);
        w.growth[t] = 0;
        w.growing.add(t);
        if (!audible) this.quiet.add(t);
        const [x, z] = w.tileCenter(t);
        this.particles.burst(x, w.heightAt(x, z), z, 0x8a6a45, 4, 0.8, 0.8);
      }
      w.markDirty(t);
    }
    const now = performance.now();
    if (any && audible && now - this.lastTick > 140) {
      this.lastTick = now;
      this.chimes.plantTick();
    }
    return any;
  }

  update(dt: number, time: number) {
    const w = this.world;
    this.now = time;
    const due = Math.floor(time * 4);
    if (this.nextBucket < 0) this.nextBucket = due;
    for (; this.nextBucket <= due; this.nextBucket++) {
      const list = this.pending.get(this.nextBucket);
      if (!list) continue;
      this.pending.delete(this.nextBucket);
      for (const t of list) {
        if (w.bloomed[t] || w.growing.has(t)) continue;
        w.growth[t] = 0;
        w.growing.add(t);
      }
    }
    const rate = dt / this.econ.growTime;
    for (const t of w.growing) {
      w.growth[t] += rate;
      if (w.growth[t] >= 1) {
        w.growth[t] = 1;
        w.growing.delete(t);
        this.bloom(t, time, false);
      }
      if (w.growth[t] >= 0) w.markDirty(t);
    }
  }

  private spawnFlora(t: number, time: number) {
    this.scenery.clearTile(t);
    this.flowers.bloomTile(t, time);
  }

  /** Visit every tile of a glade (they all sit within GLADE_REACH of its seed). */
  private gladeTiles(g: Glade, fn: (t: number) => void, pad = 0) {
    const ci = Math.floor(g.seedX + HALF);
    const cj = Math.floor(g.seedZ + HALF);
    const R = GLADE_REACH + pad;
    for (let j = cj - R; j <= cj + R; j++) {
      for (let i = ci - R; i <= ci + R; i++) fn(tileIndex(i, j));
    }
  }

  private bloom(t: number, time: number, silent: boolean) {
    const w = this.world;
    w.bloomed[t] = 1;
    w.markDirty(t);
    this.spawnFlora(t, time);
    const g = w.glades[w.gladeOf[t]];
    g.bloomed++;
    const gained = this.econ.earn(SOILS[g.soil].yield);
    this.events.earned(gained);
    if (!silent) {
      const [x, z] = w.tileCenter(t);
      this.particles.burst(x, w.heightAt(x, z) + 0.3, z, 0xffe27a, 3);
      if (!this.quiet.delete(t)) this.chimes.bloom();
    }
    if (!g.completed && g.bloomed >= g.total * COMPLETE_AT) this.completeGlade(g, time);
  }

  private completeGlade(g: Glade, time: number) {
    const w = this.world;
    g.completed = true;
    const bonus = this.econ.earn(Math.ceil(g.total * SOILS[g.soil].yield * 0.5));
    this.econ.multiplier = +(this.econ.multiplier + 0.1).toFixed(2);
    this.events.earned(bonus);
    this.events.toast(
      `${g.name} restored!  +${Math.floor(bonus)} pollen · pollen ×${this.econ.multiplier.toFixed(1)}`,
      true,
    );
    this.chimes.fanfare();
    this.hearts.complete(g, time);
    const [hx, hz] = w.tileCenter(g.heartTile);
    this.particles.burst(hx, w.heightAt(hx, hz) + 1, hz, 0xd8ffb0, 250, 6, 4);

    // The rest of the glade flourishes outward from the heart.
    this.gladeTiles(g, (t) => {
      if (w.gladeOf[t] !== g.id) return;
      if (w.soil[t] === Soil.Creek) {
        w.wet[t] = 1;
        w.markDirty(t);
        return;
      }
      if (w.seeded[t]) return;
      const [x, z] = w.tileCenter(t);
      w.setSeeded(t);
      w.work[t] = 1;
      // Bloom spreads outward from the heart: farther tiles start later.
      const wait = (wdist(hx, hz, x, z) * 0.05 + Math.random() * 0.3) * this.econ.growTime;
      w.growth[t] = -1; // seeded but not yet sprouting
      const b = Math.max(this.nextBucket, Math.floor((time + wait) * 4));
      let list = this.pending.get(b);
      if (!list) this.pending.set(b, (list = []));
      list.push(t);
    });
    this.wetNeighbouringCreeks(g);
  }

  private wetNeighbouringCreeks(g: Glade) {
    const w = this.world;
    this.gladeTiles(
      g,
      (t) => {
        if (w.soil[t] !== Soil.Creek || w.wet[t]) return;
        const i = t % SIZE;
        const j = (t / SIZE) | 0;
        const nb = [tileIndex(i - 1, j), tileIndex(i + 1, j), tileIndex(i, j - 1), tileIndex(i, j + 1)];
        if (nb.some((n) => w.gladeOf[n] === g.id)) {
          w.wet[t] = 1;
          w.markDirty(t);
        }
      },
      2,
    );
  }

  currentGlade(x: number, z: number): Glade | null {
    const t = this.world.tileAt(x, z);
    return t >= 0 ? this.world.glades[this.world.gladeOf[t]] : null;
  }

  aimHint(): string {
    switch (this.aimStatus) {
      case 'far':
        return 'Too far away. Move closer.';
      case 'locked': {
        const u = SOILS[this.aimSoil].unlock;
        return `${SOIL_NAMES[this.aimSoil]} is too hard. Needs ${u === 'worms' ? 'Earthworm Charm' : 'Moss Spores'}.`;
      }
      case 'empty':
        return 'Out of seeds. Refill at the Seed Hollow, a waystone or a squirrel cache.';
      case 'creek':
        return 'A dry creek bed. Restore the glade to bring water back.';
      default:
        return '';
    }
  }

  // ---------- save / load ----------

  save(player: { pos: THREE.Vector3; yaw: number }, extra: unknown) {
    const w = this.world;
    // Tiles are run-length encoded as (value, count) byte pairs: a planet is mostly long runs.
    const runs: number[] = [];
    let prev = -1;
    let count = 0;
    for (let t = 0; t <= SIZE * SIZE; t++) {
      const b = t < SIZE * SIZE ? (w.seeded[t] ? 255 : Math.floor(w.work[t] * 200)) : -2;
      if (b === prev && count < 255) count++;
      else {
        if (count) runs.push(prev, count);
        prev = b;
        count = 1;
      }
    }
    const bytes = Uint8Array.from(runs);
    let bin = '';
    for (let k = 0; k < bytes.length; k += 4096) bin += String.fromCharCode(...bytes.subarray(k, k + 4096));
    const data = {
      pollen: this.econ.pollen,
      lifetime: this.econ.lifetimePollen,
      multiplier: this.econ.multiplier,
      tools: [...this.econ.tools],
      mounts: [...this.econ.mounts],
      seeds: this.econ.seeds,
      mountSeeds: this.econ.mountSeeds,
      riding: this.econ.riding,
      autoPlant: this.econ.autoPlant,
      cachesBuilt: this.econ.cachesBuilt,
      honey: this.econ.honey,
      lifetimeHoney: this.econ.lifetimeHoney,
      hivesBuilt: this.econ.hivesBuilt,
      bears: this.econ.bears,
      ringsBuilt: this.econ.ringsBuilt,
      densBuilt: this.econ.densBuilt,
      stonesBuilt: this.econ.stonesBuilt,
      wayfarers: this.econ.wayfarers,
      extra,
      current: this.econ.current,
      levels: this.econ.levels,
      completed: w.glades.filter((g) => g.completed).map((g) => g.id),
      pos: [player.pos.x, player.pos.z, player.yaw],
      tiles: btoa(bin),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: progress just won't persist */
    }
  }

  load(player: { pos: THREE.Vector3; yaw: number }): { extra: unknown } | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const w = this.world;
      this.econ.pollen = d.pollen;
      this.econ.lifetimePollen = d.lifetime;
      this.econ.multiplier = d.multiplier;
      this.econ.tools = new Set<ToolId>(d.tools);
      this.econ.current = d.current;
      this.econ.levels = d.levels;
      this.econ.mounts = new Set<MountId>(d.mounts ?? []);
      this.econ.seeds = d.seeds ?? this.econ.seedCap;
      this.econ.mountSeeds = d.mountSeeds ?? {};
      this.econ.riding = d.riding ?? null;
      this.econ.autoPlant = d.autoPlant ?? true;
      this.econ.cachesBuilt = d.cachesBuilt ?? 0;
      this.econ.honey = d.honey ?? 0;
      this.econ.lifetimeHoney = d.lifetimeHoney ?? 0;
      this.econ.hivesBuilt = d.hivesBuilt ?? 0;
      this.econ.bears = d.bears ?? 0;
      this.econ.ringsBuilt = d.ringsBuilt ?? 0;
      this.econ.densBuilt = d.densBuilt ?? 0;
      this.econ.stonesBuilt = d.stonesBuilt ?? 0;
      this.econ.wayfarers = d.wayfarers ?? 0;
      const bin = atob(d.tiles);
      const tiles = new Uint8Array(SIZE * SIZE);
      for (let k = 0, t = 0; k < bin.length; k += 2) {
        const v = bin.charCodeAt(k);
        tiles.fill(v, t, t + bin.charCodeAt(k + 1));
        t += bin.charCodeAt(k + 1);
      }
      const completed = new Set<number>(d.completed);
      for (let t = 0; t < SIZE * SIZE; t++) {
        const b = tiles[t];
        if (b === 255) {
          w.setSeeded(t);
          w.work[t] = 1;
          w.growth[t] = 1;
          w.bloomed[t] = 1;
          w.glades[w.gladeOf[t]].bloomed++;
          this.scenery.clearTile(t); // flowers stream in from the bloom state on their own
        } else {
          w.work[t] = b / 200;
        }
        w.markDirty(t);
      }
      for (const g of w.glades) {
        if (completed.has(g.id)) {
          g.completed = true;
          this.hearts.complete(g, 0, true);
          this.gladeTiles(g, (t) => {
            if (w.gladeOf[t] === g.id && w.soil[t] === Soil.Creek) {
              w.wet[t] = 1;
              w.markDirty(t);
            }
          });
          this.wetNeighbouringCreeks(g);
        }
      }
      player.pos.x = wrap(d.pos[0]);
      player.pos.z = wrap(d.pos[1]);
      player.pos.y = w.heightAt(d.pos[0], d.pos[1]);
      player.yaw = d.pos[2];
      return { extra: d.extra };
    } catch (e) {
      console.warn('Could not load save', e);
      return null;
    }
  }

  static wipe() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
}
