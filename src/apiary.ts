import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Colliders } from './colliders';
import { Economy, HIVE } from './economy';
import { HALF, tileIndex, wdist, World, wrap } from './world';

// The production branch: beehives make honey from the blooms around them, and
// bears lumber between the hives and their Bear Den carrying it home. There's a den
// at home and more can be built further out. Honey is the currency for fairy rings.

const DEN_RANGE = 4.5;
const HIVE_RANGE = 3;
const MIN_SPACING = 8;
const DEN_SPACING = 40;
const BEES_PER_HIVE = 14;
const MAX_BEES = 2048;
const BEE_DRAW_DIST = 140;

const lam = (color: number, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });

function colored(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = c.r;
    arr[i + 1] = c.g;
    arr[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function bearGeometry(withPot: boolean) {
  const fur = 0x7a4f30;
  const muzzle = 0xd9b48a;
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.55, 10, 8);
  body.scale(0.95, 0.85, 1.25);
  body.translate(0, 0.75, 0);
  parts.push(colored(body, fur));
  const head = new THREE.SphereGeometry(0.34, 10, 8);
  head.translate(0, 1.15, 0.7);
  parts.push(colored(head, fur));
  const snout = new THREE.SphereGeometry(0.15, 8, 6);
  snout.scale(1, 0.8, 1);
  snout.translate(0, 1.07, 1.0);
  parts.push(colored(snout, muzzle));
  const nose = new THREE.SphereGeometry(0.05, 6, 4);
  nose.translate(0, 1.12, 1.14);
  parts.push(colored(nose, 0x1a120c));
  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.1, 6, 4);
    ear.scale(1, 1, 0.5);
    ear.translate(s * 0.22, 1.43, 0.66);
    parts.push(colored(ear, fur));
    const eye = new THREE.SphereGeometry(0.035, 5, 4);
    eye.translate(s * 0.12, 1.23, 0.98);
    parts.push(colored(eye, 0x111111));
    for (const f of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.15, 0.16, 0.45, 7);
      leg.translate(s * 0.32, 0.22, f * 0.42);
      parts.push(colored(leg, fur));
    }
  }
  const belly = new THREE.SphereGeometry(0.38, 8, 6);
  belly.scale(0.9, 0.8, 1);
  belly.translate(0, 0.62, 0.35);
  parts.push(colored(belly, muzzle));
  if (withPot) {
    const pot = new THREE.CylinderGeometry(0.2, 0.17, 0.32, 9);
    pot.translate(0, 0.95, 1.0);
    parts.push(colored(pot, 0xc98a3b));
    const honey = new THREE.CylinderGeometry(0.19, 0.19, 0.04, 9);
    honey.translate(0, 1.12, 1.0);
    parts.push(colored(honey, 0xffb627));
  }
  return mergeGeometries(parts)!;
}

function beeGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.07, 6, 4);
  body.scale(0.8, 0.8, 1.2);
  parts.push(colored(body, 0xffc21a));
  const stripe = new THREE.CylinderGeometry(0.058, 0.058, 0.03, 6);
  stripe.rotateX(Math.PI / 2);
  stripe.translate(0, 0, -0.02);
  parts.push(colored(stripe, 0x221a10));
  for (const s of [-1, 1]) {
    const wing = new THREE.SphereGeometry(0.05, 5, 3);
    wing.scale(1, 0.15, 0.6);
    wing.translate(s * 0.06, 0.05, 0);
    parts.push(colored(wing, 0xf4f8ff));
  }
  return mergeGeometries(parts)!;
}

