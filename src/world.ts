import * as THREE from 'three';
import { fbm, mulberry32, valueNoise } from './noise';

// World layout: a SIZE x SIZE grid of 1m tiles centred on the origin.
// The land is split into irregular "glades" separated by dry creek beds.

export const SIZE = 160;
export const HALF = SIZE / 2;

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
];
const NAME_B = ['Glade', 'Hollow', 'Dell', 'Meadow', 'Vale', 'Reach', 'Field', 'Rise', 'Bottom', 'Green'];

const PALETTES: number[][] = [
  [0xffd6e8, 0xff8fb8, 0xffffff, 0xffe066],
  [0xb8a4ff, 0x8f7bff, 0xe8dcff, 0xffffff],
  [0xffb36b, 0xffe066, 0xff6b6b, 0xfff4d6],
  [0x9ee6ff, 0xffffff, 0xc3b5ff, 0x7fd1ff],
  [0xff7a9c, 0xffc2d1, 0xfff0a8, 0xd6a4ff],
  [0xfff27a, 0xffffff, 0xffc94d, 0xff9f43],
];

export class World {
  heights = new Float32Array((SIZE + 1) * (SIZE + 1)); // vertex heights
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
  private stateData = new Uint8Array(SIZE * SIZE * 4);
  private dirty = false;

  startGlade = 0;

  constructor(seed = 7) {
    const rng = mulberry32(seed);
    this.generateGlades(rng);
    this.generateHeights(seed);
    this.staticTex = this.buildStaticTexture(seed);
    this.stateTex = new THREE.DataTexture(this.stateData, SIZE, SIZE, THREE.RGBAFormat);
    this.stateTex.magFilter = THREE.LinearFilter;
    this.stateTex.minFilter = THREE.LinearFilter;
    this.stateTex.needsUpdate = true;
  }

  // ---------- generation ----------

