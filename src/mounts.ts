import * as THREE from 'three';
import type { MountId } from './economy';
import { bake, joint, lam, leafGeo, limb, mesh } from './rig';

// The mounts: jointed models with procedural gaits. Both face +z. The rider is parented to
// `back`, so she rocks and bobs with the animal's stride.

export interface MountModel {
  root: THREE.Group;
  /** Where the rider sits (top of the shell / the saddle); she faces +z here too. */
  back: THREE.Group;
  animate(speed: number, dt: number, time: number): void;
}

const basic = (color: number) => new THREE.MeshBasicMaterial({ color });
const DS = THREE.DoubleSide;
const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = THREE.MathUtils.lerp;

/** An ellipsoid. */
function ell(rx: number, ry: number, rz: number, mat: THREE.Material, parent: THREE.Object3D, segs = 12) {
  const m = mesh(new THREE.SphereGeometry(1, segs, Math.max(6, Math.round(segs * 0.7))), mat, parent);
  m.scale.set(rx, ry, rz);
  return m;
}

/** A small five-petal flower facing +z, for dressing moss and brambles. */
function flower(parent: THREE.Object3D, petal: THREE.Material, heart: THREE.Material, size = 1) {
  const g = new THREE.Group();
  parent.add(g);
  for (let i = 0; i < 5; i++) {
    const p = mesh(leafGeo(0.035 * size, 0.045 * size, 0.2), petal, g);
    p.rotation.set(0.3, 0, (i / 5) * Math.PI * 2, 'ZXY');
  }
  mesh(new THREE.SphereGeometry(0.013 * size, 6, 4), heart, g).position.z = 0.008 * size;
  return g;
}

/** Eyelid-style blinking: every few seconds, squash the eyes shut for a moment. */
function blinker() {
  let t = 1 + Math.random() * 3;
  return (dt: number) => {
    t -= dt;
    let open = 1;
    if (t < 0.14) open = Math.abs(t - 0.07) / 0.07;
    if (t < 0) t = 2.5 + Math.random() * 4;
    return Math.max(0.08, open);
  };
}

// ---------------------------------------------------------------------------------------
// Mossback Tortoise: a broad domed shell of plates, overgrown with moss, grass, flowers,
// mushrooms and a sapling, with a leaf mat on top for the nymph to kneel on.

