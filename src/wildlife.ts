import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint } from './rig';
import { Soil, wdist, World, wrap } from './world';

// Wildlife: as the planet recovers, animals come back to it in stages (butterflies first, then
// songbirds, rabbits, deer and foxes). They live only on restored ground near the nymph:
// each species keeps a small population around her, more where more of the land nearby is
// restored, spawning out of the way and leaving when she's gone. They shy away as she comes
// close (further from a mount). Purely for looks: they don't touch the economy.

export interface Species {
  id: SpeciesId;
  /** Planet restored (%) when they come back. */
  at: number;
  /** What the toast says when they do. */
  news: string;
  max: number;
}
export type SpeciesId = 'butterfly' | 'bird' | 'rabbit' | 'deer' | 'fox';

export const SPECIES: Species[] = [
  { id: 'butterfly', at: 3, news: 'Butterflies have found the flowers.', max: 18 },
  { id: 'bird', at: 10, news: 'Songbirds are back in the restored glades.', max: 14 },
  { id: 'rabbit', at: 25, news: 'Rabbits have come out of hiding.', max: 10 },
  { id: 'deer', at: 45, news: 'Deer are grazing in the meadows again.', max: 8 },
  { id: 'fox', at: 70, news: 'A fox has been seen trotting through the grass.', max: 3 },
];

const NEAR = 22; // spawn at least this far away (out of the way)
const FAR = 70; // ...and within this
const GONE = 95; // past this they leave

// ---------- models (each faces +z, feet at y = 0) ----------

type Geo = THREE.BufferGeometry;
interface Xf {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
}
/** A painted part, placed. */
function part(g: Geo, color: number, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] }: Xf = {}) {
  g.scale(...s);
  g.rotateX(r[0]);
  g.rotateY(r[1]);
  g.rotateZ(r[2]);
  g.translate(...p);
  return paint(g, color);
}
const ball = (n = 8) => new THREE.SphereGeometry(1, n, Math.max(4, Math.round(n * 0.7)));
const merged = (parts: Geo[]) => mergeGeometries(parts)!;

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const MAT_DS = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

function rabbitGeo() {
  const fur = 0x9a7b5c;
  return merged([
    part(ball(), fur, { p: [0, 0.13, -0.02], s: [0.11, 0.11, 0.15] }),
    part(ball(), 0xe8dcc8, { p: [0, 0.1, 0.05], s: [0.07, 0.07, 0.08] }),
    part(ball(), fur, { p: [0, 0.23, 0.12], s: [0.075, 0.07, 0.085] }),
    ...[-1, 1].flatMap((sd) => [
      part(ball(6), fur, { p: [sd * 0.03, 0.34, 0.09], r: [-0.35, 0, sd * 0.15], s: [0.025, 0.09, 0.014] }),
      part(ball(6), 0xd8a0a0, { p: [sd * 0.03, 0.34, 0.1], r: [-0.35, 0, sd * 0.15], s: [0.014, 0.07, 0.006] }),
      part(ball(4), 0x111111, { p: [sd * 0.055, 0.25, 0.17], s: [0.014, 0.014, 0.014] }),
      part(ball(5), fur, { p: [sd * 0.07, 0.06, -0.06], s: [0.04, 0.05, 0.08] }), // haunches
    ]),
    part(ball(6), 0xf4f0ea, { p: [0, 0.15, -0.17], s: [0.04, 0.04, 0.04] }),
    part(ball(4), 0x7a5048, { p: [0, 0.22, 0.2], s: [0.015, 0.012, 0.01] }),
  ]);
}