  private generateGlades(rng: () => number) {
    const cells = 5;
    const cellSize = SIZE / cells;
    const seeds: { x: number; z: number }[] = [];
    for (let cz = 0; cz < cells; cz++) {
      for (let cx = 0; cx < cells; cx++) {
        seeds.push({
          x: (cx + 0.2 + rng() * 0.6) * cellSize - HALF,
          z: (cz + 0.2 + rng() * 0.6) * cellSize - HALF,
        });
      }
    }
    // Pull the seed nearest the centre onto the centre so the start glade is in the middle.
    let best = 0;
    let bestD = Infinity;
    seeds.forEach((s, i) => {
      const d = s.x * s.x + s.z * s.z;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    seeds[best].x = 0;
    seeds[best].z = 0;
    this.startGlade = best;

    // Assign tiles to nearest seed using domain-warped coordinates for organic borders.
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const x = i - HALF + 0.5;
        const z = j - HALF + 0.5;
        const wx = x + (fbm(x * 0.04, z * 0.04, 3, 11) - 0.5) * 22;
        const wz = z + (fbm(x * 0.04, z * 0.04, 3, 29) - 0.5) * 22;
        let bi = 0;
        let bd = Infinity;
        for (let s = 0; s < seeds.length; s++) {
          const dx = wx - seeds[s].x;
          const dz = wz - seeds[s].z;
          const d = dx * dx + dz * dz;
          if (d < bd) {
            bd = d;
            bi = s;
          }
        }
        this.gladeOf[j * SIZE + i] = bi;
      }
    }

    // Creek beds: tiles that touch another glade. Then BFS distance from creeks.
    const queue: number[] = [];
    this.creekDist.fill(Infinity);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const t = j * SIZE + i;
        const g = this.gladeOf[t];
        const edge = i === 0 || j === 0 || i === SIZE - 1 || j === SIZE - 1;
        let border = false;
        if (!edge) {
          border = this.gladeOf[t + 1] !== g || this.gladeOf[t + SIZE] !== g;
        }
        if (border) {
          this.creekDist[t] = 0;
          queue.push(t);
        }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q];
      const i = t % SIZE;
      const j = (t / SIZE) | 0;
      const d = this.creekDist[t] + 1;
      const nb = [i > 0 ? t - 1 : -1, i < SIZE - 1 ? t + 1 : -1, j > 0 ? t - SIZE : -1, j < SIZE - 1 ? t + SIZE : -1];
      for (const n of nb) {
        if (n >= 0 && this.creekDist[n] > d) {
          this.creekDist[n] = d;
          queue.push(n);
        }
      }
    }

    // Glade metadata. Soil gets harder the further a glade is from the centre.
    const maxR = HALF * Math.SQRT2;
    seeds.forEach((s, id) => {
      const r = Math.hypot(s.x, s.z) / maxR;
      const soil = r < 0.3 ? Soil.Dirt : r < 0.62 ? Soil.Clay : Soil.Stone;
      const name = `${NAME_A[Math.floor(rng() * NAME_A.length)]} ${NAME_B[Math.floor(rng() * NAME_B.length)]}`;
      this.glades.push({
        id,
        name: id === best ? 'Heartseed Glade' : name,
        soil,
        seedX: s.x,
        seedZ: s.z,
        heartTile: -1,
        total: 0,
        bloomed: 0,
        completed: false,
        palette: PALETTES[Math.floor(rng() * PALETTES.length)],
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

    // Heart tile: the plantable tile of each glade nearest its seed and far from creeks.
    for (const g of this.glades) {
      let bt = -1;
      let bd = Infinity;
      for (let t = 0; t < SIZE * SIZE; t++) {
        if (this.gladeOf[t] !== g.id || this.soil[t] === Soil.Creek) continue;
        const [x, z] = this.tileCenter(t);
        const d = Math.hypot(x - g.seedX, z - g.seedZ) - Math.min(this.creekDist[t], 6) * 2;
        if (d < bd) {
          bd = d;
          bt = t;
        }
      }
      g.heartTile = bt;
    }
  }

  private generateHeights(seed: number) {
    const N = SIZE + 1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i - HALF;
        const z = j - HALF;
        let h = (fbm(x * 0.018, z * 0.018, 4, seed) - 0.5) * 14;
        h += (valueNoise(x * 0.11, z * 0.11, seed + 5) - 0.5) * 0.6;
        // Creek dip: sample the distance of nearby tiles
        const ti = Math.min(SIZE - 1, Math.max(0, i));
        const tj = Math.min(SIZE - 1, Math.max(0, j));
        let cd = Infinity;
        for (let dj = -1; dj <= 0; dj++) {
          for (let di = -1; di <= 0; di++) {
            const a = Math.min(SIZE - 1, Math.max(0, ti + di));
            const b = Math.min(SIZE - 1, Math.max(0, tj + dj));
            cd = Math.min(cd, this.creekDist[b * SIZE + a]);
          }
        }
        const dip = Math.max(0, 1 - cd / 3);
        h -= dip * dip * 1.4;
        // Outer stone glades are rougher and higher.
        const r = Math.hypot(x, z) / HALF;
        h += Math.max(0, r - 0.7) * 10 * fbm(x * 0.06, z * 0.06, 3, seed + 9);
        this.heights[j * N + i] = h;
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
      data[t * 4 + 3] = Math.floor(valueNoise(i * 0.3, j * 0.3, seed + 3) * 255);
    }
    const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // ---------- queries ----------

  tileCenter(t: number): [number, number] {
    return [(t % SIZE) - HALF + 0.5, ((t / SIZE) | 0) - HALF + 0.5];
  }

  tileAt(x: number, z: number): number {
    const i = Math.floor(x + HALF);
    const j = Math.floor(z + HALF);
    if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) return -1;
    return j * SIZE + i;
  }

  heightAt(x: number, z: number): number {
    const N = SIZE + 1;
    const fx = Math.min(SIZE - 0.001, Math.max(0, x + HALF));
    const fz = Math.min(SIZE - 0.001, Math.max(0, z + HALF));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h00 = this.heights[j * N + i];
    const h10 = this.heights[j * N + i + 1];
    const h01 = this.heights[(j + 1) * N + i];
    const h11 = this.heights[(j + 1) * N + i + 1];
    return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  }

  // ---------- state ----------

  markDirty(t: number) {
    const r = this.seeded[t] ? 90 + this.growth[t] * 165 : this.work[t] * 80;
    this.stateData[t * 4] = r;
    this.stateData[t * 4 + 1] = this.wet[t] ? 255 : 0;
    this.stateData[t * 4 + 2] = this.bloomed[t] ? 255 : 0;
    this.dirty = true;
  }

  flush() {
    if (this.dirty) {
      this.stateTex.needsUpdate = true;
      this.dirty = false;
    }
  }

  isPlantable(t: number) {
    return t >= 0 && this.soil[t] !== Soil.Creek && !this.seeded[t];
  }
}
