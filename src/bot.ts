import type { Apiary } from './apiary';
import { Economy, MOUNTS, SOILS, TOOLS, UPGRADES } from './economy';
import type { FairyRings } from './fairies';
import type { Garden } from './garden';
import type { Obelisk } from './obelisk';
import type { Player } from './player';
import type { Stations } from './stations';
import type { Waystone, Waystones } from './waystones';
import { Glade, HALF, Soil, tileIndex, wdist, World, wrap } from './world';

// The pacing bot: plays a fresh world on its own, fast-forwarded, the way a sensible player
// might (finish the nearest glade, refill when empty, walk to the obelisk to shop, build
// caches, hives and rings), and logs when everything happened. It drives the real game: the
// same movement, planting, shop buttons and build functions a player uses. Only the aiming is
// direct (it points at a tile rather than turning a camera).
//
// Open the game with ?bot=1 (on the dev server). Options:
//   speed=N    simulation steps per frame (each 0.05 s of game time; default 60)
//   hours=N    stop after this much game time (default 12)
//   seed=N     random seed for the bot's choices (default 1)
//   travelzoom=0  don't zoom out to travel faster (a player who never zooms out)
// When it stops, the report goes to bot-runs/ (via the dev server) and to window.dgBot.report.

export interface BotHost {
  econ: Economy;
  world: World;
  garden: Garden;
  player: Player;
  stations: Stations;
  waystones: Waystones;
  apiary: Apiary;
  fairies: FairyRings;
  obelisks(): Obelisk[];
  setMouse(on: boolean): void;
  selectSlot(i: number): void;
  openShop(): void;
  closeMenu(): void;
  /** Build at a spot (sets the aim there first). Returns whether it was built. */
  build(kind: BuildKind, x: number, z: number): boolean;
  /** Why nothing can be built here (the game's own placement rules), or null. */
  canPlace(x: number, z: number): string | null;
  planet(): { pct: number; done: number; total: number };
  playTime(): number;
  ended(): boolean;
  travel(st: Waystone): void;
  /** Take up the fairy rings with nothing left to do (refunding honey). Returns how many. */
  removeFinishedRings(): number;
}

type BuildKind = 'cache' | 'hive' | 'ring' | 'waystone';
type Mode = 'plant' | 'toRefill' | 'refill' | 'toShop' | 'toBuild' | 'idle';

interface Want {
  kind: 'shop' | 'build';
  /** Card name in the shop (shop) or what to build. */
  name: string;
  build?: BuildKind;
  cost: number;
  currency: 'pollen' | 'honey';
  /** Where to build. */
  at?: [number, number];
}

export interface BotEvent {
  t: number; // game seconds
  type: 'buy' | 'build' | 'recall' | 'travel' | 'glade' | 'end' | 'stop' | 'note';
  name: string;
  cost?: number;
  currency?: string;
  pollen: number;
  honey: number;
  pct: number;
}

export interface BotSnapshot {
  t: number;
  pollen: number;
  lifetimePollen: number;
  honey: number;
  lifetimeHoney: number;
  pct: number;
  glades: number;
  mult: number;
  mount: string;
  tool: string;
}

export interface BotReport {
  started: string;
  options: Record<string, string | number | boolean>;
  realSeconds: number;
  gameSeconds: number;
  finished: boolean;
  events: BotEvent[];
  snapshots: BotSnapshot[];
  /** Game seconds spent in each activity. */
  modes: Record<string, number>;
  stuck: number;
  travels?: number;
}