function hiveModel() {
  const g = new THREE.Group();
  const straw = lam(0xd9a24a);
  const dark = lam(0xa8742c);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.5, 8), lam(0x6b4a33));
  stand.position.y = 0.25;
  g.add(stand);
  // a classic straw skep: stacked coils shrinking toward the top
  for (let k = 0; k < 6; k++) {
    const r = 0.62 * Math.cos((k / 6) * 1.25);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.12, r), 0.13, 6, 14), k % 2 ? straw : dark);
    coil.rotation.x = Math.PI / 2;
    coil.position.y = 0.6 + k * 0.2;
    g.add(coil);
  }
  const fill = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), straw);
  fill.scale.y = 1.7;
  fill.position.y = 0.55;
  g.add(fill);
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10), lam(0x2a1a0c));
  door.position.set(0, 0.7, 0.68);
  g.add(door);
  // honey drip that swells as the hive fills
  const drip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lam(0xffb627, 0x553300));
  drip.position.set(0, 0.55, 0.7);
  drip.name = 'drip';
  g.add(drip);
  return g;
}

// ---------- bear den ----------
// The den is a lathed earth mound whose base flares outward below ground, so on a slope it
// always meets the terrain. A tunnel is cut into the front (local +z): the mound's shader
// discards fragments inside the arch, and a black half-tube behind it makes the dark cave.

const DEN_X_SCALE = 1.15; // the mound is a little wider than it is deep
/** Mound profile as (radius, height) from the top down; continues below ground as a skirt. */
const DEN_PROFILE: [number, number][] = [
  [0, 2.75],
  [1.2, 2.6],
  [2.1, 2.05],
  [2.7, 1.25],
  [3.0, 0.45],
  [3.15, 0],
  [3.6, -1.2],
  [4.3, -2.8],
  [5.0, -4.5],
];
const CAVE_W = 1.05; // half-width of the opening
const CAVE_H = 1.7; // height of the opening
const CAVE_BACK = 0.5; // the tunnel's far end (local z)
/** Local z of a den spot: deep in the cave, and just outside the mouth. */
export const DEN_INSIDE = 1.0;
/** Bears outside keep this far from a den's centre (the mound plus a bear's width). */
const DEN_AVOID = 3.9;
export const DEN_MOUTH = 4.3;

function profileR(y: number) {
  const p = DEN_PROFILE;
  if (y >= p[0][1]) return p[0][0];
  for (let i = 1; i < p.length; i++) {
    if (y >= p[i][1]) {
      const [r0, y0] = p[i - 1];
      const [r1, y1] = p[i];
      return r1 + ((r0 - r1) * (y - y1)) / (y0 - y1);
    }
  }
  return p[p.length - 1][0];
}

/** Where the mound's front surface is at a given local x and height. */
function frontZ(x: number, y: number) {
  const r = profileR(y);
  const u = x / DEN_X_SCALE;
  return Math.sqrt(Math.max(0, r * r - u * u));
}

/** A Lambert material that cuts the cave opening out of whatever uses it. */
function caveCutMaterial(color: number) {
  const m = new THREE.MeshLambertMaterial({ color });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDenLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDenLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDenLocal;')
      .replace(
        'void main() {',
        `void main() {
  vec2 cave = vDenLocal.xy / vec2(${CAVE_W.toFixed(3)}, ${CAVE_H.toFixed(3)});
  if (vDenLocal.z > ${CAVE_BACK.toFixed(3)} && vDenLocal.y > -0.05 && dot(cave, cave) < 1.0) discard;`,
      );
  };
  m.customProgramCacheKey = () => 'den-cave-cut';
  return m;
}

function moundGeometry(fromY: number, grow: number) {
  const pts = DEN_PROFILE.filter(([, y]) => y >= fromY).map(
    ([r, y]) => new THREE.Vector2(r * grow, y + (grow - 1) * 0.6),
  );
  if (pts[pts.length - 1].y > fromY) pts.push(new THREE.Vector2(profileR(fromY) * grow, fromY));
  pts.reverse(); // lathe wants bottom to top for outward normals
  const g = new THREE.LatheGeometry(pts, 28);
  g.scale(DEN_X_SCALE, 1, 1);
  return g;
}