const BIRD_COLORS: [number, number][] = [
  [0x7a5a3c, 0xd86a2a], // robin-ish: brown back, orange breast
  [0x3a6fc8, 0xd88a4a], // blue back, rusty breast
  [0xd8b830, 0x2a2a2a], // yellow, dark wings
  [0x6a6a70, 0xe8e0d0], // grey and cream
];
function birdGeo([back, breast]: [number, number]) {
  return merged([
    part(ball(), back, { p: [0, 0.07, 0], s: [0.045, 0.045, 0.07] }),
    part(ball(), breast, { p: [0, 0.06, 0.025], s: [0.038, 0.04, 0.045] }),
    part(ball(), back, { p: [0, 0.12, 0.05], s: [0.033, 0.033, 0.033] }),
    part(new THREE.ConeGeometry(0.012, 0.03, 5), 0xe0a030, { p: [0, 0.118, 0.09], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.BoxGeometry(0.04, 0.008, 0.06), back, { p: [0, 0.08, -0.08], r: [-0.3, 0, 0] }),
    ...[-1, 1].flatMap((sd) => [
      part(ball(4), 0x111111, { p: [sd * 0.025, 0.128, 0.068], s: [0.008, 0.008, 0.008] }),
      part(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 4), 0x5a4030, { p: [sd * 0.015, 0.02, 0] }),
    ]),
  ]);
}
/** One wing, from its root at the origin out along +x (flaps about z). */
function wingGeo(color: number, span: number, chord: number) {
  return merged([
    part(new THREE.CircleGeometry(1, 10), color, {
      p: [span / 2, 0, 0],
      r: [-Math.PI / 2, 0, 0],
      s: [span / 2, chord / 2, 1],
    }),
  ]);
}

const BUTTERFLY_COLORS: [number, number][] = [
  [0xf2c230, 0x2a2010], // yellow
  [0xf4f0e8, 0x606060], // white
  [0xe8702a, 0x1a1008], // orange
  [0x5aa0e8, 0x203048], // blue
];
function butterflyWing([c, edge]: [number, number]) {
  return merged([
    part(new THREE.CircleGeometry(1, 10), edge, { p: [0.05, 0, 0.012], r: [-Math.PI / 2, 0, 0], s: [0.055, 0.04, 1] }),
    part(new THREE.CircleGeometry(1, 10), c, {
      p: [0.05, 0.001, 0.012],
      r: [-Math.PI / 2, 0, 0],
      s: [0.047, 0.033, 1],
    }),
    part(new THREE.CircleGeometry(1, 10), c, { p: [0.035, 0, -0.03], r: [-Math.PI / 2, 0, 0], s: [0.035, 0.028, 1] }),
  ]);
}
function butterflyBody() {
  return merged([part(ball(5), 0x1a1410, { s: [0.008, 0.008, 0.035] })]);
}

const DEER_COAT = 0xa8774a;
function deerBody() {
  return merged([
    // barrel, deep chest and round haunches, so it isn't a sausage on sticks
    part(ball(10), DEER_COAT, { p: [0, 0, 0], s: [0.17, 0.2, 0.38] }),
    part(ball(10), DEER_COAT, { p: [0, 0.01, 0.25], s: [0.17, 0.23, 0.2] }),
    part(ball(10), DEER_COAT, { p: [0, 0.03, -0.27], s: [0.18, 0.22, 0.2] }),
    part(ball(8), 0xe8d8c0, { p: [0, -0.1, 0.02], s: [0.12, 0.11, 0.3] }),
    ...[-1, 1].flatMap((sd) => [
      part(ball(8), DEER_COAT, { p: [sd * 0.1, -0.08, 0.27], s: [0.07, 0.16, 0.1] }), // shoulders
      part(ball(8), DEER_COAT, { p: [sd * 0.1, -0.06, -0.28], s: [0.08, 0.19, 0.13] }), // thighs
    ]),
    // a pale rump patch and a little white tail
    part(ball(8), 0xf2ead8, { p: [0, 0.03, -0.44], s: [0.1, 0.12, 0.04] }),
    part(ball(6), 0xf8f4ec, { p: [0, 0.13, -0.47], r: [0.6, 0, 0], s: [0.035, 0.08, 0.03] }),
  ]);
}
function deerNeck() {
  // From the shoulders (origin) up and forward to the head.
  return merged([
    part(new THREE.CylinderGeometry(0.07, 0.11, 0.48, 8), DEER_COAT, { p: [0, 0.22, 0.08], r: [0.35, 0, 0] }),
    part(ball(8), DEER_COAT, { p: [0, 0.46, 0.18], s: [0.075, 0.08, 0.1] }),
    part(ball(8), DEER_COAT, { p: [0, 0.43, 0.3], s: [0.045, 0.05, 0.1] }),
    part(ball(5), 0x2a1a12, { p: [0, 0.43, 0.39], s: [0.025, 0.02, 0.012] }),
    ...[-1, 1].flatMap((sd) => [
      part(ball(6), DEER_COAT, { p: [sd * 0.08, 0.55, 0.12], r: [0, 0, sd * 0.9], s: [0.03, 0.08, 0.015] }),
      part(ball(4), 0x111111, { p: [sd * 0.06, 0.48, 0.24], s: [0.014, 0.016, 0.014] }),
    ]),
  ]);
}
function legGeo(len: number, r: number, color: number, hoof: number) {
  const g = new THREE.CylinderGeometry(r, r * 0.6, len, 6);
  g.translate(0, -len / 2, 0);
  return merged([
    paint(g, color),
    part(new THREE.CylinderGeometry(r * 0.7, r * 0.8, 0.05, 6), hoof, { p: [0, -len, 0] }),
  ]);
}

