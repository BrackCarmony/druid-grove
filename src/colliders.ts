import * as THREE from 'three';

// Circle colliders on the ground plane, bucketed in a spatial hash.

export interface Circle {
  x: number;
  z: number;
  r: number;
}

const CELL = 4;
const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

export class Colliders {
  private cells = new Map<number, Circle[]>();

  add(x: number, z: number, r: number): Circle {
    const c = { x, z, r };
    this.forCells(c, (k) => {
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(c);
    });
    return c;
  }

  remove(c: Circle) {
    this.forCells(c, (k) => {
      const list = this.cells.get(k);
      if (!list) return;
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    });
  }

  /** Push a body of the given radius out of any overlapping circles. */
  resolve(pos: THREE.Vector3, radius: number) {
    for (let iter = 0; iter < 2; iter++) {
      const i0 = Math.floor((pos.x - radius) / CELL) - 1;
      const i1 = Math.floor((pos.x + radius) / CELL) + 1;
      const j0 = Math.floor((pos.z - radius) / CELL) - 1;
      const j1 = Math.floor((pos.z + radius) / CELL) + 1;
      let moved = false;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = this.cells.get(key(i, j));
          if (!list) continue;
          for (const c of list) {
            const dx = pos.x - c.x;
            const dz = pos.z - c.z;
            const min = c.r + radius;
            const d2 = dx * dx + dz * dz;
            if (d2 >= min * min) continue;
            const d = Math.sqrt(d2) || 0.0001;
            pos.x = c.x + (dx / d) * min;
            pos.z = c.z + (dz / d) * min;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  private forCells(c: Circle, fn: (k: number) => void) {
    const i0 = Math.floor((c.x - c.r) / CELL);
    const i1 = Math.floor((c.x + c.r) / CELL);
    const j0 = Math.floor((c.z - c.r) / CELL);
    const j1 = Math.floor((c.z + c.r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(key(i, j));
  }
}