function tortoise(): MountModel {
  const C = {
    shell: lam(0x3d3b22),
    plate: lam(0x6a6638),
    plate2: lam(0x5d5a31),
    rim: lam(0x4f4c2a),
    belly: lam(0xcdbb7c),
    skin: lam(0x86955a, 0x0a0c04),
    skinDark: lam(0x5f6c3c),
    beak: lam(0x403c26),
    claw: lam(0xe0d6b2),
    moss: lam(0x6fae4c, 0x0a1406),
    mossDark: lam(0x4f8a3a, 0x061006),
    grass: lam(0x9ad15e, 0x0c1606, DS),
    leaf: lam(0x74bf55, 0x0c1c06, DS),
    leafDark: lam(0x3f8a42, 0x061406, DS),
    bark: lam(0x6b4a2b),
    capRed: lam(0xd8744a, 0x200a04),
    capDot: lam(0xfff4dc),
    stem: lam(0xf0e6cc),
    pink: lam(0xff9ec4, 0x3a1424, DS),
    white: lam(0xfff8ee, 0x222222, DS),
    lilac: lam(0xc3b5ff, 0x1a1430, DS),
    yellow: lam(0xfff27a, 0x333010),
    eye: basic(0x161a12),
    shine: basic(0xffffff),
  };

  const root = new THREE.Group();
  const body = joint(root, 0, 0, 0); // bobs and sways with the gait

  // Shell: an ellipsoid dome; plates are hexagonal slabs set on its surface, and the dark
  // dome showing between them reads as the grooves.
  const RX = 1.0;
  const RY = 0.74;
  const RZ = 1.25;
  const CY = 0.55;
  const dome = ell(RX, RY, RZ, C.shell, body, 24);
  (dome.geometry as THREE.SphereGeometry).dispose();
  dome.geometry = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.position.y = CY;
  /** Point and outward normal on the dome, by angle from the top (p) and around (a, 0 = front). */
  const surf = (p: number, a: number) => {
    const pos = new THREE.Vector3(
      Math.sin(p) * Math.sin(a) * RX,
      Math.cos(p) * RY + CY,
      Math.sin(p) * Math.cos(a) * RZ,
    );
    const n = new THREE.Vector3(pos.x / (RX * RX), (pos.y - CY) / (RY * RY), pos.z / (RZ * RZ)).normalize();
    return { pos, n };
  };
  const onShell = (o: THREE.Object3D, p: number, a: number, lift = 0) => {
    const { pos, n } = surf(p, a);
    o.position.copy(pos).addScaledVector(n, lift);
    o.quaternion.setFromUnitVectors(UP, n);
    body.add(o);
    return o;
  };
  const plate = (p: number, a: number, size: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.94, size * 1.08, 0.06, 6), mat);
    onShell(m, p, a, -0.012);
    m.rotateY(a);
  };
  plate(0, 0, 0.3, C.plate);
  for (let i = 0; i < 6; i++) plate(0.64, ((i + 0.5) / 6) * Math.PI * 2, 0.29, i % 2 ? C.plate : C.plate2);
  for (let i = 0; i < 10; i++) plate(1.1, (i / 10) * Math.PI * 2, 0.26, i % 2 ? C.plate2 : C.plate);
  for (let i = 0; i < 18; i++) plate(1.44, ((i + 0.5) / 18) * Math.PI * 2, 0.17, C.plate2);
  // Scalloped rim and the pale belly plate.
  const rim = mesh(new THREE.CylinderGeometry(RX * 1.04, RX * 0.98, 0.13, 18), C.rim, body);
  rim.scale.z = RZ / RX;
  rim.position.y = CY;
  const plastron = mesh(new THREE.SphereGeometry(1, 18, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), C.belly, body);
  plastron.scale.set(RX * 0.94, 0.16, RZ * 0.94);
  plastron.position.y = CY - 0.04;

  // Moss cushions with grass and flowers, kept off the top where she kneels.
  const mossSpots = [
    [0.95, 0.5],
    [1.05, 1.4],
    [0.85, 2.3],
    [1.15, 2.9],
    [0.95, 3.7],
    [1.1, 4.5],
    [0.9, 5.3],
    [1.25, 6.0],
    [0.75, 1.0],
    [0.8, 4.0],
  ];
  const flowerMats = [C.pink, C.white, C.lilac, C.white];
  mossSpots.forEach(([p, a], i) => {
    for (let k = 0; k < 4; k++) {
      const dp = (k - 1.5) * 0.09;
      const da = ((k * 37) % 5) * 0.06 - 0.12;
      const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13 + (k % 2) * 0.05, 1), k % 3 ? C.moss : C.mossDark);
      onShell(lump, p + dp, a + da, -0.03);
      lump.scale.set(1.25, 0.32, 1.05);
    }
    // grass tuft
    const tuft = onShell(new THREE.Group(), p - 0.05, a + 0.1, 0.03);
    for (let k = 0; k < 5; k++) {
      const blade = mesh(leafGeo(0.03, 0.16 + (k % 3) * 0.04, 0.1), C.grass, tuft);
      blade.rotation.set((k - 2) * 0.22, k * 1.3, (k - 2) * 0.15);
    }
    if (i % 2 === 0) {
      const f = onShell(new THREE.Group(), p + 0.08, a - 0.12, 0.08);
      const stem = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), C.mossDark, f);
      stem.position.y = -0.04;
      const bloom = flower(f, flowerMats[(i / 2) % 4], C.yellow, 1.2);
      bloom.rotation.x = -Math.PI / 2 + 0.3;
    }
  });
  // A cluster of mushrooms on one flank.
  for (const [k, [dp, da, s]] of [
    [0, 0, 1],
    [0.08, 0.1, 0.7],
    [-0.04, 0.14, 0.55],
  ].entries()) {
    const m = onShell(new THREE.Group(), 1.2 + dp, 2.05 + da, 0);
    const st = mesh(new THREE.CylinderGeometry(0.025 * s, 0.032 * s, 0.12 * s, 6), C.stem, m);
    st.position.y = 0.06 * s;
    const cap = mesh(new THREE.SphereGeometry(0.07 * s, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.capRed, m);
    cap.position.y = 0.11 * s;
    cap.scale.y = 0.75;
    if (k === 0)
      for (let d = 0; d < 3; d++) {
        const dot = mesh(new THREE.SphereGeometry(0.012, 5, 3), C.capDot, m);
        dot.position.set(Math.cos(d * 2.1) * 0.04, 0.155, Math.sin(d * 2.1) * 0.04);
      }
  }
  // A young sapling growing out of the back of the shell.
  {
    const t = onShell(new THREE.Group(), 0.72, Math.PI + 0.35, 0);
    const trunk = mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.42, 5), C.bark, t);
    trunk.position.y = 0.2;
    trunk.rotation.z = 0.08;
    const twig = mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.16, 4), C.bark, t);
    twig.position.set(0.05, 0.3, 0);
    twig.rotation.z = -0.8;
    for (const [x, y, z, s] of [
      [0.0, 0.44, 0, 1],
      [0.11, 0.37, 0.02, 0.8],
      [-0.06, 0.36, -0.03, 0.75],
    ]) {
      for (let k = 0; k < 4; k++) {
        const l = mesh(leafGeo(0.07 * s, 0.13 * s), k % 2 ? C.leaf : C.leafDark, t);
        l.position.set(x, y, z);
        l.rotation.set(0.9, (k / 4) * Math.PI * 2, 0, 'YXZ');
      }
    }
  }
  // The leaf mat she kneels on.
  const back = joint(body, 0, CY + RY + 0.035, -0.02);
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    g.rotation.y = (i / 9) * Math.PI * 2;
    back.add(g);
    const l = mesh(leafGeo(0.17, 0.36, 0.15), i % 2 ? C.leaf : C.leafDark, g);
    l.rotation.x = Math.PI / 2 + 0.2;
    l.position.y = -0.02;
  }

  // Head on a wrinkly neck.
  const neck = joint(body, 0, 0.56, RZ * 0.9);
  const nk = mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.55, 10), C.skin, neck);
  nk.rotation.x = Math.PI / 2 - 0.55;
  nk.position.set(0, 0.1, 0.16);
  for (let k = 0; k < 3; k++) {
    const fold = mesh(new THREE.TorusGeometry(0.165 - k * 0.012, 0.011, 4, 14), C.skinDark, neck);
    fold.position.set(0, 0.02 + k * 0.075, 0.04 + k * 0.12);
    fold.rotation.x = -0.55;
  }
  const head = joint(neck, 0, 0.26, 0.42);
  head.scale.setScalar(1.3);
  const skull = ell(0.2, 0.17, 0.26, C.skin, head, 14);
  skull.position.set(0, 0.03, 0.06);
  for (let k = 0; k < 5; k++) {
    const sc = ell(0.06, 0.02, 0.06, C.skinDark, head, 6);
    sc.position.set((k - 2) * 0.06, 0.18 - Math.abs(k - 2) * 0.025, 0.02 + (k % 2) * 0.06);
  }
  const beak = ell(0.13, 0.08, 0.12, C.beak, head, 10);
  beak.position.set(0, -0.02, 0.27);
  const jaw = ell(0.11, 0.045, 0.1, C.beak, head, 8);
  jaw.position.set(0, -0.09, 0.24);
  for (const s of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.012, 5, 4), C.eye, head).position.set(s * 0.035, 0.03, 0.385);
  }
  const eyes = joint(head, 0, 0.08, 0.16);
  for (const s of [-1, 1]) {
    const e = ell(0.045, 0.05, 0.035, C.eye, eyes, 10);
    e.position.set(s * 0.15, 0, 0);
    mesh(new THREE.SphereGeometry(0.012, 5, 4), C.shine, eyes).position.set(s * 0.15 + 0.01, 0.018, 0.03);
    // heavy, sleepy brow
    const brow = ell(0.065, 0.03, 0.05, C.skin, head, 8);
    brow.position.set(s * 0.145, 0.135, 0.17);
    brow.rotation.z = -s * 0.3; // outer ends droop: sleepy, not cross
  }
  // a little sprout on its head
  for (const s of [-1, 1]) {
    const l = mesh(leafGeo(0.045, 0.09), C.leaf, head);
    l.position.set(0, 0.19, 0.0);
    l.rotation.set(0, Math.PI / 2, s * 0.6);
  }

  // Stumpy legs with claws.
  const legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[] = [];
  for (const [x, z] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const hip = joint(body, x * 0.7, 0.5, z * 0.72);
    hip.rotation.z = x * 0.35;
    mesh(limb(0.17, 0.15, 0.22), C.skin, hip);
    for (let k = 0; k < 3; k++) {
      const sc = ell(0.05, 0.03, 0.05, C.skinDark, hip, 6);
      const a = k * 2.1;
      sc.position.set(Math.sin(a) * 0.15, -0.08 - k * 0.04, Math.cos(a) * 0.15);
    }
    const knee = joint(hip, 0, -0.22, 0);
    knee.rotation.z = -x * 0.35; // feet flat on the ground
    mesh(limb(0.155, 0.17, 0.2), C.skin, knee);
    const foot = ell(0.19, 0.08, 0.22, C.skin, knee, 10);
    foot.position.set(0, -0.25, 0.04);
    for (let k = 0; k < 3; k++) {
      const c = mesh(new THREE.ConeGeometry(0.03, 0.08, 5), C.claw, knee);
      c.position.set((k - 1) * 0.08, -0.27, 0.24);
      c.rotation.x = Math.PI / 2 + 0.3;
    }
    legs.push({ hip, knee, front: z > 0, side: x });
  }
  const tail = mesh(new THREE.ConeGeometry(0.075, 0.28, 7), C.skin, body);
  tail.position.set(0, 0.45, -RZ * 0.98);
  tail.rotation.x = -Math.PI / 2 - 0.35;

  bake(root);

  // --- gait: a slow diagonal walk with a side-to-side roll ---
  let phase = 0;
  const blink = blinker();
  return {
    root,
    back,
    animate(speed, dt, time) {
      const move = clamp01(speed / 1.5);
      phase += (speed / 1.3) * Math.PI * 2 * dt;
      for (const L of legs) {
        const diag = L.front === L.side > 0 ? 0 : Math.PI;
        const ph = phase + diag;
        const lift = Math.max(0, -Math.cos(ph)) * move;
        L.hip.rotation.x = Math.sin(ph) * 0.42 * move;
        L.hip.rotation.z = L.side * (0.35 + lift * 0.35);
        L.knee.rotation.z = -L.side * (0.35 + lift * 0.2);
        L.knee.rotation.x = -lift * 0.3;
      }
      body.position.y = Math.abs(Math.sin(phase)) * 0.035 * move;
      body.rotation.z = Math.sin(phase) * 0.04 * move;
      body.rotation.x = Math.sin(phase * 2) * 0.012 * move;
      // The head pushes forward with each step; at rest it slowly looks about.
      const idle = 1 - move;
      neck.position.z = RZ * 0.9 + Math.sin(phase * 2) * 0.03 * move;
      head.rotation.y = Math.sin(time * 0.27) * 0.45 * idle + Math.sin(phase) * 0.06 * move;
      head.rotation.x = Math.sin(time * 0.5) * 0.08 * idle + Math.sin(phase * 2) * 0.04 * move;
      eyes.scale.y = blink(dt);
      // a slow breath
      body.scale.setScalar(1 + Math.sin(time * 1.1) * 0.006 * idle);
    },
  };
}

