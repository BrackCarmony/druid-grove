import { Soil } from './world';

export type ToolId = 'tweezers' | 'glove' | 'rake';
export type MountId = 'tortoise' | 'stag';

export interface ToolDef {
  id: ToolId;
  name: string;
  blurb: string;
  cost: number;
  radius: number; // metres around the cursor; 0 = single tile
  power: number; // planting effort per second applied to each tile
  reach: number; // base metres from the nymph
}

export const TOOLS: ToolDef[] = [
  {
    id: 'tweezers',
    name: 'Tweezers',
    blurb: 'One seed at a time. Painstaking.',
    cost: 0,
    radius: 0,
    power: 1.2,
    reach: 3,
  },
  {
    id: 'glove',
    name: 'Garden Glove',
    blurb: 'Press a handful of seeds into a small patch.',
    cost: 25,
    radius: 1.15,
    power: 1.4,
    reach: 3.5,
  },
  {
    id: 'rake',
    name: 'Rake',
    blurb: 'Sweep seed across a wide swath of ground.',
    cost: 400,
    radius: 2.6,
    power: 1.8,
    reach: 5,
  },
];

export interface MountDef {
  id: MountId;
  name: string;
  blurb: string;
  cost: number;
  requires: string; // tool or upgrade id
  radius: number; // auto-plant footprint around the mount
  power: number;
  seedCap: number;
  speed: number;
  runSpeed: number;
  eye: number; // camera height when riding
  bodyRadius: number;
}

export const MOUNTS: MountDef[] = [
  {
    id: 'tortoise',
    name: 'Mossback Tortoise',
    blurb: 'Slow and steady. Plants everything it plods over and carries a big seed sack.',
    cost: 3000,
    requires: 'rake',
    radius: 3.2,
    power: 2.6,
    seedCap: 400,
    speed: 3.2,
    runSpeed: 4.8,
    eye: 2.4,
    bodyRadius: 0.9,
  },
  {
    id: 'stag',
    name: 'Bramble Stag',
    blurb: 'Fast, strong and broad-antlered. Tills clay with ease and carries a huge seed load.',
    cost: 40000,
    requires: 'worms',
    radius: 4.6,
    power: 5,
    seedCap: 1600,
    speed: 8,
    runSpeed: 13,
    eye: 2.9,
    bodyRadius: 0.8,
  },
];

export interface SoilDef {
  hardness: number; // effort needed per tile
  yield: number; // pollen per bloom
  unlock: string | null; // upgrade id required
}

export const SOILS: Record<number, SoilDef> = {
  [Soil.Dirt]: { hardness: 1, yield: 1, unlock: null },
  [Soil.Clay]: { hardness: 3, yield: 5, unlock: 'worms' },
  [Soil.Stone]: { hardness: 8, yield: 22, unlock: 'moss' },
};

export type UpgradeGroup = 'planting' | 'seeds' | 'squirrels' | 'soil';

export interface UpgradeDef {
  id: string;
  group: UpgradeGroup;
  name: string;
  blurb: (lvl: number) => string;
  baseCost: number;
  growth: number;
  max: number;
  requires?: string; // tool, mount or upgrade id
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'fingers',
    group: 'planting',
    name: 'Nimble Fingers',
    blurb: (l) => `Plant 25% faster by hand (now +${l * 25}%)`,
    baseCost: 12,
    growth: 1.55,
    max: 20,
  },
  {
    id: 'bloom',
    group: 'planting',
    name: 'Sunwarmth',
    blurb: (l) => `Seeds bloom faster (now ${Math.round(100 * Math.pow(0.8, l))}% grow time)`,
    baseCost: 30,
    growth: 1.7,
    max: 8,
  },
  {
    id: 'reach',
    group: 'planting',
    name: 'Long Reach',
    blurb: (l) => `+0.75m reach (now +${(l * 0.75).toFixed(2)}m)`,
    baseCost: 25,
    growth: 1.9,
    max: 6,
  },
  {
    id: 'satchel',
    group: 'seeds',
    name: 'Bigger Satchel',
    blurb: (l) => `Carry 60% more seeds (now ${satchelCap(l)}, next ${satchelCap(l + 1)})`,
    baseCost: 15,
    growth: 1.75,
    max: 14,
  },
  {
    id: 'saddlebags',
    group: 'seeds',
    name: 'Saddlebags',
    blurb: (l) => `Mounts carry 50% more seeds (now ×${Math.pow(1.5, l).toFixed(2)})`,
    baseCost: 2500,
    growth: 2.1,
    max: 6,
    requires: 'tortoise',
  },
  {
    id: 'family',
    group: 'squirrels',
    name: 'Squirrel Family',
    blurb: (l) => `+1 squirrel running seeds to every cache (now ${1 + l} each)`,
    baseCost: 120,
    growth: 2.0,
    max: 7,
    requires: 'cache',
  },
  {
    id: 'cheeks',
    group: 'squirrels',
    name: 'Stuffed Cheeks',
    blurb: (l) => `Squirrels carry 50% more and caches hold 50% more (now ×${Math.pow(1.5, l).toFixed(2)})`,
    baseCost: 90,
    growth: 1.9,
    max: 10,
    requires: 'cache',
  },
  {
    id: 'paws',
    group: 'squirrels',
    name: 'Quick Paws',
    blurb: (l) => `Squirrels scamper 25% faster (now +${l * 25}%)`,
    baseCost: 100,
    growth: 1.85,
    max: 8,
    requires: 'cache',
  },
  {
    id: 'worms',
    group: 'soil',
    name: 'Earthworm Charm',
    blurb: () => 'Worms loosen clay so seeds can take root. Unlocks clay glades.',
    baseCost: 600,
    growth: 1,
    max: 1,
    requires: 'glove',
  },
  {
    id: 'moss',
    group: 'soil',
    name: 'Moss Spores',
    blurb: () => 'Moss creeps into stone and cracks it into soil. Unlocks stone glades.',
    baseCost: 9000,
    growth: 1,
    max: 1,
    requires: 'rake',
  },
];

