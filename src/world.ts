import * as THREE from 'three';
import { fbm, mulberry32, valueNoise } from './noise';

// The planet: a SIZE x SIZE grid of 1m tiles that wraps around on itself in both
// directions (walk far enough any way and you come home). It's drawn curving away
// below the horizon so it reads as a small world. Canonical coordinates run from
// -HALF to HALF; anything outside that is the same place one lap around.
// The land is split into irregular "glades" separated by dry creek beds.

export const SIZE = 1024;
export const HALF = SIZE / 2;
const CELL = 32; // glade seed spacing
const NC = SIZE / CELL;

/** Bring a coordinate back into [-HALF, HALF). Also works on differences (shortest way round). */
export function wrap(v: number) {
  return v - SIZE * Math.floor((v + HALF) / SIZE);
}
/** Distance the short way round the planet. */
export function wdist(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(wrap(bx - ax), wrap(bz - az));
}
const imod = (i: number) => ((i % SIZE) + SIZE) % SIZE;
/** Tile index for wrapped integer tile coordinates. */
export function tileIndex(i: number, j: number) {
  return imod(j) * SIZE + imod(i);
}

export enum Soil {
  Dirt = 0,
  Clay = 1,
  Stone = 2,
  Creek = 3,
}

export const SOIL_NAMES = ['Dirt', 'Clay', 'Stone', 'Creek'];

export interface Glade {
  id: number;
  name: string;
  soil: Soil;
  seedX: number;
  seedZ: number;
  heartTile: number;
  total: number; // plantable tiles
  bloomed: number;
  completed: boolean;
  palette: number[];
  paletteId: number;
}

const NAME_A = [
  'Hush',
  'Ember',
  'Willow',
  'Thistle',
  'Moth',
  'Fern',
  'Dusk',
  'Briar',
  'Sorrel',
  'Hollow',
  'Clover',
  'Bramble',
  'Marrow',
  'Lark',
  'Rue',
  'Sedge',
  'Wren',
  'Tansy',
  'Yarrow',
  'Aster',
  'Heather',
  'Juniper',
  'Linden',
  'Mallow',
  'Nettle',
  'Oxlip',
  'Primrose',
  'Quill',
  'Rowan',
  'Sage',
  'Teasel',
  'Umber',
  'Vetch',
  'Wisp',
  'Alder',
  'Bracken',
  'Campion',
  'Dewberry',
  'Elder',
  'Foxglove',
  'Gorse',
  'Hazel',
  'Ivy',
  'Kestrel',
  'Lichen',
  'Meadowsweet',
  'Owl',
  'Pippin',
  'Robin',
  'Starling',
  'Thrush',
  'Violet',
  'Wort',
  'Acorn',
  'Bluebell',
  'Catkin',
  'Daisy',
  'Finch',
];
const NAME_B = [
  'Glade',
  'Hollow',
  'Dell',
  'Meadow',
  'Vale',
  'Reach',
  'Field',
  'Rise',
  'Bottom',
  'Green',
  'Combe',
  'Knoll',
  'Hurst',
  'Lea',
  'Mead',
  'Brake',
  'Copse',
  'Downs',
  'Fold',
  'Heath',
];

export const PALETTES: number[][] = [
  [0xffd6e8, 0xff8fb8, 0xffffff, 0xffe066],
  [0xb8a4ff, 0x8f7bff, 0xe8dcff, 0xffffff],
  [0xffb36b, 0xffe066, 0xff6b6b, 0xfff4d6],
  [0x9ee6ff, 0xffffff, 0xc3b5ff, 0x7fd1ff],
  [0xff7a9c, 0xffc2d1, 0xfff0a8, 0xd6a4ff],
  [0xfff27a, 0xffffff, 0xffc94d, 0xff9f43],
];

export class World {
  heights = new Float32Array(SIZE * SIZE); // corner heights; corner (i, j) sits at (i - HALF, j - HALF)
  soil = new Uint8Array(SIZE * SIZE);
  gladeOf = new Int16Array(SIZE * SIZE);
  creekDist = new Float32Array(SIZE * SIZE);
  glades: Glade[] = [];

  // Dynamic tile state
  work = new Float32Array(SIZE * SIZE); // 0..1 planting effort applied
  growth = new Float32Array(SIZE * SIZE); // 0..1 once seeded
  seeded = new Uint8Array(SIZE * SIZE);
  bloomed = new Uint8Array(SIZE * SIZE);
  wet = new Uint8Array(SIZE * SIZE);
  growing = new Set<number>();

  stateTex: THREE.DataTexture;
  staticTex: THREE.DataTexture;
  heightTex: THREE.DataTexture;
  private stateData = new Uint8Array(SIZE * SIZE * 4);
  // Dirty span per row, so only changed rows get re-uploaded.
  private rowMin = new Int32Array(SIZE).fill(SIZE);
  private rowMax = new Int32Array(SIZE).fill(-1);
  private dirtyRows = new Set<number>();

  startGlade = 0;

