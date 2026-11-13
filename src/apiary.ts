import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Colliders } from './colliders';
import { Economy, HIVE } from './economy';
import { HALF, SIZE, World } from './world';

// The production branch: beehives make honey from the blooms around them, and
// bears lumber between the hives and the Bear Den carrying it home. Honey is the
// currency for fairy rings.

const DEN_RANGE = 4.5;
const HIVE_RANGE = 3;
const MIN_SPACING = 8;
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

function denModel() {
  const g = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x6d5a3f));
  mound.scale.set(1.3, 0.85, 1);
  g.add(mound);
  const moss = new THREE.Mesh(new THREE.SphereGeometry(2.25, 14, 5, 0, Math.PI * 2, 0, Math.PI / 4), lam(0x6aa83f));
  moss.scale.set(1.3, 0.85, 1);
  moss.position.y = 0.55;
  g.add(moss);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.85, 14, 0, Math.PI), lam(0x1e140c));
  mouth.position.set(0, 0.02, 2.05);
  mouth.rotation.x = -0.25;
  g.add(mouth);
  // honey pots out front
  const pot = lam(0xc98a3b);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 9), pot);
    p.position.set(-1.6 + i * 1.05 + (i > 1 ? 0.4 : 0), 0.25, 2.3 + (i % 2) * 0.35);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 9), lam(0xffb627, 0x553300));
    top.position.copy(p.position).setY(0.51);
    g.add(p, top);
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
  beam.position.y = 12;
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

interface Bear {
  mesh: THREE.Mesh;
  state: 'home' | 'out' | 'back';
  hive: Hive | null;
  carry: number;
  x: number;
  z: number;
  wander: number;
  phase: number;
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
  den = new THREE.Vector3();
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
    const dx = -8;
    const dz = 5;
    this.den.set(dx, world.heightAt(dx, dz), dz);
    const den = denModel();
    den.position.copy(this.den);
    den.rotation.y = 0.5;
    this.group.add(den);
    colliders.add(dx, dz, 2.2);

    this.beeMesh = new THREE.InstancedMesh(
      beeGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      MAX_BEES,
    );
    this.beeMesh.frustumCulled = false;
    this.beeMesh.count = 0;
    this.group.add(this.beeMesh);
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
    if (Math.hypot(x - this.den.x, z - this.den.z) < MIN_SPACING + 2) return 'Too close to the Bear Den';
    for (const h of this.hives) {
      if (Math.hypot(x - h.x, z - h.z) < MIN_SPACING) return 'Too close to another hive';
    }
    return null;
  }

  build(x: number, z: number, honey = 0): Hive {
    const obj = hiveModel();
    obj.position.set(x, this.world.heightAt(x, z), z);
    obj.rotation.y = Math.atan2(this.den.x - x, this.den.z - z);
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

  /** Spawn bear meshes so there's one per bear the player owns. */
  syncBears() {
    while (this.bears.length < this.econ.bears) {
      const mesh = new THREE.Mesh(this.bearGeo, this.bearMat);
      const a = Math.random() * Math.PI * 2;
      const b: Bear = {
        mesh,
        state: 'home',
        hive: null,
        carry: 0,
        x: this.den.x + Math.cos(a) * 3,
        z: this.den.z + Math.sin(a) * 3 + 2,
        wander: Math.random() * 10,
        phase: Math.random() * 10,
      };
      this.group.add(mesh);
      this.bears.push(b);
    }
  }

  private countFlowers(h: Hive) {
    const w = this.world;
    const r = HIVE.radius;
    const ci = Math.floor(h.x + HALF);
    const cj = Math.floor(h.z + HALF);
    let n = 0;
    for (let j = Math.max(0, cj - r); j <= Math.min(SIZE - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(SIZE - 1, ci + r); i++) {
        const t = j * SIZE + i;
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

  nearby(pos: THREE.Vector3): { kind: 'den' } | { kind: 'hive'; hive: Hive } | null {
    if (Math.hypot(pos.x - this.den.x, pos.z - this.den.z) < DEN_RANGE) return { kind: 'den' };
    for (const h of this.hives) {
      if (Math.hypot(pos.x - h.x, pos.z - h.z) < HIVE_RANGE) return { kind: 'hive', hive: h };
    }
    return null;
  }

  private pickHive(): Hive | null {
    const carry = this.econ.bearCarry;
    let best: Hive | null = null;
    let bestScore = 0;
    for (const h of this.hives) {
      const avail = h.honey - h.reserved;
      // Worth the walk once there's a decent potful, or the hive is about to overflow.
      if (avail < Math.min(carry * 0.6, this.econ.hiveCap * 0.5)) continue;
      const d = Math.hypot(h.x - this.den.x, h.z - this.den.z);
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
      let tx = b.x;
      let tz = b.z;
      let moving = false;
      if (b.state === 'home') {
        const h = this.pickHive();
        if (h) {
          b.hive = h;
          const take = Math.min(carry, h.honey - h.reserved);
          h.reserved += take;
          b.carry = take; // what we've promised to collect
          b.state = 'out';
        } else {
          // mooch around in front of the den
          b.wander += dt * 0.3;
          tx = this.den.x + Math.cos(b.wander + b.phase) * 3.5;
          tz = this.den.z + 3.5 + Math.sin(b.wander * 1.3 + b.phase) * 1.5;
          moving = Math.hypot(tx - b.x, tz - b.z) > 0.3;
        }
      }
      if (b.state === 'out' && b.hive) {
        tx = b.hive.x;
        tz = b.hive.z;
        moving = true;
        if (Math.hypot(tx - b.x, tz - b.z) < 1.4) {
          const h = b.hive;
          h.reserved = Math.max(0, h.reserved - b.carry);
          b.carry = Math.min(carry, h.honey);
          h.honey -= b.carry;
          b.state = 'back';
          b.mesh.geometry = this.bearPotGeo;
        }
      }
      if (b.state === 'back') {
        tx = this.den.x;
        tz = this.den.z + 2.6;
        moving = true;
        if (Math.hypot(tx - b.x, tz - b.z) < 1.2) {
          if (b.carry > 0) onDeliver(b.carry);
          b.carry = 0;
          b.hive = null;
          b.state = 'home';
          b.mesh.geometry = this.bearGeo;
        }
      }
      const dx = tx - b.x;
      const dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      const sp = b.state === 'home' ? 1.2 : speed;
      if (moving && d > 0.01) {
        const step = Math.min(d, sp * dt);
        b.x += (dx / d) * step;
        b.z += (dz / d) * step;
        b.mesh.rotation.y = Math.atan2(dx, dz);
        b.phase += dt * sp * 2.2;
      }
      const waddle = moving ? Math.sin(b.phase) : 0;
      b.mesh.position.set(b.x, this.world.heightAt(b.x, b.z) + Math.abs(waddle) * 0.12, b.z);
      b.mesh.rotation.z = waddle * 0.12;
      b.mesh.visible = Math.hypot(b.x - playerPos.x, b.z - playerPos.z) < 260;
    }

    this.updateBees(dt, time, playerPos);
  }

  private updateBees(dt: number, time: number, playerPos: THREE.Vector3) {
    let n = 0;
    for (let k = 0; k < this.hives.length; k++) {
      const h = this.hives[k];
      const near = Math.hypot(h.x - playerPos.x, h.z - playerPos.z) < BEE_DRAW_DIST;
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