export function satchelCap(lvl: number) {
  return Math.round((30 * Math.pow(1.6, lvl)) / 5) * 5;
}

export const SQUIRREL = {
  baseCarry: 12,
  baseStock: 120,
  speed: 9, // m/s
};

export class Economy {
  pollen = 0;
  lifetimePollen = 0;
  multiplier = 1;
  tools = new Set<ToolId>(['tweezers']);
  mounts = new Set<MountId>();
  current: ToolId = 'tweezers';
  riding: MountId | null = null;
  autoPlant = true;
  levels: Record<string, number> = {};
  seeds = 30;
  mountSeeds: Record<string, number> = {};
  cachesBuilt = 0;

  level(id: string) {
    return this.levels[id] ?? 0;
  }

  has(id: string) {
    if (id === 'cache') return this.cachesBuilt > 0;
    return this.tools.has(id as ToolId) || this.mounts.has(id as MountId) || this.level(id) > 0;
  }

  nameOf(id: string) {
    if (id === 'cache') return 'a Squirrel Cache';
    return (
      TOOLS.find((t) => t.id === id)?.name ??
      MOUNTS.find((m) => m.id === id)?.name ??
      UPGRADES.find((u) => u.id === id)?.name ??
      id
    );
  }

  upgradeCost(u: UpgradeDef) {
    return Math.ceil(u.baseCost * Math.pow(u.growth, this.level(u.id)));
  }

  get tool(): ToolDef {
    return TOOLS.find((t) => t.id === this.current)!;
  }

  get mount(): MountDef | null {
    return this.riding ? MOUNTS.find((m) => m.id === this.riding)! : null;
  }

  get power() {
    return this.tool.power * (1 + 0.25 * this.level('fingers'));
  }

  get reach() {
    return this.tool.reach + 0.75 * this.level('reach');
  }

  get growTime() {
    return 3.5 * Math.pow(0.8, this.level('bloom'));
  }

  // ---------- seeds ----------

  get seedCap() {
    return satchelCap(this.level('satchel'));
  }

  mountCap(m: MountDef) {
    return Math.round(m.seedCap * Math.pow(1.5, this.level('saddlebags')));
  }

  /** Seeds available to whatever is planting right now (the mount when riding). */
  get activeSeeds() {
    return this.riding ? (this.mountSeeds[this.riding] ?? 0) : this.seeds;
  }

  takeSeed(): boolean {
    if (this.riding) {
      if ((this.mountSeeds[this.riding] ?? 0) < 1) return false;
      this.mountSeeds[this.riding]--;
      return true;
    }
    if (this.seeds < 1) return false;
    this.seeds--;
    return true;
  }

  /** Top up the satchel (and the current mount) from a source. Returns seeds used. */
  refill(available: number): number {
    let used = 0;
    const need = this.seedCap - this.seeds;
    const a = Math.min(need, available);
    this.seeds += a;
    used += a;
    const m = this.mount;
    if (m) {
      const mNeed = this.mountCap(m) - (this.mountSeeds[m.id] ?? 0);
      const b = Math.min(mNeed, available - used);
      this.mountSeeds[m.id] = (this.mountSeeds[m.id] ?? 0) + b;
      used += b;
    }
    return used;
  }

  // ---------- squirrels ----------

  get squirrelsPerCache() {
    return 1 + this.level('family');
  }
  get squirrelCarry() {
    return Math.round(SQUIRREL.baseCarry * Math.pow(1.5, this.level('cheeks')));
  }
  get cacheStockCap() {
    return Math.round(SQUIRREL.baseStock * Math.pow(1.5, this.level('cheeks')));
  }
  get squirrelSpeed() {
    return SQUIRREL.speed * (1 + 0.25 * this.level('paws'));
  }
  get cacheCost() {
    return Math.ceil(60 * Math.pow(1.6, this.cachesBuilt));
  }

  canWork(soil: Soil) {
    if (soil === Soil.Creek) return false;
    const u = SOILS[soil].unlock;
    return !u || this.level(u) > 0;
  }

  earn(n: number) {
    const v = n * this.multiplier;
    this.pollen += v;
    this.lifetimePollen += v;
    return v;
  }

  buyTool(t: ToolDef) {
    if (this.tools.has(t.id) || this.pollen < t.cost) return false;
    this.pollen -= t.cost;
    this.tools.add(t.id);
    this.current = t.id;
    return true;
  }

  buyMount(m: MountDef) {
    if (this.mounts.has(m.id) || this.pollen < m.cost || !this.has(m.requires)) return false;
    this.pollen -= m.cost;
    this.mounts.add(m.id);
    this.mountSeeds[m.id] = this.mountCap(m);
    return true;
  }

  buyUpgrade(u: UpgradeDef) {
    const cost = this.upgradeCost(u);
    if (this.level(u.id) >= u.max || this.pollen < cost) return false;
    if (u.requires && !this.has(u.requires)) return false;
    this.pollen -= cost;
    this.levels[u.id] = this.level(u.id) + 1;
    if (u.id === 'satchel') this.seeds = this.seedCap;
    return true;
  }
}