  constructor(seed = 7) {
    const rng = mulberry32(seed);
    this.generateGlades(rng);
    this.generateHeights(seed);
    this.staticTex = this.buildStaticTexture(seed);
    this.stateTex = new THREE.DataTexture(this.stateData, SIZE, SIZE, THREE.RGBAFormat);
    this.stateTex.magFilter = THREE.LinearFilter;
    this.stateTex.minFilter = THREE.LinearFilter;
    this.stateTex.wrapS = this.stateTex.wrapT = THREE.RepeatWrapping;
    this.stateTex.needsUpdate = true;
    this.heightTex = new THREE.DataTexture(this.heights, SIZE, SIZE, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;
  }

  // ---------- generation ----------

  private generateGlades(rng: () => number) {
    // One jittered seed per cell, on a grid that wraps.
    const seeds: { x: number; z: number }[] = [];
    for (let cz = 0; cz < NC; cz++) {
      for (let cx = 0; cx < NC; cx++) {
        seeds.push({
          x: (cx + 0.2 + rng() * 0.6) * CELL - HALF,
          z: (cz + 0.2 + rng() * 0.6) * CELL - HALF,
        });
      }
    }
    // Home is the glade at the origin.
    const home = Math.floor(HALF / CELL) * NC + Math.floor(HALF / CELL);
    seeds[home].x = 0;
    seeds[home].z = 0;
    this.startGlade = home;

    // Assign tiles to the nearest seed (the short way round) using domain-warped
    // coordinates for organic borders. Only nearby cells can win.
    const P = SIZE / 32;
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const x = i - HALF + 0.5;
        const z = j - HALF + 0.5;
        const wx = x + (fbm(x / 32, z / 32, 3, 11, P) - 0.5) * 22;
        const wz = z + (fbm(x / 32, z / 32, 3, 29, P) - 0.5) * 22;
        const ci = Math.floor((wx + HALF) / CELL);
        const cj = Math.floor((wz + HALF) / CELL);
        let bi = 0;
        let bd = Infinity;
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            const s = ((((cj + dj) % NC) + NC) % NC) * NC + ((((ci + di) % NC) + NC) % NC);
            const dx = wrap(wx - seeds[s].x);
            const dz = wrap(wz - seeds[s].z);
            const d = dx * dx + dz * dz;
            if (d < bd) {
              bd = d;
              bi = s;
            }
          }
        }
        this.gladeOf[j * SIZE + i] = bi;
      }
    }

    // Creek beds: tiles that touch another glade. Then BFS distance from creeks.
    const queue = new Int32Array(SIZE * SIZE);
    let qn = 0;
    this.creekDist.fill(Infinity);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const t = j * SIZE + i;
        const g = this.gladeOf[t];
        if (this.gladeOf[tileIndex(i + 1, j)] !== g || this.gladeOf[tileIndex(i, j + 1)] !== g) {
          this.creekDist[t] = 0;
          queue[qn++] = t;
        }
      }
    }
    for (let q = 0; q < qn; q++) {
      const t = queue[q];
      const i = t % SIZE;
      const j = (t / SIZE) | 0;
      const d = this.creekDist[t] + 1;
      if (d > 8) continue; // only the first few metres matter
      for (const n of [tileIndex(i - 1, j), tileIndex(i + 1, j), tileIndex(i, j - 1), tileIndex(i, j + 1)]) {
        if (this.creekDist[n] > d) {
          this.creekDist[n] = d;
          queue[qn++] = n;
        }
      }
    }

    // Glade metadata. Soil gets harder the further a glade is from home, so the far
    // side of the planet is all stone.
    const maxR = HALF * Math.SQRT2;
    const used = new Set<string>();
    seeds.forEach((s, id) => {
      const r = Math.hypot(s.x, s.z) / maxR;
      const soil = r < 0.3 ? Soil.Dirt : r < 0.62 ? Soil.Clay : Soil.Stone;
      let name = '';
      for (let tries = 0; tries < 12 && (!name || used.has(name)); tries++) {
        name = `${NAME_A[Math.floor(rng() * NAME_A.length)]} ${NAME_B[Math.floor(rng() * NAME_B.length)]}`;
      }
      for (let k = 2; used.has(name); k++) name = name.replace(/ \d+$/, '') + ` ${k}`;
      used.add(name);
      const paletteId = Math.floor(rng() * PALETTES.length);
      this.glades.push({
        id,
        name: id === home ? 'Heartseed Glade' : name,
        soil,
        seedX: s.x,
        seedZ: s.z,
        heartTile: -1,
        total: 0,
        bloomed: 0,
        completed: false,
        palette: PALETTES[paletteId],
        paletteId,
      });
    });

    for (let t = 0; t < SIZE * SIZE; t++) {
      if (this.creekDist[t] === 0) {
        this.soil[t] = Soil.Creek;
        continue;
      }
      const g = this.glades[this.gladeOf[t]];
      this.soil[t] = g.soil;
      g.total++;
    }

    // A seed swallowed by its neighbours' warped borders owns no land; treat it as done.
    for (const g of this.glades) if (g.total === 0) g.completed = true;

    // Heart tile: the plantable tile of each glade nearest its seed and far from creeks.
    const bestScore = new Float32Array(this.glades.length).fill(Infinity);
    for (let t = 0; t < SIZE * SIZE; t++) {
      if (this.soil[t] === Soil.Creek) continue;
      const g = this.glades[this.gladeOf[t]];
      const [x, z] = this.tileCenter(t);
      const d = wdist(x, z, g.seedX, g.seedZ) - Math.min(this.creekDist[t], 6) * 2;
      if (d < bestScore[g.id]) {
        bestScore[g.id] = d;
        g.heartTile = t;
      }
    }
  }

  private generateHeights(seed: number) {
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const x = i - HALF;
        const z = j - HALF;
        let h = (fbm(x / 64, z / 64, 4, seed, SIZE / 64) - 0.5) * 14;
        h += (valueNoise(x / 8, z / 8, seed + 5, SIZE / 8) - 0.5) * 0.6;
        // Creek dip: the four tiles around this corner
        let cd = Infinity;
        for (let dj = -1; dj <= 0; dj++) {
          for (let di = -1; di <= 0; di++) cd = Math.min(cd, this.creekDist[tileIndex(i + di, j + dj)]);
        }
        const dip = Math.max(0, 1 - cd / 3);
        h -= dip * dip * 1.4;
        // Far-side stone glades are rougher and higher.
        const r = Math.hypot(x, z) / HALF;
        h += Math.max(0, r - 0.7) * 10 * fbm(x / 16, z / 16, 3, seed + 9, SIZE / 16);
        this.heights[j * SIZE + i] = h;
      }
    }
  }

  private buildStaticTexture(seed: number) {
    const data = new Uint8Array(SIZE * SIZE * 4);
    for (let t = 0; t < SIZE * SIZE; t++) {
      const s = this.soil[t];
      const g = this.glades[this.gladeOf[t]];
      const i = t % SIZE;
      const j = (t / SIZE) | 0;
      data[t * 4 + 0] = (s === Soil.Creek ? g.soil : s) === Soil.Clay ? 255 : 0;
      data[t * 4 + 1] = (s === Soil.Creek ? g.soil : s) === Soil.Stone ? 255 : 0;
      data[t * 4 + 2] = s === Soil.Creek ? 255 : 0;
      data[t * 4 + 3] = Math.floor(valueNoise(i / 4, j / 4, seed + 3, SIZE / 4) * 255);
    }
    const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // ---------- queries ----------

  tileCenter(t: number): [number, number] {
    return [(t % SIZE) - HALF + 0.5, ((t / SIZE) | 0) - HALF + 0.5];
  }

  /** Every position is on the planet, so this always returns a tile. */
  tileAt(x: number, z: number): number {
    return tileIndex(Math.floor(x + HALF), Math.floor(z + HALF));
  }

  heightAt(x: number, z: number): number {
    const fx = x + HALF;
    const fz = z + HALF;
    const fi = Math.floor(fx);
    const fj = Math.floor(fz);
    const u = fx - fi;
    const v = fz - fj;
    const i0 = imod(fi);
    const j0 = imod(fj);
    const i1 = (i0 + 1) % SIZE;
    const j1 = (j0 + 1) % SIZE;
    const H = this.heights;
    const h00 = H[j0 * SIZE + i0];
    const h10 = H[j0 * SIZE + i1];
    const h01 = H[j1 * SIZE + i0];
    const h11 = H[j1 * SIZE + i1];
    return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  }

  // ---------- state ----------

  markDirty(t: number) {
    const r = this.seeded[t] ? 90 + this.growth[t] * 165 : this.work[t] * 80;
    this.stateData[t * 4] = r;
    this.stateData[t * 4 + 1] = this.wet[t] ? 255 : 0;
    this.stateData[t * 4 + 2] = this.bloomed[t] ? 255 : 0;
    const i = t % SIZE;
    const j = (t / SIZE) | 0;
    if (i < this.rowMin[j]) this.rowMin[j] = i;
    if (i > this.rowMax[j]) this.rowMax[j] = i;
    this.dirtyRows.add(j);
  }

  /** Upload just the changed spans of the state texture. */
  flush() {
    if (!this.dirtyRows.size) return;
    // A full re-upload is cheaper than thousands of row ranges (e.g. right after loading).
    if (this.dirtyRows.size > SIZE / 4) {
      this.stateTex.clearUpdateRanges();
    } else {
      for (const j of this.dirtyRows) {
        const a = this.rowMin[j];
        this.stateTex.addUpdateRange((j * SIZE + a) * 4, (this.rowMax[j] - a + 1) * 4);
      }
    }
    for (const j of this.dirtyRows) {
      this.rowMin[j] = SIZE;
      this.rowMax[j] = -1;
    }
    this.dirtyRows.clear();
    this.stateTex.needsUpdate = true;
  }

  isPlantable(t: number) {
    return t >= 0 && this.soil[t] !== Soil.Creek && !this.seeded[t];
  }
}
