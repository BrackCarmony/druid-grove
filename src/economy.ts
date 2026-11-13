import { Soil } from './world';

export type ToolId = 'tweezers' | 'glove' | 'rake';

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

export interface UpgradeDef {
  id: string;
  name: string;
  blurb: (lvl: number) => string;
  baseCost: number;
  growth: number;
  max: number;
  requiresTool?: ToolId;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'fingers',
    name: 'Nimble Fingers',
    blurb: (l) => `Plant 25% faster (now +${l * 25}%)`,
    baseCost: 12,
    growth: 1.55,
    max: 20,
  },
  {
    id: 'bloom',
    name: 'Sunwarmth',
    blurb: (l) => `Seeds bloom faster (now ${Math.round(100 * Math.pow(0.8, l))}% grow time)`,
    baseCost: 30,
    growth: 1.7,
    max: 8,
  },
  {
    id: 'reach',
    name: 'Long Reach',
    blurb: (l) => `+0.75m reach (now +${(l * 0.75).toFixed(2)}m)`,
    baseCost: 25,
    growth: 1.9,
    max: 6,
  },
  {
    id: 'worms',
    name: 'Earthworm Charm',
    blurb: () => 'Worms loosen clay so seeds can take root. Unlocks clay glades.',
    baseCost: 600,
    growth: 1,
    max: 1,
    requiresTool: 'glove',
  },
  {
    id: 'moss',
    name: 'Moss Spores',
    blurb: () => 'Moss creeps into stone and cracks it into soil. Unlocks stone glades.',
    baseCost: 9000,
    growth: 1,
    max: 1,
    requiresTool: 'rake',
  },
];

export class Economy {
  pollen = 0;
  lifetimePollen = 0;
  multiplier = 1;
  tools = new Set<ToolId>(['tweezers']);
  current: ToolId = 'tweezers';
  levels: Record<string, number> = {};

  level(id: string) {
    return this.levels[id] ?? 0;
  }

  upgradeCost(u: UpgradeDef) {
    return Math.ceil(u.baseCost * Math.pow(u.growth, this.level(u.id)));
  }

  get tool(): ToolDef {
    return TOOLS.find((t) => t.id === this.current)!;
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

  buyUpgrade(u: UpgradeDef) {
    const cost = this.upgradeCost(u);
    if (this.level(u.id) >= u.max || this.pollen < cost) return false;
    if (u.requiresTool && !this.tools.has(u.requiresTool)) return false;
    this.pollen -= cost;
    this.levels[u.id] = this.level(u.id) + 1;
    return true;
  }
}