/** Half-tube for the tunnel: arch over local z from CAVE_BACK out to the mound's surface. */
function tunnelGeometry(w: number, h: number) {
  const seg = 14;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    const x = Math.cos(a) * w;
    const y = Math.sin(a) * h;
    pos.push(x, y, CAVE_BACK, x, y, frontZ(x, y) + 0.05);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function denModel() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(moundGeometry(-4.5, 1), caveCutMaterial(0x6d5a3f)));
  g.add(new THREE.Mesh(moundGeometry(1.1, 1.025), caveCutMaterial(0x6aa83f))); // mossy cap, hugging the mound

  // The cave: black tunnel walls, back wall and floor.
  const dark = new THREE.MeshBasicMaterial({ color: 0x0b0806, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(tunnelGeometry(CAVE_W + 0.04, CAVE_H + 0.04), dark));
  const back = new THREE.Mesh(new THREE.CircleGeometry(1, 16, 0, Math.PI), dark);
  back.scale.set(CAVE_W + 0.05, CAVE_H + 0.05, 1);
  back.position.z = CAVE_BACK;
  g.add(back);
  const floorLen = frontZ(0, 0) + 0.15 - CAVE_BACK;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(CAVE_W * 2, floorLen), dark);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.03, CAVE_BACK + floorLen / 2);
  g.add(floor);

  // A ring of stones framing the mouth, sitting on the mound's surface.
  const stone = lam(0x8a7f74);
  const stoneGeo = new THREE.DodecahedronGeometry(0.32, 0);
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    const x = Math.cos(a) * (CAVE_W + 0.22);
    const y = Math.sin(a) * (CAVE_H + 0.22);
    const s = new THREE.Mesh(stoneGeo, stone);
    s.position.set(x, Math.max(0.12, y), frontZ(x, Math.max(0, y)) + 0.05);
    s.rotation.set(i * 1.3, i * 0.7, i * 2.1);
    s.scale.setScalar(i === 4 ? 1.35 : 0.85 + (i % 3) * 0.15); // a keystone on top
    g.add(s);
  }

  // Honey pots either side of the mouth (snapped to the ground once placed in the world).
  const pot = lam(0xc98a3b);
  const lid = lam(0xffb627, 0x553300);
  const spots: [number, number][] = [
    [-2.0, 3.3],
    [-2.5, 2.9],
    [2.0, 3.35],
    [2.6, 2.85],
  ];
  for (const [x, z] of spots) {
    const p = new THREE.Group();
    p.name = 'pot';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 9), pot);
    body.position.y = 0.25;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 9), lid);
    top.position.y = 0.51;
    p.add(body, top);
    p.position.set(x, 0, z);
    g.add(p);
  }

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.6, 24, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffa02b,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 2.8 + 12; // starts at the top of the mound, clear of the tunnel
  g.add(beam);
  return g;
}

export interface Hive {
  x: number;
  z: number;
  honey: number;
  glade: number;
  reserved: number; // honey a bear is already walking over to collect
  flowers: number; // bloomed tiles in foraging range
  recount: number;
  obj: THREE.Group;
  label: string;
}

export interface Den {
  x: number;
  z: number;
  y: number; // ground height at the cave mouth (the tunnel floor)
  rot: number; // the mouth faces local +z turned by this
  obj: THREE.Group;
  label: string;
}

/** A point in front of (lz > 0) or inside a den, in world x/z. */
function denPoint(d: Den, lx: number, lz: number): [number, number] {
  const c = Math.cos(d.rot);
  const s = Math.sin(d.rot);
  return [wrap(d.x + lx * c + lz * s), wrap(d.z - lx * s + lz * c)];
}

interface Bear {
  den: Den;
  mesh: THREE.Mesh;
  state: 'home' | 'out' | 'back';
  hive: Hive | null;
  carry: number;
  x: number;
  z: number;
  wander: number;
  phase: number;
  inDen: boolean; // inside the tunnel (walks in and out through the mouth)
  lounging: boolean; // at home: mooching around outside rather than resting inside
  rest: number; // seconds until it switches between resting and mooching
}

interface Bee {
  ang: number;
  dist: number;
  t: number;
  speed: number;
  bob: number;
}

