import * as THREE from 'three';
import { Economy, MountDef, MountId, SOILS, ToolId } from './economy';
import { Chimes, Particles } from './fx';
import { Flowers } from './flowers';
import { DeadScenery, HeartTrees } from './props';
import { Glade, HALF, SIZE, Soil, SOIL_NAMES, World } from './world';

// Core loop: apply planting effort to tiles under the cursor, grow seeded tiles,
// bloom them into flowers + pollen, and restore whole glades.

export const COMPLETE_AT = 0.9;
const SAVE_KEY = 'druid-grove-save-v2';

export type AimStatus = 'none' | 'ok' | 'far' | 'locked' | 'creek' | 'done' | 'empty';

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

  constructor(
    private world: World,
    private econ: Economy,
    private flowers: Flowers,
    private hearts: HeartTrees,
    private scenery: DeadScenery,
    private particles: Particles,
    private chimes: Chimes,
    private events: GardenEvents,
  ) {}

  // March along the camera ray until it dips below the heightfield.
  updateAim(camera: THREE.Camera, player: THREE.Vector3) {
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    this.aimValid = false;
    let prev = 0;
    const maxDist = 400;
    for (let d = 0.2; d < maxDist; d += d < 20 ? 0.1 : 0.5) {
      this.tmp.copy(origin).addScaledVector(dir, d);
      if (Math.abs(this.tmp.x) > HALF || Math.abs(this.tmp.z) > HALF) {
        if (d > 5) break;
        prev = d;
        continue;
      }
      if (this.tmp.y <= this.world.heightAt(this.tmp.x, this.tmp.z)) {
        // refine
        let a = prev;
        let b = d;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          this.tmp.copy(origin).addScaledVector(dir, m);
          if (this.tmp.y <= this.world.heightAt(this.tmp.x, this.tmp.z)) b = m;
          else a = m;
        }
        this.aim.copy(origin).addScaledVector(dir, b);
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
    const dist = Math.hypot(this.aim.x - player.x, this.aim.z - player.z);
    if (dist > this.econ.reach + this.econ.tool.radius) this.aimStatus = 'far';
    else if (soil === Soil.Creek) this.aimStatus = 'creek';
    else if (!this.econ.canWork(soil)) this.aimStatus = 'locked';
    else if (this.world.seeded[t] && this.econ.tool.radius === 0) this.aimStatus = 'done';
    else if (this.econ.activeSeeds < 1) this.aimStatus = 'empty';
    else this.aimStatus = 'ok';
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
        if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) continue;
        const t = j * SIZE + i;
        const [x, z] = this.world.tileCenter(t);
        if (t === t0 || Math.hypot(x - this.aim.x, z - this.aim.z) <= r) out.push(t);
      }
    }
    return out;
  }

  /** Apply planting effort while the mouse is held. Returns true if anything was worked. */
  work(dt: number) {
    if (this.aimStatus !== 'ok') return false;
    return this.workTiles(this.tilesUnderCursor(), this.econ.power, dt);
  }

  /** Mounts plant everything in a circle around themselves, no clicking needed. */
  workMount(dt: number, x: number, z: number, m: MountDef) {
    const tiles: number[] = [];
    const r = m.radius;
    const ci = Math.floor(x + HALF);
    const cj = Math.floor(z + HALF);
    const ri = Math.ceil(r);
    for (let j = cj - ri; j <= cj + ri; j++) {
      for (let i = ci - ri; i <= ci + ri; i++) {
        if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) continue;
        const t = j * SIZE + i;
        const [tx, tz] = this.world.tileCenter(t);
        if (Math.hypot(tx - x, tz - z) <= r) tiles.push(t);
      }
    }
    return this.workTiles(tiles, m.power, dt);
  }

  private workTiles(tiles: number[], power: number, dt: number) {
    const w = this.world;
    let any = false;
    for (const t of tiles) {
      const soil = w.soil[t] as Soil;
      if (!w.isPlantable(t) || !this.econ.canWork(soil)) continue;
      // A tile only takes effort while there's a seed to put in it.
      if (this.econ.activeSeeds < 1) break;
      w.work[t] += (power * dt) / SOILS[soil].hardness;
      any = true;
      if (w.work[t] >= 1) {
        if (!this.econ.takeSeed()) {
          w.work[t] = 0.99;
          break;
        }
        w.work[t] = 1;
        w.seeded[t] = 1;
        w.growth[t] = 0;
        w.growing.add(t);
        const [x, z] = w.tileCenter(t);
        this.particles.burst(x, w.heightAt(x, z), z, 0x8a6a45, 4, 0.8, 0.8);
      }
      w.markDirty(t);
    }
    const now = performance.now();
    if (any && now - this.lastTick > 140) {
      this.lastTick = now;
      this.chimes.plantTick();
    }
    return any;
  }

  update(dt: number, time: number) {
    const w = this.world;
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
    const w = this.world;
    this.scenery.clearTile(t);
    const g = w.glades[w.gladeOf[t]];
    const [cx, cz] = w.tileCenter(t);
    const n = 1 + Math.floor(Math.random() * 3);
    const small = g.soil === Soil.Stone ? 0.75 : 1;
    for (let k = 0; k < n; k++) {
      const x = cx + (Math.random() - 0.5) * 0.9;
      const z = cz + (Math.random() - 0.5) * 0.9;
      const col = g.palette[Math.floor(Math.random() * g.palette.length)];
      this.flowers.addFlower(x, w.heightAt(x, z), z, col, (0.75 + Math.random() * 0.55) * small, time + k * 0.12);
    }
    const tx = cx + (Math.random() - 0.5) * 0.7;
    const tz = cz + (Math.random() - 0.5) * 0.7;
    this.flowers.addTuft(tx, w.heightAt(tx, tz), tz, 0.8 + Math.random() * 0.35, time);
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
      this.chimes.bloom();
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
    for (let t = 0; t < SIZE * SIZE; t++) {
      if (w.gladeOf[t] !== g.id) continue;
      if (w.soil[t] === Soil.Creek) {
        w.wet[t] = 1;
        w.markDirty(t);
        continue;
      }
      if (w.seeded[t]) continue;
      const [x, z] = w.tileCenter(t);
      w.seeded[t] = 1;
      w.work[t] = 1;
      w.growth[t] = -Math.hypot(x - hx, z - hz) * 0.05 - Math.random() * 0.3;
      w.growing.add(t);
    }
    this.wetNeighbouringCreeks(g);
  }

  private wetNeighbouringCreeks(g: Glade) {
    const w = this.world;
    for (let t = 0; t < SIZE * SIZE; t++) {
      if (w.soil[t] !== Soil.Creek || w.wet[t]) continue;
      const i = t % SIZE;
      const nb = [i > 0 ? t - 1 : -1, i < SIZE - 1 ? t + 1 : -1, t - SIZE, t + SIZE];
      if (nb.some((n) => n >= 0 && n < SIZE * SIZE && w.gladeOf[n] === g.id)) {
        w.wet[t] = 1;
        w.markDirty(t);
      }
    }
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
        return 'Out of seeds. Refill at the Seed Hollow or a squirrel cache.';
      case 'creek':
        return 'A dry creek bed. Restore the glade to bring water back.';
      default:
        return '';
    }
  }

  // ---------- save / load ----------

  save(player: { pos: THREE.Vector3; yaw: number }, extra: unknown) {
    const w = this.world;
    const bytes = new Uint8Array(SIZE * SIZE);
    for (let t = 0; t < SIZE * SIZE; t++) bytes[t] = w.seeded[t] ? 255 : Math.floor(w.work[t] * 200);
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
      const bin = atob(d.tiles);
      const completed = new Set<number>(d.completed);
      for (let t = 0; t < SIZE * SIZE; t++) {
        const b = bin.charCodeAt(t);
        if (b === 255) {
          w.seeded[t] = 1;
          w.work[t] = 1;
          w.growth[t] = 1;
          w.bloomed[t] = 1;
          w.glades[w.gladeOf[t]].bloomed++;
          this.spawnFlora(t, -100);
        } else {
          w.work[t] = b / 200;
        }
        w.markDirty(t);
      }
      for (const g of w.glades) {
        if (completed.has(g.id)) {
          g.completed = true;
          this.hearts.complete(g, 0, true);
          for (let t = 0; t < SIZE * SIZE; t++) {
            if (w.gladeOf[t] === g.id && w.soil[t] === Soil.Creek) {
              w.wet[t] = 1;
              w.markDirty(t);
            }
          }
          this.wetNeighbouringCreeks(g);
        }
      }
      player.pos.x = d.pos[0];
      player.pos.z = d.pos[1];
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
