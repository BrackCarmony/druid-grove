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
    seedCap: 800,
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
    seedCap: 3200,
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

export type UpgradeGroup = 'planting' | 'seeds' | 'squirrels' | 'soil' | 'hives' | 'fairies';
export type Currency = 'pollen' | 'honey';

export interface UpgradeDef {
  id: string;
  group: UpgradeGroup;
  name: string;
  blurb: (lvl: number) => string;
  baseCost: number;
  growth: number;
  max: number;
  requires?: string; // tool, mount or upgrade id
  currency?: Currency; // default pollen
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'fingers',
    group: 'planting',
    name: 'Nimble Fingers',
    blurb: (l) => `Plant 25% faster by hand and 10% faster on a mount (now +${l * 25}% / +${l * 10}%)`,
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
  {
    id: 'clover',
    group: 'hives',
    name: 'Clover Nectar',
    blurb: (l) => `Bees make 30% more honey (now ×${Math.pow(1.3, l).toFixed(2)})`,
    baseCost: 1500,
    growth: 1.8,
    max: 10,
    requires: 'hive',
  },
  {
    id: 'combs',
    group: 'hives',
    name: 'Deeper Combs',
    blurb: (l) => `Hives hold twice as much honey (now ${fmtInt(hiveCap(l))})`,
    baseCost: 1200,
    growth: 1.9,
    max: 8,
    requires: 'hive',
  },
  {
    id: 'pots',
    group: 'hives',
    name: 'Bigger Honey Pots',
    blurb: (l) => `Bears carry 50% more honey (now ${fmtInt(bearCarry(l))})`,
    baseCost: 1000,
    growth: 1.85,
    max: 10,
    requires: 'hive',
  },
  {
    id: 'trails',
    group: 'hives',
    name: 'Bear Trails',
    blurb: (l) => `Bears lumber 20% faster (now +${l * 20}%)`,
    baseCost: 1400,
    growth: 1.9,
    max: 8,
    requires: 'hive',
  },
  {
    id: 'flock',
    group: 'fairies',
    name: 'Fairy Flock',
    blurb: (l) => `+1 fairy living in every ring (now ${FAIRY.perRing + l} each)`,
    baseCost: 150,
    growth: 1.8,
    max: 9,
    requires: 'ring',
    currency: 'honey',
  },
  {
    id: 'wings',
    group: 'fairies',
    name: 'Gossamer Wings',
    blurb: (l) => `Fairies fly 25% faster (now +${l * 25}%)`,
    baseCost: 120,
    growth: 1.75,
    max: 8,
    requires: 'ring',
    currency: 'honey',
  },
  {
    id: 'baskets',
    group: 'fairies',
    name: 'Acorn Baskets',
    blurb: (l) => `Fairies carry 50% more seeds (now ${fmtInt(fairyCarry(l))})`,
    baseCost: 100,
    growth: 1.75,
    max: 10,
    requires: 'ring',
    currency: 'honey',
  },
  {
    id: 'dust',
    group: 'fairies',
    name: 'Fairy Dust',
    blurb: (l) => `Fairies plant 40% faster (now ×${Math.pow(1.4, l).toFixed(2)})`,
    baseCost: 140,
    growth: 1.8,
    max: 8,
    requires: 'ring',
    currency: 'honey',
  },
  {
    id: 'circle',
    group: 'fairies',
    name: 'Wider Rings',
    blurb: (l) => `Fairies tend 12m further from their ring (now ${FAIRY.radius + l * 12}m)`,
    baseCost: 200,
    growth: 1.9,
    max: 8,
    requires: 'ring',
    currency: 'honey',
  },
];

function fmtInt(n: number) {
  return Math.round(n).toLocaleString();
}
export function hiveCap(l: number) {
  return HIVE.cap * Math.pow(2, l);
}
export function bearCarry(l: number) {
  return Math.round(BEAR.carry * Math.pow(1.5, l));
}
export function fairyCarry(l: number) {
  return Math.round(FAIRY.carry * Math.pow(1.5, l));
}

/** Bees forage blooms within `radius` of the hive; each bloomed tile makes `perFlower` honey/s. */
export const HIVE = { radius: 22, perFlower: 0.004, cap: 120, baseCost: 1200, growth: 1.15 };
export const BEAR = { carry: 30, speed: 4.5, baseCost: 600, growth: 1.45 };
export const FAIRY = { perRing: 3, carry: 40, speed: 9, radius: 36, power: 1.5, plantRadius: 1.1 };
export const RING = { baseCost: 60, growth: 1.7 };
/** Ringless fairies that roam the whole planet: faster, carry more, and cost a lot of honey. */
export const WAYFARER = { baseCost: 1500, growth: 1.6, speedMul: 1.7, carryMul: 2 };
export const DEN = { baseCost: 5000, growth: 1.8 };
export const WAYSTONE = { baseCost: 1500, growth: 1.5 };