export class Apiary {
  group = new THREE.Group();
  dens: Den[] = [];
  hives: Hive[] = [];
  bears: Bear[] = [];
  private bees: Bee[][] = [];
  private bearGeo = bearGeometry(false);
  private bearPotGeo = bearGeometry(true);
  private bearMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private beeMesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(
    private world: World,
    private econ: Economy,
    private colliders: Colliders,
  ) {
    this.buildDen(-8, 5, 'Bear Den · home');

    this.beeMesh = new THREE.InstancedMesh(
      beeGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      MAX_BEES,
    );
    this.beeMesh.frustumCulled = false;
    this.beeMesh.count = 0;
    this.group.add(this.beeMesh);
  }

  get home() {
    return this.dens[0];
  }

  buildDen(x: number, z: number, label?: string): Den {
    const obj = denModel();
    // Dug into a hillside, the mouth faces downhill and the back is buried in the slope;
    // on flat ground it faces home.
    let rot = this.dens.length ? Math.atan2(-x, -z) : 0.5;
    let lo = Infinity;
    let hi = -Infinity;
    let loAng = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const h = this.world.heightAt(x + Math.sin(a) * 3.2, z + Math.cos(a) * 3.2);
      if (h < lo) [lo, loAng] = [h, a];
      hi = Math.max(hi, h);
    }
    if (hi - lo > 0.5) rot = loAng;
    const den: Den = {
      x,
      z,
      y: 0,
      rot,
      obj,
      label: label ?? `Bear Den · ${this.world.glades[this.gladeAt(x, z)].name}`,
    };
    // Sit the tunnel floor on the ground at the mouth; the mound's buried skirt covers any slope.
    const [mx, mz] = denPoint(den, 0, 3.2);
    den.y = this.world.heightAt(mx, mz);
    obj.position.set(x, den.y, z);
    obj.rotation.y = rot;
    // Each honey pot stands on the ground where it is.
    for (const p of obj.children) {
      if (p.name !== 'pot') continue;
      const [px, pz] = denPoint(den, p.position.x, p.position.z);
      p.position.y = this.world.heightAt(px, pz) - den.y - 0.04;
    }
    this.group.add(obj);
    this.colliders.add(x, z, 2.9);
    this.dens.push(den);
    return den;
  }

  /** The den nearest a spot, the short way round. */
  nearestDen(x: number, z: number) {
    let best = this.dens[0];
    let bd = Infinity;
    for (const d of this.dens) {
      const dist = wdist(d.x, d.z, x, z);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return { den: best, dist: bd };
  }

  denBlockedAt(x: number, z: number): string | null {
    const { den, dist } = this.nearestDen(x, z);
    return dist < DEN_SPACING ? `Too close to ${den.label.replace('Bear Den · ', 'the den at ')}` : null;
  }

  /** One hive per glade, so hives get spread across the land instead of crowding the den. */
  hiveBlockedAt(x: number, z: number): string | null {
    const g = this.gladeAt(x, z);
    if (g < 0) return null;
    const other = this.hives.find((h) => h.glade === g);
    return other ? `${this.world.glades[g].name} already has a beehive` : null;
  }

  private gladeAt(x: number, z: number) {
    const t = this.world.tileAt(x, z);
    return t < 0 ? -1 : this.world.gladeOf[t];
  }

  canBuildAt(x: number, z: number): string | null {
    for (const d of this.dens) if (wdist(d.x, d.z, x, z) < MIN_SPACING + 2) return 'Too close to a Bear Den';
    for (const h of this.hives) {
      if (wdist(h.x, h.z, x, z) < MIN_SPACING) return 'Too close to another hive';
    }
    return null;
  }

  build(x: number, z: number, honey = 0): Hive {
    const obj = hiveModel();
    obj.position.set(x, this.world.heightAt(x, z), z);
    const near = this.nearestDen(x, z).den;
    obj.rotation.y = Math.atan2(wrap(near.x - x), wrap(near.z - z));
    this.group.add(obj);
    this.colliders.add(x, z, 0.75);
    const hive: Hive = {
      x,
      z,
      honey,
      glade: this.gladeAt(x, z),
      reserved: 0,
      flowers: 0,
      recount: 0,
      obj,
      label: `Beehive · ${this.world.glades[this.gladeAt(x, z)]?.name ?? 'the wilds'}`,
    };
    this.countFlowers(hive);
    this.hives.push(hive);
    const bees: Bee[] = [];
    for (let i = 0; i < BEES_PER_HIVE; i++) {
      bees.push({
        ang: Math.random() * Math.PI * 2,
        dist: 2 + Math.random() * (HIVE.radius - 2),
        t: Math.random(),
        speed: 0.12 + Math.random() * 0.1,
        bob: Math.random() * 10,
      });
    }
    this.bees.push(bees);
    return hive;
  }

  /** The den that most needs another bear: most nearby hives per bear. */
  private neediestDen() {
    let best = this.dens[0];
    let bestScore = -1;
    for (const d of this.dens) {
      const hives = this.hives.filter((h) => this.nearestDen(h.x, h.z).den === d).length;
      const bears = this.bears.filter((b) => b.den === d).length;
      const score = hives / (bears + 1);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  /** Spawn bear meshes so there's one per bear the player owns. `homes` restores saved den assignments. */
  syncBears(homes: number[] = [], prefer?: Den) {
    while (this.bears.length < this.econ.bears) {
      const saved = homes[this.bears.length];
      const den = prefer ?? (saved !== undefined ? this.dens[saved] : undefined) ?? this.neediestDen();
      prefer = undefined;
      const mesh = new THREE.Mesh(this.bearGeo, this.bearMat);
      const [x, z] = denPoint(den, (Math.random() - 0.5) * 0.6, DEN_INSIDE); // new bears start inside
      const b: Bear = {
        den,
        mesh,
        state: 'home',
        hive: null,
        carry: 0,
        x,
        z,
        wander: Math.random() * 10,
        phase: Math.random() * 10,
        inDen: true,
        lounging: false,
        rest: 2 + Math.random() * 12,
      };
      this.group.add(mesh);
      this.bears.push(b);
    }
  }

  /** Den index of each bear, for saving. */
  bearHomes() {
    return this.bears.map((b) => this.dens.indexOf(b.den));
  }

  bearsAt(d: Den) {
    return this.bears.filter((b) => b.den === d).length;
  }

  private countFlowers(h: Hive) {
    const w = this.world;
    const r = HIVE.radius;
    const ci = Math.floor(h.x + HALF);
    const cj = Math.floor(h.z + HALF);
    let n = 0;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const t = tileIndex(i, j);
        if (!w.bloomed[t]) continue;
        const dx = i - ci;
        const dz = j - cj;
        if (dx * dx + dz * dz <= r * r) n++;
      }
    }
    h.flowers = n;
  }

  /** Honey per second the hive is making right now. */
  rateOf(h: Hive) {
    return h.flowers * this.econ.honeyPerFlower;
  }

  get totalRate() {
    let r = 0;
    for (const h of this.hives) r += this.rateOf(h);
    return r;
  }

  nearby(pos: THREE.Vector3): { kind: 'den'; den: Den } | { kind: 'hive'; hive: Hive } | null {
    for (const d of this.dens) if (wdist(d.x, d.z, pos.x, pos.z) < DEN_RANGE) return { kind: 'den', den: d };
    for (const h of this.hives) {
      if (wdist(h.x, h.z, pos.x, pos.z) < HIVE_RANGE) return { kind: 'hive', hive: h };
    }
    return null;
  }

  private pickHive(den: Den): Hive | null {
    const carry = this.econ.bearCarry;
    let best: Hive | null = null;
    let bestScore = 0;
    for (const h of this.hives) {
      const avail = h.honey - h.reserved;
      // Worth the walk once there's a decent potful, or the hive is about to overflow.
      if (avail < Math.min(carry * 0.6, this.econ.hiveCap * 0.5)) continue;
      const d = wdist(den.x, den.z, h.x, h.z);
      const score = Math.min(avail, carry) / (20 + d);
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return best;
  }

  update(dt: number, time: number, playerPos: THREE.Vector3, onDeliver: (honey: number) => void) {
    const cap = this.econ.hiveCap;
    const perFlower = this.econ.honeyPerFlower;
    for (const h of this.hives) {
      h.recount -= dt;
      if (h.recount <= 0) {
        h.recount = 2.5 + Math.random();
        this.countFlowers(h);
      }
      h.honey = Math.min(cap, h.honey + h.flowers * perFlower * dt);
      const drip = h.obj.getObjectByName('drip')!;
      const f = h.honey / cap;
      drip.scale.setScalar(0.3 + f * 1.1);
      drip.position.y = 0.55 - f * 0.12;
    }

    const speed = this.econ.bearSpeed;
    const carry = this.econ.bearCarry;
    for (const b of this.bears) {
      const den = b.den;
      // Where the bear wants to end up, and whether that's inside the den.
      let tx = b.x;
      let tz = b.z;
      let wantInside = false;
      if (b.state === 'home') {
        const h = this.pickHive(den);
        if (h) {
          b.hive = h;
          const take = Math.min(carry, h.honey - h.reserved);
          h.reserved += take;
          b.carry = take; // what we've promised to collect
          b.state = 'out';
        } else {
          // Idle: rest in the cave for a while, then come out and mooch about the entrance.
          b.rest -= dt;
          if (b.rest <= 0) {
            b.lounging = !b.lounging;
            b.rest = b.lounging ? 6 + Math.random() * 10 : 12 + Math.random() * 20;
          }
          if (b.lounging) {
            b.wander += dt * 0.3;
            [tx, tz] = denPoint(den, Math.cos(b.wander + b.phase) * 3, 6 + Math.sin(b.wander * 1.3 + b.phase) * 1.5);
          } else {
            [tx, tz] = denPoint(den, Math.sin(b.phase) * 0.3, DEN_INSIDE);
            wantInside = true;
          }
        }
      }
      if (b.state === 'out' && b.hive) {
        tx = b.hive.x;
        tz = b.hive.z;
        if (!b.inDen && wdist(b.x, b.z, tx, tz) < 1.4) {
          const h = b.hive;
          h.reserved = Math.max(0, h.reserved - b.carry);
          b.carry = Math.min(carry, h.honey);
          h.honey -= b.carry;
          b.state = 'back';
          b.mesh.geometry = this.bearPotGeo;
        }
      }
      const [mx, mz] = denPoint(den, 0, DEN_MOUTH);
      if (b.state === 'back') {
        // Drop the honey at the cave mouth, then head inside.
        [tx, tz] = [mx, mz];
        if (wdist(b.x, b.z, mx, mz) < 1.2) {
          if (b.carry > 0) onDeliver(b.carry);
          b.carry = 0;
          b.hive = null;
          b.state = 'home';
          b.lounging = false;
          b.rest = 12 + Math.random() * 20;
          b.mesh.geometry = this.bearGeo;
        }
      }
      // In and out of the den only through the mouth.
      if (b.inDen !== wantInside) {
        const atMouth = wdist(b.x, b.z, mx, mz) < 0.5;
        if (atMouth) b.inDen = wantInside;
        else [tx, tz] = [mx, mz];
      }
      if (!b.inDen) [tx, tz] = this.aroundDens(b.x, b.z, tx, tz);
      const dx = wrap(tx - b.x); // the short way round
      const dz = wrap(tz - b.z);
      const d = Math.hypot(dx, dz);
      const moving = d > 0.3;
      const sp = b.state === 'home' ? 1.2 : speed;
      if (moving) {
        const step = Math.min(d, sp * dt);
        b.x += (dx / d) * step;
        b.z += (dz / d) * step;
        b.mesh.rotation.y = Math.atan2(dx, dz);
        b.phase += dt * sp * 2.2;
        b.x = wrap(b.x);
        b.z = wrap(b.z);
      }
      const waddle = moving ? Math.sin(b.phase) : 0;
      // Inside the tunnel the floor is flat; out of sight once it's deep in the cave.
      const ground = b.inDen ? den.y : this.world.heightAt(b.x, b.z);
      b.mesh.position.set(b.x, ground + Math.abs(waddle) * 0.12, b.z);
      b.mesh.rotation.z = waddle * 0.12;
      const resting = b.inDen && !moving;
      b.mesh.visible = !resting && wdist(playerPos.x, playerPos.z, b.x, b.z) < 260;
    }

    this.updateBees(dt, time, playerPos);
  }

  /** If a den mound is in the way of a straight walk, steer around its side instead. */
  private aroundDens(x: number, z: number, tx: number, tz: number): [number, number] {
    const ttx = wrap(tx - x);
    const ttz = wrap(tz - z);
    const len2 = ttx * ttx + ttz * ttz;
    if (len2 < 1e-6) return [tx, tz];
    for (const d of this.dens) {
      const cx = wrap(d.x - x); // den centre relative to the bear
      const cz = wrap(d.z - z);
      if (cx * cx + cz * cz > (Math.sqrt(len2) + DEN_AVOID) ** 2) continue; // too far to matter
      if (cx * cx + cz * cz < DEN_AVOID * DEN_AVOID) {
        // Up against the mound (e.g. just out of the mouth). Heading for this den's mouth is fine;
        // otherwise step straight out from the mound first, then go round.
        const [mx, mz] = denPoint(d, 0, DEN_MOUTH);
        if (wdist(tx, tz, mx, mz) < 1) return [tx, tz];
        const dist = Math.hypot(cx, cz) || 1e-3;
        return [wrap(x + cx - (cx / dist) * (DEN_AVOID + 0.8)), wrap(z + cz - (cz / dist) * (DEN_AVOID + 0.8))];
      }
      const s = Math.min(1, Math.max(0, (cx * ttx + cz * ttz) / len2));
      const px = s * ttx - cx;
      const pz = s * ttz - cz;
      if (px * px + pz * pz >= DEN_AVOID * DEN_AVOID) continue; // the path misses this den
      // Walk round the mound the shorter way: aim a little further round the circle each step.
      const aBear = Math.atan2(-cx, -cz);
      const aGoal = Math.atan2(ttx - cx, ttz - cz);
      let diff = aGoal - aBear;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const a = aBear + Math.sign(diff || 1) * 0.6;
      const r = DEN_AVOID + 0.6;
      return [wrap(x + cx + Math.sin(a) * r), wrap(z + cz + Math.cos(a) * r)];
    }
    return [tx, tz];
  }

  private updateBees(dt: number, time: number, playerPos: THREE.Vector3) {
    let n = 0;
    for (let k = 0; k < this.hives.length; k++) {
      const h = this.hives[k];
      const near = wdist(playerPos.x, playerPos.z, h.x, h.z) < BEE_DRAW_DIST;
      // With nothing in bloom the bees just buzz around the hive.
      const reach = Math.min(1, h.flowers / 300);
      for (const bee of this.bees[k]) {
        bee.t += dt * bee.speed * (12 / (4 + bee.dist * reach));
        if (bee.t >= 1) {
          bee.t -= 1;
          bee.ang = Math.random() * Math.PI * 2;
          bee.dist = 2 + Math.random() * (HIVE.radius - 2);
        }
        if (!near || n >= MAX_BEES) continue;
        // out and back: a triangle wave along a slightly curved path
        const s = bee.t < 0.5 ? bee.t * 2 : 2 - bee.t * 2;
        const r = 1 + s * bee.dist * reach;
        const a = bee.ang + Math.sin(s * Math.PI) * 0.35 * (bee.t < 0.5 ? 1 : -1);
        const x = h.x + Math.cos(a) * r;
        const z = h.z + Math.sin(a) * r;
        const y = this.world.heightAt(x, z) + 0.9 + Math.sin(time * 6 + bee.bob) * 0.15 + s * 0.4;
        const heading = a + (bee.t < 0.5 ? 0 : Math.PI);
        this.e.set(0, Math.PI / 2 - heading, Math.sin(time * 40 + bee.bob) * 0.15);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(x, y, z), this.q, this.one);
        this.beeMesh.setMatrixAt(n++, this.m4);
      }
    }
    this.beeMesh.count = n;
    this.beeMesh.instanceMatrix.needsUpdate = true;
  }
}