const FOX = 0xd8642a;
function foxBody() {
  return merged([
    part(ball(8), FOX, { s: [0.09, 0.1, 0.24] }),
    part(ball(8), 0xf4ece0, { p: [0, -0.03, 0.14], s: [0.07, 0.08, 0.1] }),
    part(ball(8), FOX, { p: [0, 0.08, 0.27], s: [0.075, 0.07, 0.08] }),
    part(new THREE.ConeGeometry(0.035, 0.12, 6), FOX, { p: [0, 0.06, 0.38], r: [Math.PI / 2, 0, 0] }),
    part(ball(4), 0x111111, { p: [0, 0.065, 0.44], s: [0.015, 0.013, 0.012] }),
    ...[-1, 1].flatMap((sd) => [
      part(new THREE.ConeGeometry(0.035, 0.08, 4), 0x3a2418, { p: [sd * 0.045, 0.17, 0.25] }),
      part(ball(4), 0x111111, { p: [sd * 0.04, 0.1, 0.33], s: [0.012, 0.012, 0.012] }),
    ]),
  ]);
}
function foxTail() {
  return merged([
    part(ball(8), FOX, { p: [0, 0, -0.2], s: [0.06, 0.06, 0.2] }),
    part(ball(6), 0xf8f4ec, { p: [0, 0, -0.38], s: [0.04, 0.04, 0.05] }),
  ]);
}

// ---------- animals ----------

interface Animal {
  sp: SpeciesId;
  obj: THREE.Group;
  x: number;
  z: number;
  y: number; // height above the ground
  yaw: number;
  state: string;
  t: number; // time left in this state
  tx: number; // where it's going
  tz: number;
  phase: number;
  /** Moving parts, by name. */
  parts: Record<string, THREE.Object3D>;
  /** Butterflies: the spot they flutter round. Deer: their herd. */
  ax: number;
  az: number;
}

export class Wildlife {
  group = new THREE.Group();
  /** How many species have come back (SPECIES order). */
  stage = 0;
  private animals: Animal[] = [];
  private probe = new Map<SpeciesId, number>(); // how often spawn spots land on restored ground
  private spawnT = 0;
  private geos = {
    rabbit: rabbitGeo(),
    birds: BIRD_COLORS.map(birdGeo),
    birdWings: BIRD_COLORS.map(([back]) => wingGeo(back, 0.09, 0.06)),
    butterflyWings: BUTTERFLY_COLORS.map(butterflyWing),
    butterflyBody: butterflyBody(),
    deerBody: deerBody(),
    deerNeck: deerNeck(),
    deerLeg: legGeo(0.62, 0.045, DEER_COAT, 0x2a1d16),
    foxBody: foxBody(),
    foxTail: foxTail(),
    foxLeg: legGeo(0.24, 0.025, 0x3a2418, 0x1a1008),
  };

  constructor(
    private world: World,
    private density = 1,
  ) {}

  /** Which species are back at this much of the planet restored. */
  static stageAt(pct: number) {
    return SPECIES.filter((s) => pct >= s.at).length;
  }

  /** Clear them all (a world was loaded). */
  reset(stage: number) {
    this.stage = stage;
    for (const a of this.animals) this.group.remove(a.obj);
    this.animals = [];
    this.probe.clear();
  }