// ---------------------------------------------------------------------------------------
// Bramble Stag: a lean deer with a leafy ruff, antlers wound with bramble (leaves,
// blossoms and berries), and a moss saddle-blanket.

function stag(): MountModel {
  const C = {
    coat: lam(0x93603a, 0x0c0604),
    coatDS: lam(0x93603a, 0x0c0604, DS),
    coatDark: lam(0x6a4228),
    pale: lam(0xf0e2c8, 0x101010),
    paleDS: lam(0xf0d8c8, 0x101010, DS),
    muzzle: lam(0x4a3022),
    hoof: lam(0x2a1d16),
    antler: lam(0x7d5c3c),
    tip: lam(0xe3d4b4),
    leaf: lam(0x74bf55, 0x0c1c06, DS),
    leafDark: lam(0x3f8a42, 0x061406, DS),
    berry: lam(0x3a1f4a, 0x0c0410),
    blossom: lam(0xfde6ee, 0x222020, DS),
    heart: lam(0xfff27a, 0x333010),
    blanket: lam(0x4f8f45, 0x081206, DS),
    blanketEdge: lam(0x3a6e34, 0x061006, DS),
    moss: lam(0x6fae4c, 0x0a1406),
    strap: lam(0x6b4a2b),
    eye: basic(0x140e0a),
    shine: basic(0xffffff),
  };

  const root = new THREE.Group();
  const torso = joint(root, 0, 1.36, 0);

  // Body: chest, barrel and haunch, narrower than it is deep, with a pale belly and rump.
  const chest = ell(0.25, 0.34, 0.4, C.coat, torso, 14);
  chest.position.set(0, -0.02, 0.48);
  const barrel = ell(0.23, 0.3, 0.55, C.coat, torso, 14);
  barrel.position.set(0, 0.02, 0);
  const haunch = ell(0.25, 0.33, 0.36, C.coat, torso, 14);
  haunch.position.set(0, 0.05, -0.5);
  const belly = ell(0.18, 0.2, 0.48, C.pale, torso, 12);
  belly.position.set(0, -0.13, 0.05);
  const rump = ell(0.17, 0.21, 0.1, C.pale, torso, 10);
  rump.position.set(0, 0.07, -0.8);
  const spine = ell(0.07, 0.04, 0.7, C.coatDark, torso, 8);
  spine.position.set(0, 0.32, -0.12);
  // a few pale dapples on the haunches
  for (const s of [-1, 1])
    for (let k = 0; k < 5; k++) {
      const d = ell(0.035, 0.035, 0.012, C.pale, torso, 6);
      const z = -0.25 - (k % 3) * 0.15;
      const y = 0.15 - Math.floor(k / 3) * 0.12 + (k % 2) * 0.04;
      d.position.set(s * 0.245, y, z);
      d.rotation.y = (s * Math.PI) / 2;
    }

  // Moss saddle-blanket draped over the back, a girth strap, and a leaf fringe.
  const blanket = mesh(new THREE.CylinderGeometry(1, 1, 0.5, 18, 1, true, Math.PI - 1.15, 2.3), C.blanket, torso);
  blanket.rotation.x = Math.PI / 2;
  blanket.scale.set(0.245, 1, 0.315);
  blanket.position.set(0, 0.025, 0.02);
  const seat = ell(0.15, 0.05, 0.2, C.moss, torso, 10);
  seat.position.set(0, 0.33, 0.02);
  const girth = mesh(new THREE.TorusGeometry(1, 0.1, 5, 24), C.strap, torso);
  girth.scale.set(0.24, 0.31, 0.25);
  girth.position.set(0, 0.02, 0.2);
  for (const s of [-1, 1])
    for (let k = 0; k < 6; k++) {
      const z = -0.22 + k * 0.09;
      const l = mesh(leafGeo(0.07, 0.13, 0.3), k % 2 ? C.blanketEdge : C.leafDark, torso);
      l.position.set(s * 0.215, -0.13, z);
      l.rotation.set(Math.PI, 0, -s * 0.35);
      l.rotateY((-s * Math.PI) / 2);
    }
  const back = joint(torso, 0, 0.35, 0.02);

  // Neck with a leafy ruff down the front and a short mane along the top.
  const neck = joint(torso, 0, 0.16, 0.7);
  const NECK_REST = 0.55;
  neck.rotation.x = NECK_REST;
  const nk = mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.74, 10), C.coat, neck);
  nk.position.y = 0.3;
  ell(0.16, 0.16, 0.18, C.coat, neck).position.y = 0.0;
  const throat = ell(0.08, 0.16, 0.06, C.pale, neck, 8);
  throat.position.set(0, 0.48, 0.08);
  for (let k = 0; k < 12; k++) {
    const a = ((k % 4) - 1.5) * 0.45;
    const y = 0.1 + Math.floor(k / 4) * 0.13;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * 0.14, y, Math.cos(a) * 0.13);
    g.rotation.y = a;
    neck.add(g);
    const l = mesh(leafGeo(0.09, 0.19, 0.3), k % 3 ? C.leafDark : C.leaf, g);
    l.rotation.x = Math.PI - 0.25;
  }
  for (let k = 0; k < 6; k++) {
    const l = mesh(leafGeo(0.06, 0.12, 0.3), C.leafDark, neck);
    l.position.set(0, 0.12 + k * 0.1, -0.11 + k * 0.006);
    l.rotation.set(-2.4, 0, 0);
  }

  // Head.
  const head = joint(neck, 0, 0.7, 0);
  const HEAD_REST = -NECK_REST + 0.3;
  head.rotation.x = HEAD_REST;
  ell(0.12, 0.125, 0.15, C.coat, head, 14).position.set(0, 0.03, 0);
  ell(0.075, 0.08, 0.17, C.coat, head, 12).position.set(0, -0.025, 0.17);
  ell(0.062, 0.058, 0.06, C.muzzle, head, 10).position.set(0, -0.035, 0.32);
  const nose = ell(0.032, 0.022, 0.015, C.eye, head, 8);
  nose.position.set(0, -0.02, 0.375);
  ell(0.055, 0.035, 0.1, C.pale, head, 8).position.set(0, -0.095, 0.18);
  // pale eye rings and a brow line
  const eyes = joint(head, 0, 0.055, 0.075);
  for (const s of [-1, 1]) {
    const ring = ell(0.04, 0.04, 0.02, C.pale, head, 8);
    ring.position.set(s * 0.1, 0.055, 0.075);
    ring.rotation.y = s * 1.15;
    const e = ell(0.026, 0.03, 0.02, C.eye, eyes, 8);
    e.position.set(s * 0.108, 0, 0.004);
    e.rotation.y = s * 1.15;
    mesh(new THREE.SphereGeometry(0.008, 5, 4), C.shine, eyes).position.set(s * 0.122, 0.012, 0.02);
  }
  // ears
  const ears: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const ear = joint(head, s * 0.09, 0.12, -0.05);
    ear.rotation.set(-0.2, 0, -s * 1.05);
    const outer = mesh(leafGeo(0.1, 0.2, 0.45), C.coatDS, ear);
    outer.rotation.y = s * 0.3;
    const inner = mesh(leafGeo(0.06, 0.14, 0.4), C.paleDS, ear);
    inner.position.set(0, 0.03, 0.012);
    inner.rotation.y = s * 0.3;
    ears.push(ear);
  }
  // Antlers: branching tines, wound with bramble.
  const tine = (parent: THREE.Object3D, len: number, r: number) => {
    const g = new THREE.Group();
    parent.add(g);
    const m = mesh(new THREE.CylinderGeometry(r * 0.6, r, len, 6), C.antler, g);
    m.position.y = len / 2;
    const tip = mesh(new THREE.ConeGeometry(r * 0.6, 0.05, 6), C.tip, g);
    tip.position.y = len + 0.02;
    return g;
  };
  const leafAt = (parent: THREE.Object3D, x: number, y: number, z: number, rz: number, big = 1) => {
    const l = mesh(leafGeo(0.05 * big, 0.1 * big), C.leaf, parent);
    l.position.set(x, y, z);
    l.rotation.set(0.4, 0, rz);
  };
  for (const s of [-1, 1]) {
    const base = new THREE.Group();
    base.position.set(s * 0.065, 0.14, -0.02);
    base.rotation.set(-0.45, 0, -s * 0.42);
    base.scale.setScalar(1.2);
    head.add(base);
    // the main beam sweeps up and back, then curves forward
    const b1 = tine(base, 0.28, 0.03);
    const b2 = tine(b1, 0.26, 0.024);
    b2.position.y = 0.28;
    b2.rotation.set(0.35, 0, -s * 0.15);
    const b3 = tine(b2, 0.22, 0.019);
    b3.position.y = 0.26;
    b3.rotation.set(0.5, 0, s * 0.1);
    // forward brow tine and two upper points
    const brow = tine(base, 0.17, 0.018);
    brow.position.y = 0.07;
    brow.rotation.set(1.05, 0, s * 0.2);
    const t2 = tine(b1, 0.2, 0.017);
    t2.position.y = 0.24;
    t2.rotation.set(0.95, 0, s * 0.25);
    const t3 = tine(b2, 0.16, 0.014);
    t3.position.y = 0.22;
    t3.rotation.set(1.0, 0, -s * 0.35);
    // bramble: leaves along the beam, a blossom, and berry clusters
    leafAt(b1, s * 0.03, 0.12, 0.01, -s * 0.9);
    leafAt(b1, -s * 0.025, 0.22, 0.0, s * 0.8, 0.8);
    leafAt(b2, s * 0.025, 0.1, 0.0, -s * 1.0, 0.9);
    leafAt(b3, -s * 0.02, 0.14, 0.0, s * 0.8, 0.7);
    leafAt(t2, 0, 0.12, 0.015, s * 0.5, 0.7);
    const bl = flower(b2, C.blossom, C.heart, 1.4);
    bl.position.set(s * 0.03, 0.2, 0.02);
    bl.rotation.y = s * 0.8;
    for (const [par, y] of [
      [b1, 0.05],
      [b3, 0.08],
    ] as const) {
      for (let k = 0; k < 4; k++) {
        const b = mesh(new THREE.SphereGeometry(0.02, 6, 4), C.berry, par);
        b.position.set(-s * 0.035 + (k % 2) * 0.02 * s, y + Math.floor(k / 2) * 0.028, 0.02 + (k % 2) * 0.01);
      }
    }
    // a vine wrapping the lower beam
    const vine = mesh(new THREE.TorusGeometry(0.034, 0.006, 4, 12), C.leafDark, b1);
    vine.position.y = 0.17;
    vine.rotation.set(Math.PI / 2 + 0.4, 0, 0);
  }

  // Legs: long and slender, with hooves. Front legs bend back at the knee; hind legs have
  // a big thigh and a backward hock.
  interface Leg {
    upper: THREE.Group;
    lower: THREE.Group;
    hoof: THREE.Group;
    front: boolean;
    side: number;
  }
  const legs: Leg[] = [];
  const REST = { front: [0, 0, 0], hind: [-0.32, 0.72, -0.4] };
  for (const front of [true, false])
    for (const side of [-1, 1]) {
      const upper = joint(torso, side * 0.14, front ? -0.12 : -0.08, front ? 0.5 : -0.5);
      if (front) {
        const sh = ell(0.09, 0.2, 0.13, C.coat, upper, 10);
        sh.position.y = -0.12;
        mesh(limb(0.065, 0.045, 0.56), C.coat, upper);
      } else {
        const th = ell(0.11, 0.25, 0.17, C.coat, upper, 10);
        th.position.set(0, -0.14, -0.02);
        mesh(limb(0.075, 0.05, 0.58), C.coat, upper);
      }
      const lower = joint(upper, 0, front ? -0.56 : -0.58, 0);
      mesh(limb(0.034, 0.03, front ? 0.6 : 0.64), C.coat, lower);
      const hoof = joint(lower, 0, front ? -0.6 : -0.64, 0);
      const h = mesh(new THREE.CylinderGeometry(0.032, 0.046, 0.08, 8), C.hoof, hoof);
      h.position.set(0, -0.04, 0.008);
      const cleft = mesh(new THREE.BoxGeometry(0.006, 0.07, 0.03), C.coatDark, hoof);
      cleft.position.set(0, -0.045, 0.045);
      const [ux, lx, hx] = front ? REST.front : REST.hind;
      upper.rotation.x = ux;
      lower.rotation.x = lx;
      hoof.rotation.x = hx;
      legs.push({ upper, lower, hoof, front, side });
    }

  // Tail: brown on top with a white flag beneath.
  const tail = joint(torso, 0, 0.24, -0.84);
  const TAIL_REST = 2.6;
  tail.rotation.x = TAIL_REST;
  ell(0.06, 0.13, 0.035, C.coat, tail, 8).position.set(0, 0.1, 0);
  ell(0.055, 0.12, 0.03, C.pale, tail, 8).position.set(0, 0.1, 0.02);

  // Stand the hooves on the ground.
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const hoofY = legs.reduce((y, l) => y + l.hoof.getWorldPosition(v).y, 0) / legs.length;
  torso.position.y -= hoofY - 0.08;
  const TORSO_Y = torso.position.y;

  bake(root);

  // --- gait: a trot at walking speed blending into a gallop at a run ---
  let phase = 0;
  let idleT = 0;
  let graze = 0;
  let earT = 1;
  const blink = blinker();
  // Phase offsets (fractions of a stride): [front L, front R, hind L, hind R].
  const TROT = [0, 0.5, 0.5, 0];
  const GALLOP = [0, 0.12, 0.55, 0.67];
  return {
    root,
    back,
    animate(speed, dt, time) {
      const move = clamp01(speed / 2.5);
      const g = clamp01((speed - 8.5) / 3); // gallop blend
      const stride = lerp(2.5, 4.4, g);
      phase += (speed / stride) * Math.PI * 2 * dt;
      legs.forEach((L, i) => {
        const off = lerp(TROT[i], GALLOP[i], g) * Math.PI * 2;
        const ph = phase - off;
        const swing = Math.sin(ph) * lerp(0.42, 0.72, g) * move;
        const lift = Math.max(0, -Math.cos(ph)) * move;
        if (L.front) {
          L.upper.rotation.x = swing - lift * 0.25;
          L.lower.rotation.x = lift * lerp(1.2, 1.7, g);
          L.hoof.rotation.x = lift * 0.6;
        } else {
          L.upper.rotation.x = REST.hind[0] + swing * 0.9 - lift * 0.25;
          L.lower.rotation.x = REST.hind[1] + lift * lerp(0.5, 0.8, g);
          L.hoof.rotation.x = REST.hind[2] + lift * 0.5 - swing * 0.3;
        }
      });
      // Body: a light trotting bounce, or the rocking-horse pitch of a gallop.
      const trotBob = Math.abs(Math.sin(phase * 2)) * 0.035 * move * (1 - g);
      const gallopBob = (Math.sin(phase) * 0.5 + 0.5) * 0.08 * g;
      torso.position.y = TORSO_Y + trotBob + gallopBob;
      torso.rotation.x = -Math.sin(phase + 0.6) * 0.07 * g;

      // Idle: look around, flick the ears, and now and then drop the head to graze.
      const idle = 1 - move;
      idleT = speed < 0.3 ? idleT + dt : 0;
      const grazing = idleT > 6 && (idleT - 6) % 14 < 5 ? 1 : 0;
      graze += (grazing - graze) * Math.min(1, dt * 1.5);
      // Running, the neck pumps: at a gallop it swings down as the front hooves land and
      // lifts on the push-off (one beat per stride), with the head nodding a beat behind;
      // at a trot it bobs twice per stride and sways a little side to side.
      const trot = move * (1 - g);
      const pump = Math.sin(phase - 0.3) * 0.22 * g + Math.sin(phase * 2 - 0.5) * 0.07 * trot;
      const nod = -Math.sin(phase - 1.0) * 0.14 * g + Math.sin(phase * 2 - 1.3) * 0.05 * trot;
      neck.rotation.x = NECK_REST + graze * 1.25 + pump - move * 0.12 + Math.sin(time * 0.6) * 0.03 * idle;
      neck.rotation.y = Math.sin(time * 0.23) * 0.3 * idle * (1 - graze) + Math.sin(phase) * 0.05 * trot;
      head.rotation.x = HEAD_REST + graze * 0.5 + nod + Math.sin(time * 0.41) * 0.06 * idle;
      head.rotation.z = Math.sin(time * 0.31) * 0.08 * idle;
      earT -= dt;
      if (earT < 0) earT = 1.5 + Math.random() * 4;
      const flick = earT < 0.25 ? Math.sin((earT / 0.25) * Math.PI) * 0.5 : 0;
      ears.forEach((e, i) => {
        const s = i ? 1 : -1;
        e.rotation.x =
          -0.2 + (i ? flick : 0) + move * 0.35 + g * 0.3 + Math.sin(phase * 2 - 1.6 + i * 0.4) * 0.1 * move;
        e.rotation.z = -s * (1.05 - g * 0.25);
      });
      eyes.scale.y = blink(dt);
      // The tail flags up at a gallop and twitches at rest.
      tail.rotation.x = TAIL_REST - g * 0.9 + Math.sin(time * 5) * 0.05 * idle + Math.sin(phase * 2) * 0.1 * move;
      torso.scale.set(1, 1 + Math.sin(time * 1.4) * 0.008 * idle, 1);
    },
  };
}

export function buildMount(id: MountId): MountModel {
  return id === 'tortoise' ? tortoise() : stag();
}