export function satchelCap(lvl: number) {
  return Math.round((30 * Math.pow(1.6, lvl)) / 5) * 5;
}

export const SQUIRREL = {
  baseCarry: 120,
  baseStock: 1200,
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
  honey = 0;
  lifetimeHoney = 0;
  hivesBuilt = 0;
  bears = 0;
  ringsBuilt = 0;
  densBuilt = 0; // extra dens beyond the one at home
  stonesBuilt = 0; // waystones beyond the one at home
  wayfarers = 0;

  level(id: string) {
    return this.levels[id] ?? 0;
  }

  has(id: string) {
    if (id === 'cache') return this.cachesBuilt > 0;
    if (id === 'hive') return this.hivesBuilt > 0;
    if (id === 'ring') return this.ringsBuilt > 0;
    return this.tools.has(id as ToolId) || this.mounts.has(id as MountId) || this.level(id) > 0;
  }

  nameOf(id: string) {
    if (id === 'cache') return 'a Squirrel Cache';
    if (id === 'hive') return 'a Beehive';
    if (id === 'ring') return 'a Fairy Ring';
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

  /** Mounts get a smaller share of Nimble Fingers (a maxed stag clears clay at a full gallop). */
  mountPower(m: MountDef) {
    return m.power * (1 + 0.1 * this.level('fingers'));
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

  /** Mounts in refill order: the one being ridden first, then the rest. */
  private get ownedMounts(): MountDef[] {
    const owned = MOUNTS.filter((m) => this.mounts.has(m.id));
    return owned.sort((a, b) => Number(b.id === this.riding) - Number(a.id === this.riding));
  }

  /** Top up the satchel and every owned mount's seed bag (ridden or not). Returns seeds used. */
  refill(available: number): number {
    let used = 0;
    const a = Math.min(Math.max(0, this.seedCap - this.seeds), available);
    this.seeds += a;
    used += a;
    for (const m of this.ownedMounts) {
      const have = this.mountSeeds[m.id] ?? 0;
      const b = Math.min(Math.max(0, this.mountCap(m) - have), available - used);
      this.mountSeeds[m.id] = have + b;
      used += b;
    }
    return used;
  }

  /** Satchel and every mount's bag are full. */
  get allSeedsFull() {
    return (
      this.seeds >= this.seedCap && this.ownedMounts.every((m) => (this.mountSeeds[m.id] ?? 0) >= this.mountCap(m))
    );
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

  // ---------- hives, bears, fairies ----------

  get hiveCost() {
    return Math.ceil(HIVE.baseCost * Math.pow(HIVE.growth, this.hivesBuilt));
  }
  /** The first bear comes free with the first hive, and one more with every new den. */
  get bearCost() {
    return Math.ceil(BEAR.baseCost * Math.pow(BEAR.growth, Math.max(0, this.bears - 1 - this.densBuilt)));
  }
  get wayfarerCost() {
    return Math.ceil(WAYFARER.baseCost * Math.pow(WAYFARER.growth, this.wayfarers));
  }
  get denCost() {
    return Math.ceil(DEN.baseCost * Math.pow(DEN.growth, this.densBuilt));
  }
  get stoneCost() {
    return Math.ceil(WAYSTONE.baseCost * Math.pow(WAYSTONE.growth, this.stonesBuilt));
  }
  get hiveCap() {
    return hiveCap(this.level('combs'));
  }
  get honeyPerFlower() {
    return HIVE.perFlower * Math.pow(1.3, this.level('clover'));
  }
  get bearCarry() {
    return bearCarry(this.level('pots'));
  }
  get bearSpeed() {
    return BEAR.speed * (1 + 0.2 * this.level('trails'));
  }
  get ringCost() {
    return Math.ceil(RING.baseCost * Math.pow(RING.growth, this.ringsBuilt));
  }
  get fairiesPerRing() {
    return FAIRY.perRing + this.level('flock');
  }
  get fairySpeed() {
    return FAIRY.speed * (1 + 0.25 * this.level('wings'));
  }
  get fairyCarry() {
    return fairyCarry(this.level('baskets'));
  }
  get fairyPower() {
    return FAIRY.power * Math.pow(1.4, this.level('dust'));
  }
  get ringRadius() {
    return FAIRY.radius + 12 * this.level('circle');
  }

  wallet(c: Currency = 'pollen') {
    return c === 'honey' ? this.honey : this.pollen;
  }
  spend(c: Currency, n: number) {
    if (c === 'honey') this.honey -= n;
    else this.pollen -= n;
  }
  addHoney(n: number) {
    this.honey += n;
    this.lifetimeHoney += n;
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
    const cur = u.currency ?? 'pollen';
    if (this.level(u.id) >= u.max || this.wallet(cur) < cost) return false;
    if (u.requires && !this.has(u.requires)) return false;
    this.spend(cur, cost);
    this.levels[u.id] = this.level(u.id) + 1;
    if (u.id === 'satchel') this.seeds = this.seedCap;
    return true;
  }
}