  private ok(sp: SpeciesId, x: number, z: number) {
    const w = this.world;
    const t = w.tileAt(x, z);
    if (w.soil[t] === Soil.Creek) return false;
    // Butterflies visit any flowers; the rest live in glades that are fully restored.
    return sp === 'butterfly' ? !!w.bloomed[t] : w.glades[w.gladeOf[t]].completed;
  }

  private make(sp: SpeciesId, x: number, z: number, rnd = Math.random): Animal {
    const obj = new THREE.Group();
    const parts: Record<string, THREE.Object3D> = {};
    const add = (name: string, geo: Geo, parent: THREE.Object3D = obj, mat = MAT) => {
      const m = new THREE.Mesh(geo, mat);
      parent.add(m);
      parts[name] = m;
      return m;
    };
    const pivot = (name: string, parent: THREE.Object3D, px: number, py: number, pz: number) => {
      const g = new THREE.Group();
      g.position.set(px, py, pz);
      parent.add(g);
      parts[name] = g;
      return g;
    };
    if (sp === 'rabbit') {
      add('body', this.geos.rabbit);
      obj.scale.setScalar(1.3);
    } else if (sp === 'bird') {
      const k = Math.floor(rnd() * BIRD_COLORS.length);
      add('body', this.geos.birds[k]);
      obj.scale.setScalar(1.6); // small birds vanish in this grass
      for (const [n, sd] of [
        ['wl', -1],
        ['wr', 1],
      ] as const) {
        const p = pivot(n, obj, sd * 0.035, 0.085, 0.01);
        const m = add(n + 'm', this.geos.birdWings[k], p, MAT_DS);
        m.scale.x = sd;
      }
    } else if (sp === 'butterfly') {
      const k = Math.floor(rnd() * BUTTERFLY_COLORS.length);
      add('body', this.geos.butterflyBody);
      for (const [n, sd] of [
        ['wl', -1],
        ['wr', 1],
      ] as const) {
        const p = pivot(n, obj, 0, 0, 0);
        const m = add(n + 'm', this.geos.butterflyWings[k], p, MAT_DS);
        m.scale.x = sd;
      }
      obj.scale.setScalar(2);
    } else if (sp === 'deer') {
      const body = pivot('torso', obj, 0, 0.82, 0);
      add('body', this.geos.deerBody, body);
      const neck = pivot('neck', body, 0, 0.06, 0.3);
      add('neckm', this.geos.deerNeck, neck);
      for (const [n, px, pz] of [
        ['fl', -0.09, 0.28],
        ['fr', 0.09, 0.28],
        ['hl', -0.09, -0.28],
        ['hr', 0.09, -0.28],
      ] as const) {
        const p = pivot(n, body, px, -0.12, pz);
        add(n + 'm', this.geos.deerLeg, p);
      }
      obj.scale.setScalar(0.9 + rnd() * 0.2);
    } else {
      const body = pivot('torso', obj, 0, 0.3, 0);
      add('body', this.geos.foxBody, body);
      const tail = pivot('tail', body, 0, 0.04, -0.22);
      tail.rotation.x = -0.35;
      add('tailm', this.geos.foxTail, tail);
      for (const [n, px, pz] of [
        ['fl', -0.05, 0.14],
        ['fr', 0.05, 0.14],
        ['hl', -0.05, -0.15],
        ['hr', 0.05, -0.15],
      ] as const) {
        const p = pivot(n, body, px, -0.05, pz);
        add(n + 'm', this.geos.foxLeg, p);
      }
    }
    const a: Animal = {
      sp,
      obj,
      x,
      z,
      y: sp === 'butterfly' ? 1 : 0,
      yaw: rnd() * Math.PI * 2,
      state: 'idle',
      t: rnd() * 3,
      tx: x,
      tz: z,
      phase: rnd() * 10,
      parts,
      ax: x,
      az: z,
    };
    this.group.add(obj);
    this.animals.push(a);
    return a;
  }

  /** A random spot round the player, between NEAR and FAR. */
  private spot(px: number, pz: number): [number, number] {
    const a = Math.random() * Math.PI * 2;
    const r = NEAR + Math.random() * (FAR - NEAR);
    return [wrap(px + Math.cos(a) * r), wrap(pz + Math.sin(a) * r)];
  }