const MILESTONES = new Set(['glove', 'rake', 'tortoise', 'worms', 'moss', 'stag']);
const UNWORKED_SCAN_R = 58; // every tile of a glade lies within this of its seed

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Bot {
  readonly speed: number;
  readonly hours: number;
  readonly travelZoom: boolean;
  fast = true;
  mode: Mode = 'idle';
  report: BotReport;
  private rand: () => number;
  private h: BotHost;
  private focus: Glade | null = null;
  private exhausted = new Set<number>(); // glades with nothing left to plant (for now)
  private blocked = new Set<number>(); // tiles it couldn't reach
  private failedSpots: [number, number][] = []; // places a build was refused
  private target = -1; // tile
  private retarget = 0;
  private dest: [number, number] | null = null;
  private stuckT = 0;
  private bestD = Infinity;
  private dodge = 0;
  private dodgeDir = 1;
  private fails = 0;
  private refillWait = 0;
  private refillLast = 0;
  private want: Want | null = null;
  private wantT = 0;
  private ringCheck = 0;
  private travels = 0;
  private lastGlades = 0;
  private snapT = 0;
  private realStart = performance.now();
  private overlay: HTMLElement;
  private done = false;

  constructor(host: BotHost, q: URLSearchParams) {
    this.h = host;
    this.speed = Number(q.get('speed') ?? 60);
    this.hours = Number(q.get('hours') ?? 12);
    this.travelZoom = q.get('travelzoom') !== '0';
    const seed = Number(q.get('seed') ?? 1);
    this.rand = mulberry(seed);
    this.report = {
      started: new Date().toISOString(),
      options: { speed: this.speed, hours: this.hours, seed, travelZoom: this.travelZoom },
      realSeconds: 0,
      gameSeconds: 0,
      finished: false,
      events: [],
      snapshots: [],
      modes: {},
      stuck: 0,
    };
    this.overlay = document.createElement('div');
    this.overlay.id = 'bot-overlay';
    this.overlay.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:99;background:rgba(0,0,0,.65);color:#dfd;font:12px/1.4 monospace;padding:8px 10px;border-radius:6px;max-width:340px;white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(this.overlay);
    host.econ.autoPlant = true;
  }

  // ---------- helpers ----------

  private get pos() {
    return this.h.player.pos;
  }
  private dist(x: number, z: number) {
    return wdist(this.pos.x, this.pos.z, x, z);
  }
  private log(type: BotEvent['type'], name: string, cost?: number, currency?: string) {
    const e = this.h.econ;
    this.report.events.push({
      t: Math.round(this.h.playTime()),
      type,
      name,
      cost,
      currency,
      pollen: Math.round(e.pollen),
      honey: Math.round(e.honey),
      pct: +this.h.planet().pct.toFixed(2),
    });
  }

  /**
   * Head for a spot, going by waystone when that's much shorter. Returns true once within r.
   * `cruise` (m/s) keeps going at that speed instead of slowing to stop on the spot.
   */
  private go(x: number, z: number, r: number, dt: number, cruise?: number) {
    const stones = this.h.waystones.stones;
    const d = this.dist(x, z);
    if (stones.length > 1 && d > 60) {
      let a = stones[0];
      let b = stones[0];
      for (const s of stones) {
        if (this.dist(s.x, s.z) < this.dist(a.x, a.z)) a = s;
        if (wdist(s.x, s.z, x, z) < wdist(b.x, b.z, x, z)) b = s;
      }
      if (a !== b && this.dist(a.x, a.z) + wdist(b.x, b.z, x, z) + 20 < d) {
        if (this.h.waystones.nearby(this.pos) === a) {
          this.h.travel(b);
          this.travels++;
          this.bestD = Infinity;
          return false;
        }
        const [ax, az] = this.h.waystones.arrival(a);
        this.moveTo(ax, az, 0.8, dt);
        return false;
      }
    }
    return this.moveTo(x, z, r, dt, cruise);
  }

  /** Walk (or ride) straight toward a spot. Returns true once within r. */
  private moveTo(x: number, z: number, r: number, dt: number, cruise?: number) {
    const p = this.h.player;
    const dx = wrap(x - p.pos.x);
    const dz = wrap(z - p.pos.z);
    const d = Math.hypot(dx, dz);
    if (d <= r) {
      p.stick.set(0, 0);
      p.stickRun = false;
      this.stuckT = 0;
      this.bestD = Infinity;
      return true;
    }
    // Zooming out speeds walking up (as it does for players); zoom back in to plant.
    p.zoomTarget = this.travelZoom && d > 40 ? 60 : 4;
    p.yaw = Math.atan2(-dx, -dz);
    // Run when far; ease off the stick close in so a heavy mount doesn't overshoot and circle.
    p.stickRun = d > 10;
    let push = Math.min(1, Math.max(0.3, (d - r) / 5));
    if (cruise !== undefined) {
      // Hold a steady speed: slow enough for the ground to take seed as it passes under.
      const m = this.h.econ.mount;
      const zf = 1 + Math.min(p.zoom, 60) / 30;
      const walk = (m ? m.speed : 4.2) * zf;
      p.stickRun = cruise >= walk;
      push = p.stickRun ? 1 : Math.min(1, Math.max(0.3, cruise / walk));
    }
    // Not getting closer: hop and sidestep round whatever's in the way.
    if (d < this.bestD - 0.5) {
      this.bestD = d;
      this.stuckT = 0;
    } else this.stuckT += dt;
    if (this.stuckT > 2 && this.dodge <= 0) {
      this.dodge = 0.8 + this.rand() * 0.8;
      this.dodgeDir = this.rand() < 0.5 ? -1 : 1;
      this.stuckT = 0;
      this.bestD = d;
      this.fails++;
      this.report.stuck++;
    }
    if (this.dodge > 0) {
      this.dodge -= dt;
      p.stick.set(this.dodgeDir, 0.3);
      if (this.dodge > 0.6) p.keys.add('Space');
      else p.keys.delete('Space');
    } else {
      p.keys.delete('Space');
      p.stick.set(0, push);
    }
    return false;
  }

  private stop() {
    const p = this.h.player;
    p.stick.set(0, 0);
    p.stickRun = false;
    p.keys.delete('Space');
    this.h.setMouse(false);
  }

  // ---------- what to buy ----------

  /** The best next thing to spend on, for one currency: cheapest after weighting. */
  private pickWant(currency: 'pollen' | 'honey'): Want | null {
    const e = this.h.econ;
    const mounted = e.mounts.size > 0;
    const c: (Want & { w: number })[] = [];
    const add = (w: Want, weight: number) => {
      if (w.currency === currency && weight > 0 && isFinite(w.cost)) c.push({ ...w, w: weight });
    };
    for (const t of TOOLS)
      if (!e.tools.has(t.id) && t.cost > 0) add({ kind: 'shop', name: t.name, cost: t.cost, currency: 'pollen' }, 0.25);
    for (const m of MOUNTS)
      if (!e.mounts.has(m.id) && e.has(m.requires))
        add({ kind: 'shop', name: m.name, cost: m.cost, currency: 'pollen' }, 0.25);
    for (const u of UPGRADES) {
      if (e.level(u.id) >= u.max || (u.requires && !e.has(u.requires))) continue;
      if (u.id === 'armor') continue; // cosmetic
      let w = MILESTONES.has(u.id) ? 0.25 : 1;
      // Hand-only upgrades stop mattering once she rides everywhere.
      if (mounted && (u.id === 'reach' || u.id === 'satchel')) continue;
      if (mounted && u.id === 'fingers') w = 3;
      if (u.group === 'squirrels') w = 1.5;
      if (u.id === 'combs' || u.id === 'trails') w = 1.5;
      if (u.id === 'trample') w = 1;
      add({ kind: 'shop', name: u.name, cost: e.upgradeCost(u), currency: u.currency ?? 'pollen' }, w);
    }
    if (e.has('hive') && e.bears < this.h.apiary.hives.length)
      add({ kind: 'shop', name: 'Hire a Bear', cost: e.bearCost, currency: 'pollen' }, 1.2);
    if (e.ringsBuilt >= 4) add({ kind: 'shop', name: 'Wayfarer Fairy', cost: e.wayfarerCost, currency: 'honey' }, 1.5);

    // Buildings.
    const cache = this.cacheSpot();
    if (cache && e.cachesBuilt < 30)
      add(
        { kind: 'build', name: 'Squirrel Cache', build: 'cache', cost: e.cacheCost, currency: 'pollen', at: cache },
        1,
      );
    if (e.has('rake')) {
      const hive = this.hiveSpot();
      if (hive)
        add({ kind: 'build', name: 'Beehive', build: 'hive', cost: e.hiveCost, currency: 'pollen', at: hive }, 0.6);
    }
    if (e.has('rake')) {
      const stone = this.stoneSpot();
      if (stone)
        add(
          { kind: 'build', name: 'Waystone', build: 'waystone', cost: e.stoneCost, currency: 'pollen', at: stone },
          0.5,
        );
    }
    if (e.has('hive')) {
      const ring = this.ringSpot();
      if (ring)
        add({ kind: 'build', name: 'Fairy Ring', build: 'ring', cost: e.ringCost, currency: 'honey', at: ring }, 0.8);
    }
    if (!c.length) return null;
    c.sort((a, b) => a.cost * a.w - b.cost * b.w);
    return c[0];
  }

  /** A cache where she's working, if seeds are a long walk away. */
  private cacheSpot(): [number, number] | null {
    const g = this.focus;
    if (!g) return null;
    const [x, z] = [g.seedX, g.seedZ];
    if (this.nearestRefill(x, z, true).d < 45) return null;
    return this.clearSpot(x, z, (px, pz) => this.h.stations.canBuildAt(px, pz));
  }

  /** A waystone where she's working, if the nearest bottomless refill is a long way off. */
  private stoneSpot(): [number, number] | null {
    const g = this.focus;
    if (!g) return null;
    if (this.nearestBottomless(g.seedX, g.seedZ).d < 80) return null;
    return this.clearSpot(g.seedX, g.seedZ, (px, pz) => this.h.waystones.canBuildAt(px, pz));
  }

  /** A hive in a restored glade without one, nearest home. */
  private hiveSpot(): [number, number] | null {
    const w = this.h.world;
    const ap = this.h.apiary;
    const home = ap.dens[0];
    let best: Glade | null = null;
    let bd = Infinity;
    for (const g of w.glades) {
      if (!g.completed || g.total < 200) continue;
      const [x, z] = w.tileCenter(g.heartTile);
      if (ap.hiveBlockedAt(x, z)) continue;
      const d = wdist(home.x, home.z, x, z);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    if (!best) return null;
    const [x, z] = w.tileCenter(best.heartTile);
    return this.clearSpot(x, z, (px, pz) => ap.canBuildAt(px, pz) ?? ap.hiveBlockedAt(px, pz));
  }

  /** A ring over unfinished land, clear of the other rings' reach. */
  private ringSpot(): [number, number] | null {
    const w = this.h.world;
    const e = this.h.econ;
    const rings = this.h.fairies.rings;
    const R = e.ringRadius;
    // The most bare, workable ground in reach, a little favouring places nearby.
    let best: Glade | null = null;
    let bs = 0;
    for (const g of w.glades) {
      if (g.completed || g.total < 200 || !e.canWork(g.soil)) continue;
      if (rings.some((r) => wdist(r.x, r.z, g.seedX, g.seedZ) < R * 1.3)) continue;
      const s = this.bareNear(g.seedX, g.seedZ, R) / (1 + this.dist(g.seedX, g.seedZ) / 300);
      if (s > bs) {
        bs = s;
        best = g;
      }
    }
    if (!best || bs < 300) return null;
    return this.clearSpot(best.seedX, best.seedZ, (px, pz) => this.h.fairies.canBuildAt(px, pz));
  }

  /** Roughly how many workable bare tiles lie within r (by 32 m chunk). */
  private bareNear(x: number, z: number, r: number) {
    const w = this.h.world;
    const e = this.h.econ;
    const NB = 1024 / 32;
    const ci = Math.floor((x + HALF) / 32);
    const cj = Math.floor((z + HALF) / 32);
    const k = Math.ceil(r / 32);
    let n = 0;
    for (let dj = -k; dj <= k; dj++)
      for (let di = -k; di <= k; di++) {
        if ((di * di + dj * dj) * 1024 > r * r + 2048) continue;
        const c = ((((cj + dj) % NB) + NB) % NB) * NB + ((((ci + di) % NB) + NB) % NB);
        for (const soil of [Soil.Dirt, Soil.Clay, Soil.Stone]) if (e.canWork(soil)) n += w.remaining[c * 3 + soil];
      }
    return n;
  }

  /** The nearest spot to (x, z) that's dry ground and passes a check (tries a spiral). */
  private clearSpot(x: number, z: number, why: (x: number, z: number) => string | null): [number, number] | null {
    const w = this.h.world;
    for (let r = 0; r < 30; r += 3) {
      const n = r === 0 ? 1 : 8;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = wrap(x + Math.cos(a) * r);
        const pz = wrap(z + Math.sin(a) * r);
        const t = w.tileAt(px, pz);
        if (w.soil[t] === Soil.Creek) continue;
        if (this.failedSpots.some(([fx, fz]) => wdist(fx, fz, px, pz) < 3)) continue;
        if (!this.h.canPlace(px, pz) && !why(px, pz)) return [px, pz];
      }
    }
    return null;
  }

  // ---------- refills ----------

  /** Seeds it would take to fill the satchel and every mount's sack. */
  private get need() {
    const e = this.h.econ;
    let n = Math.max(0, e.seedCap - e.seeds);
    for (const m of MOUNTS) if (e.mounts.has(m.id)) n += Math.max(0, e.mountCap(m) - (e.mountSeeds[m.id] ?? 0));
    return n;
  }

  /** The nearest refill that never runs dry: the Seed Hollow or a waystone. */
  private nearestBottomless(x: number, z: number) {
    const st = this.h.stations;
    let best = { x: st.hollow.x, z: st.hollow.z, d: wdist(st.hollow.x, st.hollow.z, x, z), r: 3 };
    for (const s of this.h.waystones.stones) {
      const [ax, az] = this.h.waystones.arrival(s);
      const d = wdist(ax, az, x, z);
      if (d < best.d) best = { x: ax, z: az, d, r: 0.8 };
    }
    return best;
  }

  /** The nearest refill worth the trip: bottomless, or a cache holding most of what's needed. */
  private nearestRefill(x: number, z: number, anyStock = false) {
    const st = this.h.stations;
    let best = this.nearestBottomless(x, z);
    const need = this.need;
    for (const c of st.caches) {
      if (!anyStock && c.stock < Math.min(need * 0.6, this.h.econ.cacheStockCap * 0.5)) continue;
      const d = wdist(c.x, c.z, x, z);
      if (d < best.d) best = { x: c.x, z: c.z, d, r: 1.5 };
    }
    return best;
  }

  // ---------- planting ----------

  private chooseFocus() {
    const w = this.h.world;
    const e = this.h.econ;
    let best: Glade | null = null;
    let bs = Infinity;
    for (const g of w.glades) {
      if (g.completed || g.total === 0 || this.exhausted.has(g.id) || !e.canWork(g.soil)) continue;
      // Nearest, favouring glades already well along (they pay out when restored).
      const s = this.dist(g.seedX, g.seedZ) * (1 - 0.5 * (g.bloomed / g.total)) + g.total * 0.004;
      if (s < bs) {
        bs = s;
        best = g;
      }
    }
    this.focus = best;
  }

  /**
   * The nearest bare tile of the focus glade. Riding, it skips what's already under the mount
   * and leans toward what's ahead, so it sweeps along instead of stopping on every tile.
   */
  private findTile(skip = 0): number {
    const g = this.focus;
    if (!g) return -1;
    const w = this.h.world;
    const e = this.h.econ;
    if (!e.canWork(g.soil)) return -1;
    const ci = Math.floor(g.seedX + HALF);
    const cj = Math.floor(g.seedZ + HALF);
    const px = this.pos.x;
    const pz = this.pos.z;
    const v = this.h.player.vel;
    const sp = Math.hypot(v.x, v.z);
    const fx = sp > 0.5 ? v.x / sp : 0;
    const fz = sp > 0.5 ? v.z / sp : 0;
    let best = -1;
    let bd = Infinity;
    let near = -1;
    let nd = Infinity;
    for (let j = cj - UNWORKED_SCAN_R; j <= cj + UNWORKED_SCAN_R; j++) {
      for (let i = ci - UNWORKED_SCAN_R; i <= ci + UNWORKED_SCAN_R; i++) {
        const t = tileIndex(i, j);
        if (w.gladeOf[t] !== g.id || !w.isPlantable(t) || this.blocked.has(t)) continue;
        const [x, z] = w.tileCenter(t);
        const d = wdist(px, pz, x, z);
        if (d < nd) {
          nd = d;
          near = t;
        }
        if (d < skip) continue;
        const s = d - (skip ? (wrap(x - px) * fx + wrap(z - pz) * fz) * 0.6 : 0);
        if (s < bd) {
          bd = s;
          best = t;
        }
      }
    }
    return best >= 0 ? best : near;
  }

  private plant(dt: number) {
    const h = this.h;
    const e = h.econ;
    const w = h.world;
    if (!this.focus || this.focus.completed || this.exhausted.has(this.focus.id)) {
      this.chooseFocus();
      this.target = -1;
    }
    if (!this.focus) {
      this.stop();
      return 'idle';
    }
    this.retarget -= dt;
    if (this.target < 0 || !w.isPlantable(this.target) || this.retarget <= 0) {
      const prev = this.target;
      this.target = this.findTile(e.mount ? e.mount.radius * 0.7 : 0);
      this.retarget = e.mount ? 0.25 : 0.5;
      if (this.target !== prev) {
        this.fails = 0;
        this.bestD = Infinity;
      }
      if (this.target < 0) {
        this.exhausted.add(this.focus.id);
        this.focus = null;
        return 'plant';
      }
    }
    // Can't get to it: give up on that tile and its neighbours.
    if (this.fails > 3) {
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++)
          this.blocked.add(tileIndex((this.target % 1024) + di, ((this.target / 1024) | 0) + dj));
      this.fails = 0;
      this.target = -1;
      return 'plant';
    }
    const [x, z] = w.tileCenter(this.target);
    if (e.riding) {
      // The mount plants all round itself: sweep over the ground, only as fast as the soil
      // takes seed in the time it spends under the mount (zoomed out, like a player riding).
      h.setMouse(false);
      const m = e.mount!;
      const soil = w.soil[this.target] as Soil;
      const cruise = ((2 * m.radius * e.mountPower(m)) / SOILS[soil].hardness) * 0.8;
      if (this.dist(x, z) > 60) this.go(x, z, 0, dt, cruise);
      else this.moveTo(x, z, 0, dt, cruise);
      h.player.zoomTarget = this.travelZoom ? 60 : 4;
      return 'plant';
    }
    const reach = e.reach + e.tool.radius;
    if (this.dist(x, z) > 60) {
      h.setMouse(false);
      this.go(x, z, 0, dt);
      return 'plant';
    }
    if (this.moveTo(x, z, Math.max(1, reach - 0.8), dt)) {
      h.player.zoomTarget = 4;
      h.setMouse(true);
    } else h.setMouse(this.dist(x, z) < reach);
    return 'plant';
  }

  /** Point the planting cursor at the target tile (called where the camera ray would be). */
  aim() {
    const w = this.h.world;
    if (this.target >= 0 && this.mode === 'plant') {
      const [x, z] = w.tileCenter(this.target);
      this.h.garden.aimAt(x, z, this.pos);
    } else if (this.dest) this.h.garden.aimAt(this.dest[0], this.dest[1], this.pos);
    else this.h.garden.aimAt(this.pos.x, this.pos.z + 50, this.pos); // out of reach: nothing
  }

  // ---------- each step ----------

  update(dt: number) {
    if (this.done) return;
    const h = this.h;
    const e = h.econ;
    if (h.ended()) return this.finish(true);
    if (h.playTime() > this.hours * 3600) return this.finish(false);

    // Ride the best mount there is.
    const best = e.mounts.has('stag') ? 'stag' : e.mounts.has('tortoise') ? 'tortoise' : null;
    if (best && e.riding !== best) h.selectSlot(TOOLS.length + MOUNTS.findIndex((m) => m.id === best));
    if (!e.riding) {
      const tool = [...TOOLS].reverse().find((t) => e.tools.has(t.id))!;
      if (e.current !== tool.id) h.selectSlot(TOOLS.indexOf(tool));
    }

    // Take up rings that have finished their ground, to put them down somewhere new.
    this.ringCheck -= dt;
    if (this.ringCheck <= 0) {
      this.ringCheck = 20;
      const n = h.removeFinishedRings();
      if (n) {
        this.log('recall', `${n} finished ring${n === 1 ? '' : 's'}`);
        this.wantT = 0;
      }
    }

    // Rethink what to buy now and then.
    this.wantT -= dt;
    if (this.wantT <= 0 || !this.want) {
      this.wantT = 2;
      const p = this.pickWant('pollen');
      const hn = this.pickWant('honey');
      this.want = (hn && e.honey >= hn.cost ? hn : null) ?? (p && e.pollen >= p.cost ? p : null) ?? p ?? hn;
    }
    const want = this.want;
    const canBuy = want && e.wallet(want.currency) >= want.cost;

    let mode: Mode;
    if (this.mode === 'refill') mode = this.doRefill(dt);
    else if (canBuy && want.kind === 'shop') mode = this.doShop(dt);
    else if (canBuy && want.kind === 'build') mode = this.doBuild(want, dt);
    else if (e.activeSeeds < 1) mode = this.goRefill(dt);
    else mode = this.plant(dt) as Mode;
    if (mode !== 'plant') this.dest = null;
    this.mode = mode;
    this.report.modes[mode] = (this.report.modes[mode] ?? 0) + dt;

    // Glades restored.
    const pl = h.planet();
    if (pl.done > this.lastGlades) {
      for (let k = this.lastGlades; k < pl.done; k++) this.log('glade', `glade ${k + 1}`);
      this.lastGlades = pl.done;
    }
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 60;
      this.report.snapshots.push({
        t: Math.round(h.playTime()),
        pollen: Math.round(e.pollen),
        lifetimePollen: Math.round(e.lifetimePollen),
        honey: Math.round(e.honey),
        lifetimeHoney: Math.round(e.lifetimeHoney),
        pct: +pl.pct.toFixed(3),
        glades: pl.done,
        mult: e.multiplier,
        mount: e.riding ?? '',
        tool: e.current,
      });
    }
  }

  private goRefill(dt: number): Mode {
    const r = this.nearestRefill(this.pos.x, this.pos.z);
    this.h.setMouse(false);
    if (this.go(r.x, r.z, r.r, dt)) {
      this.refillWait = 0;
      this.refillLast = this.h.econ.activeSeeds;
      return 'refill';
    }
    return 'toRefill';
  }

  private doRefill(dt: number): Mode {
    const e = this.h.econ;
    this.stop();
    this.refillWait += dt;
    if (e.activeSeeds > this.refillLast) {
      this.refillLast = e.activeSeeds;
      this.refillWait = 0;
    }
    // Full, or the cache has run dry for now.
    if (e.allSeedsFull || this.refillWait > 1.5) return e.activeSeeds >= 1 ? 'plant' : 'toRefill';
    return 'refill';
  }

  private doShop(dt: number): Mode {
    const h = this.h;
    let ob = h.obelisks()[0];
    for (const o of h.obelisks()) if (this.dist(o.x, o.z) < this.dist(ob.x, ob.z)) ob = o;
    h.setMouse(false);
    if (!ob.nearby(this.pos)) {
      // Head for the near side of the obelisk.
      const dx = wrap(this.pos.x - ob.x);
      const dz = wrap(this.pos.z - ob.z);
      const d = Math.hypot(dx, dz) || 1;
      this.go(ob.x + (dx / d) * 3.2, ob.z + (dz / d) * 3.2, 0.8, dt);
      return 'toShop';
    }
    this.stop();
    h.openShop();
    // Buy whatever's next and affordable (at the shop), till nothing is.
    for (let k = 0; k < 30; k++) {
      const w = this.want;
      if (!w || w.kind !== 'shop' || h.econ.wallet(w.currency) < w.cost) break;
      if (!this.click(w.name)) {
        this.log('note', `couldn't buy ${w.name}`);
        break;
      }
      this.log('buy', w.name, w.cost, w.currency);
      const p = this.pickWant('pollen');
      const hn = this.pickWant('honey');
      this.want = (hn && h.econ.honey >= hn.cost ? hn : null) ?? (p && h.econ.pollen >= p.cost ? p : null) ?? p;
    }
    h.closeMenu();
    this.wantT = 0;
    return 'plant';
  }

  private click(name: string) {
    for (const card of document.querySelectorAll<HTMLElement>('#shop .card')) {
      const n = card.querySelector('.name')!.childNodes[0]?.textContent?.trim();
      if (n !== name) continue;
      const b = card.querySelector('button')!;
      if (b.disabled) return false;
      b.click();
      return true;
    }
    return false;
  }

  private doBuild(want: Want, dt: number): Mode {
    const at = want.at!;
    this.dest = at;
    this.h.setMouse(false);
    if (!this.go(at[0], at[1], 2, dt)) {
      // Can't get there (or keeps missing): try somewhere else.
      if (this.fails > 4) {
        this.fails = 0;
        this.log('note', `couldn't reach a spot for ${want.name}`);
        this.failedSpots.push(at);
        this.want = null;
        this.wantT = 0;
      }
      return 'toBuild';
    }
    this.stop();
    if (this.h.build(want.build!, at[0], at[1])) this.log('build', want.name, want.cost, want.currency);
    else {
      this.log('note', `couldn't build ${want.name}`);
      this.failedSpots.push(at);
    }
    this.want = null;
    this.wantT = 0;
    return 'plant';
  }

  // ---------- the end ----------

  private finish(ended: boolean) {
    if (this.done) return;
    this.done = true;
    this.fast = false;
    this.stop();
    this.log(ended ? 'end' : 'stop', ended ? 'planet restored' : `stopped at ${this.hours} h`);
    this.report.finished = ended;
    this.report.travels = this.travels;
    this.report.realSeconds = Math.round((performance.now() - this.realStart) / 1000);
    this.report.gameSeconds = Math.round(this.h.playTime());
    this.drawOverlay();
    void fetch('/__bot-report', { method: 'POST', body: JSON.stringify(this.report) }).catch(() => {});
    console.log('[bot] finished', this.report);
  }

  /** Redraw the status box (once a frame). */
  drawOverlay() {
    const h = this.h;
    const e = h.econ;
    const t = h.playTime();
    const pl = h.planet();
    const hm = `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`;
    const real = (performance.now() - this.realStart) / 1000;
    const last = this.report.events
      .filter((x) => x.type !== 'glade')
      .slice(-6)
      .map((x) => `${fmtT(x.t)} ${x.type} ${x.name}`)
      .join('\n');
    this.overlay.textContent =
      `PACING BOT ${this.done ? '(done)' : `×${(t / Math.max(1, real)).toFixed(0)}`}\n` +
      `game ${hm} · ${this.mode}\n` +
      `✿ ${Math.round(e.pollen)} · honey ${Math.round(e.honey)} · ×${e.multiplier.toFixed(1)}\n` +
      `planet ${pl.pct.toFixed(2)}% · ${pl.done}/${pl.total} glades\n` +
      `want: ${this.want ? `${this.want.name} (${Math.round(this.want.cost)})` : '-'}\n` +
      `focus: ${this.focus?.name ?? '-'} ${this.focus ? SOIL_LABEL[this.focus.soil] : ''}\n` +
      last;
  }
}

const SOIL_LABEL = ['dirt', 'clay', 'stone', 'creek'];

export function fmtT(t: number) {
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
}