  /** Keep each species' numbers right round the player (a few times a second is plenty). */
  private populate(px: number, pz: number) {
    for (let i = 0; i < this.stage; i++) {
      const sp = SPECIES[i];
      const [x, z] = this.spot(px, pz);
      const hit = this.ok(sp.id, x, z) ? 1 : 0;
      // How much of the land round her is restored, smoothed over many probes.
      const share = (this.probe.get(sp.id) ?? hit) * 0.93 + hit * 0.07;
      this.probe.set(sp.id, share);
      const want = Math.round(sp.max * this.density * Math.min(1, share * 1.3));
      const have = this.animals.filter((a) => a.sp === sp.id).length;
      if (!hit || have >= want) continue;
      if (sp.id === 'deer') {
        // Deer come in small herds.
        const n = Math.min(want - have, 2 + Math.floor(Math.random() * 3));
        for (let k = 0; k < n; k++) {
          const dx = wrap(x + (Math.random() - 0.5) * 6);
          const dz = wrap(z + (Math.random() - 0.5) * 6);
          if (!this.ok('deer', dx, dz)) continue;
          const d = this.make('deer', dx, dz);
          d.ax = x;
          d.az = z;
        }
      } else this.make(sp.id, x, z);
    }
  }

  update(dt: number, time: number, player: THREE.Vector3, riding: boolean) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.25;
      if (this.stage) this.populate(player.x, player.z);
    }
    const w = this.world;
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      const d = wdist(a.x, a.z, player.x, player.z);
      if (d > GONE) {
        this.group.remove(a.obj);
        this.animals.splice(i, 1);
        continue;
      }
      // Away from the player (a unit vector).
      const ax = d > 0.01 ? wrap(a.x - player.x) / d : 1;
      const az = d > 0.01 ? wrap(a.z - player.z) / d : 0;
      const shy = riding ? 1.6 : 1;
      a.t -= dt;
      a.phase += dt;
      switch (a.sp) {
        case 'butterfly':
          this.butterfly(a, dt, time, d < 2.5 * shy, ax, az);
          break;
        case 'bird':
          this.bird(a, dt, d < 6 * shy, ax, az);
          break;
        case 'rabbit':
          this.rabbit(a, dt, d < 6 * shy, ax, az);
          break;
        case 'deer':
          this.deer(a, dt, d, shy, ax, az, player);
          break;
        case 'fox':
          this.fox(a, dt, d < 7 * shy, ax, az);
          break;
      }
      a.x = wrap(a.x);
      a.z = wrap(a.z);
      a.obj.position.set(a.x, w.heightAt(a.x, a.z) + a.y, a.z);
      a.obj.rotation.y = a.yaw;
    }
  }

  /** Step toward (tx, tz) at speed; returns the distance left. */
  private walk(a: Animal, speed: number, dt: number, turn = 6) {
    const dx = wrap(a.tx - a.x);
    const dz = wrap(a.tz - a.z);
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    // Turn toward where it's going, then move the way it faces (so it curves, not slides).
    let dy = Math.atan2(dx, dz) - a.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    a.yaw += dy * Math.min(1, turn * dt);
    const f = Math.max(0, Math.cos(dy));
    a.x += Math.sin(a.yaw) * step * f;
    a.z += Math.cos(a.yaw) * step * f;
    return d;
  }

  /** Somewhere nearby on restored ground (or its own spot if nothing turns up). */
  private wander(a: Animal, r: number, cx = a.x, cz = a.z) {
    for (let k = 0; k < 6; k++) {
      const ang = Math.random() * Math.PI * 2;
      const x = wrap(cx + Math.cos(ang) * r * (0.3 + Math.random() * 0.7));
      const z = wrap(cz + Math.sin(ang) * r * (0.3 + Math.random() * 0.7));
      if (this.ok(a.sp, x, z)) {
        a.tx = x;
        a.tz = z;
        return;
      }
    }
    a.tx = a.x;
    a.tz = a.z;
  }

  private flee(a: Animal, ax: number, az: number, dist: number) {
    const side = (Math.random() - 0.5) * 0.8;
    a.tx = a.x + (ax - az * side) * dist;
    a.tz = a.z + (az + ax * side) * dist;
  }

  private butterfly(a: Animal, dt: number, time: number, near: boolean, ax: number, az: number) {
    // Flutter in loops round a drifting spot over the flowers, bobbing up and down.
    if (a.t <= 0) {
      a.t = 3 + Math.random() * 5;
      this.wander(a, 4, a.ax, a.az);
      a.ax = a.tx;
      a.az = a.tz;
    }
    if (near) {
      a.ax += ax * dt * 3;
      a.az += az * dt * 3;
    }
    const p = a.phase;
    a.tx = a.ax + Math.sin(p * 0.9) * 1.2 + Math.sin(p * 2.3) * 0.4;
    a.tz = a.az + Math.cos(p * 0.7) * 1.2 + Math.cos(p * 1.9) * 0.4;
    this.walk(a, 1.6, dt, 4);
    a.y += ((near ? 2.2 : 0.7 + Math.sin(p * 1.3) * 0.35 + Math.sin(p * 3.1) * 0.12) - a.y) * Math.min(1, dt * 2);
    const flap = Math.sin(time * 22 + a.phase * 3) * 0.9 + 0.3;
    a.parts.wl.rotation.z = -flap;
    a.parts.wr.rotation.z = flap;
  }

  private bird(a: Animal, dt: number, near: boolean, ax: number, az: number) {
    const P = a.parts;
    if (a.state === 'fly') {
      const total = Math.max(1, a.ax);
      const left = this.walk(a, 9, dt, 10);
      const k = 1 - left / total; // 0..1 along the flight
      a.y = Math.sin(Math.min(1, k) * Math.PI) * Math.min(7, total * 0.3) + 0.05;
      const flap = Math.sin(a.phase * 28) * 1.1;
      P.wl.rotation.z = -flap;
      P.wr.rotation.z = flap;
      P.body.rotation.x = 0;
      if (left < 0.1) {
        a.state = 'peck';
        a.t = 2 + Math.random() * 4;
        a.y = 0;
      }
      return;
    }
    // On the ground: fold the wings, peck, and hop about now and then.
    P.wl.rotation.z = 1.3;
    P.wr.rotation.z = -1.3;
    const takeOff = (tx: number, tz: number) => {
      a.state = 'fly';
      a.tx = tx;
      a.tz = tz;
      a.ax = wdist(a.x, a.z, tx, tz);
    };
    if (near) {
      const ang = Math.atan2(az, ax) + (Math.random() - 0.5) * 1.2;
      const r = 20 + Math.random() * 20;
      return takeOff(a.x + Math.cos(ang) * r, a.z + Math.sin(ang) * r);
    }
    if (a.state === 'hop') {
      const left = this.walk(a, 1.5, dt, 12);
      a.y = Math.abs(Math.sin(a.phase * 14)) * 0.05;
      if (left < 0.05) {
        a.state = 'peck';
        a.t = 1 + Math.random() * 3;
        a.y = 0;
      }
      return;
    }
    P.body.rotation.x = Math.max(0, Math.sin(a.phase * 6)) ** 4 * 0.5; // pecking
    if (a.t <= 0) {
      if (Math.random() < 0.12) {
        this.wander(a, 25);
        takeOff(a.tx, a.tz);
      } else {
        a.state = 'hop';
        this.wander(a, 1.5);
      }
    }
  }

  private rabbit(a: Animal, dt: number, near: boolean, ax: number, az: number) {
    const body = a.parts.body;
    if (near && a.state !== 'flee') {
      a.state = 'flee';
      a.t = 2.5;
      this.flee(a, ax, az, 14);
    }
    if (a.state === 'flee' || a.state === 'hop') {
      const fast = a.state === 'flee';
      const left = this.walk(a, fast ? 6 : 1.6, dt, fast ? 8 : 5);
      const hz = fast ? 4 : 2.5;
      a.y = Math.abs(Math.sin(a.phase * Math.PI * hz)) * (fast ? 0.3 : 0.15);
      body.rotation.x = Math.cos(a.phase * Math.PI * hz) * 0.25;
      body.scale.set(1, 1, 1);
      if (left < 0.1 || a.t <= 0) {
        a.state = 'graze';
        a.t = 2 + Math.random() * 5;
        a.y = 0;
        body.rotation.x = 0;
      }
      return;
    }
    // Sitting: nose twitching, now and then up on its haunches to look round.
    const up = a.t % 4 < 1 ? 1 : 0;
    body.rotation.x += (-up * 0.5 - body.rotation.x) * Math.min(1, dt * 6);
    body.scale.set(1, 1 + Math.sin(a.phase * 25) * 0.01, 1);
    if (a.t <= 0) {
      a.state = 'hop';
      a.t = 6;
      this.wander(a, 3);
    }
  }

  private deer(a: Animal, dt: number, d: number, shy: number, ax: number, az: number, player: THREE.Vector3) {
    const P = a.parts;
    let speed = 0;
    if (d < 10 * shy && a.state !== 'flee') {
      a.state = 'flee';
      a.t = 3 + Math.random();
      this.flee(a, ax, az, 30);
    } else if (d < 20 * shy && (a.state === 'graze' || a.state === 'idle')) {
      a.state = 'alert';
      a.t = 2 + Math.random() * 2;
    }
    let neck = 0.1; // head up
    if (a.state === 'flee') {
      speed = this.walk(a, 9, dt, 3) > 0.2 ? 9 : 0;
      if (a.t <= 0 || !speed) {
        a.state = 'walk';
        a.ax = a.x;
        a.az = a.z;
        this.wander(a, 8);
      }
    } else if (a.state === 'walk') {
      speed = this.walk(a, 1.3, dt, 3) > 0.2 ? 1.3 : 0;
      neck = 0.4;
      if (!speed) {
        a.state = 'graze';
        a.t = 4 + Math.random() * 8;
      }
    } else if (a.state === 'alert') {
      // Head up, turned toward her.
      let dy = Math.atan2(wrap(player.x - a.x), wrap(player.z - a.z)) - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.yaw += dy * Math.min(1, dt * 2);
      neck = -0.15;
      if (a.t <= 0) {
        a.state = 'graze';
        a.t = 3;
      }
    } else {
      // Grazing: head down, a step now and then, staying near the herd.
      neck = 1.5 + Math.sin(a.phase * 0.7) * 0.1;
      if (a.t <= 0) {
        a.state = 'walk';
        this.wander(a, 6, a.ax, a.az);
      }
    }
    P.neck.rotation.x += (neck - P.neck.rotation.x) * Math.min(1, dt * 3);
    this.legs(a, dt, speed, speed > 4 ? 0.7 : 0.35, speed > 4 ? 2.6 : 1.4, 0.82, speed > 4 ? 0.12 : 0.02);
  }

  private fox(a: Animal, dt: number, near: boolean, ax: number, az: number) {
    let speed = 0;
    if (near && a.state !== 'flee') {
      a.state = 'flee';
      a.t = 3;
      this.flee(a, ax, az, 25);
    }
    if (a.state === 'flee' || a.state === 'trot') {
      const v = a.state === 'flee' ? 8 : 2.6;
      speed = this.walk(a, v, dt, 4) > 0.2 ? v : 0;
      if (!speed || (a.state === 'flee' && a.t <= 0)) {
        a.state = 'sit';
        a.t = 2 + Math.random() * 6;
      }
    } else if (a.t <= 0) {
      a.state = 'trot';
      this.wander(a, 20);
    }
    a.parts.tail.rotation.y = Math.sin(a.phase * (speed ? 6 : 1.5)) * (speed ? 0.25 : 0.4);
    this.legs(a, dt, speed, 0.6, 1.2, 0.3, speed > 4 ? 0.05 : 0.015);
  }

  /** Swing four legs in a trot (diagonal pairs) at a speed, bobbing the body. */
  private legs(a: Animal, dt: number, speed: number, swing: number, stride: number, rest: number, bob: number) {
    const P = a.parts;
    const move = Math.min(1, speed / 1.2);
    const cyc = (P.torso.userData.cyc = (P.torso.userData.cyc ?? 0) + (speed / stride) * Math.PI * 2 * dt);
    const s = Math.sin(cyc) * swing * move;
    P.fl.rotation.x = s;
    P.hr.rotation.x = s;
    P.fr.rotation.x = -s;
    P.hl.rotation.x = -s;
    P.torso.position.y = rest + Math.abs(Math.sin(cyc)) * bob * move;
  }
}
