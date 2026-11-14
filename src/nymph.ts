import * as THREE from 'three';
import type { MountId, ToolId } from './economy';
import { DEFAULT_LOOK, HAIR_COLORS, Look, OUTFITS, SKINS } from './look';
import { bake, joint, lam, leafGeo, limb, mesh } from './rig';

// The wood nymph's third-person model: a small jointed rig (hips, spine, head, two-part
// arms and legs, swinging hair and leaf-petal skirt) with a procedural animation for
// idling, walking, running, jumping, riding and working the soil.
//
// She faces -z. Limb pivots hang their meshes down -y, so rotation.x > 0 swings a limb
// forward. After building, the meshes on each joint are merged per material so the whole
// nymph costs a few dozen draw calls.

type Mats = ReturnType<typeof materials>;

/** Fresh materials for one build, coloured by the chosen look. */
function materials(lk: Look) {
  const hair = HAIR_COLORS[lk.hairColor];
  const skin = SKINS[lk.skin];
  const out = OUTFITS[lk.outfit];
  const em = (c: number, k = 0.12) => new THREE.Color(c).multiplyScalar(k).getHex();
  return {
    skin: lam(skin.base, em(skin.base, 0.1)),
    blush: lam(skin.blush, em(skin.blush, 0.2)),
    hair: lam(hair.base, em(hair.base)),
    hairTip: lam(hair.tip, em(hair.tip)),
    hairDS: lam(hair.base, em(hair.base), THREE.DoubleSide),
    hairTipDS: lam(hair.tip, em(hair.tip), THREE.DoubleSide),
    dress: lam(out.dress, em(out.dress, 0.15)),
    leafDark: lam(out.dark, em(out.dark), THREE.DoubleSide),
    leafLight: lam(out.light, em(out.light), THREE.DoubleSide),
    sprout: lam(0x74bf55, 0x0c1c06, THREE.DoubleSide), // living leaves stay green
    sproutDark: lam(0x2f7a3c, 0x061406, THREE.DoubleSide),
    legging: lam(0x5e4a34),
    bark: lam(0x6b4a2b),
    twine: lam(0xa07a4a),
    leather: lam(0x8a5a33),
    boot: lam(0x5a4028),
    bloom: lam(0xff9ec4, 0x552233, THREE.DoubleSide),
    bloom2: lam(0xfff6e8, 0x333333, THREE.DoubleSide),
    bloom3: lam(0xc3b5ff, 0x2a2244, THREE.DoubleSide),
    bloomHeart: lam(0xfff27a, 0x444010),
    capRed: lam(0xd8574a, 0x2a0a06),
    capDot: lam(0xfff6e4, 0x222222),
    capUnder: lam(0xf0e2c4),
    wing: new THREE.MeshLambertMaterial({
      color: 0xdcfff0,
      emissive: 0x3a6a58,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    eye: new THREE.MeshBasicMaterial({ color: 0x1d2b24 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    metal: lam(0xc9ccd6),
    wood: lam(0x8a5a33),
    glove: lam(0x6fae55),
  };
}

export interface NymphRig {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Group;
  arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group }[]; // [left, right]
  legs: { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }[];
  petals: THREE.Group[];
  hair: THREE.Group[]; // back of the hair, a hanging chain
  locks: THREE.Group[]; // side locks
  cape: THREE.Group | null;
  wings: THREE.Group[];
  tools: Record<ToolId, THREE.Object3D>;
  glow: THREE.Mesh;
  anim: NymphAnim;
}

interface NymphAnim {
  phase: number;
  speed: number; // smoothed ground speed
  air: number; // 0 grounded .. 1 airborne
  work: number;
  blinkT: number;
  last: Map<THREE.Object3D, THREE.Euler>;
}

const HIP_Y = 0.86;

export function buildNymph(lk: Look = DEFAULT_LOOK): NymphRig {
  const M = materials(lk);
  const male = lk.body === 'male';
  const root = new THREE.Group();
  const hips = joint(root, 0, HIP_Y, 0);

  // ---- hips: belt, under-skirt, satchel ----
  mesh(new THREE.CylinderGeometry(0.125, 0.135, 0.12, 10), M.dress, hips).scale.z = 0.8;
  const belt = mesh(new THREE.TorusGeometry(0.128, 0.014, 5, 16), M.twine, hips);
  belt.rotation.x = Math.PI / 2;
  belt.scale.y = 0.8;
  belt.position.y = 0.05;
  // a little flower on the belt
  const beltBloom = new THREE.Group();
  beltBloom.position.set(0.07, 0.05, -0.1);
  hips.add(beltBloom);
  for (let i = 0; i < 5; i++) {
    const p = mesh(leafGeo(0.04, 0.05, 0.1), M.bloom, beltBloom);
    p.rotation.set(0, Math.PI, (i / 5) * Math.PI * 2);
  }
  mesh(new THREE.SphereGeometry(0.015, 6, 4), M.bloomHeart, beltBloom).position.z = -0.01;
  // satchel on the left hip, for seeds
  const bag = new THREE.Group();
  bag.position.set(-0.19, -0.06, 0.03);
  bag.rotation.z = 0.12;
  hips.add(bag);
  mesh(new THREE.SphereGeometry(0.075, 9, 6), M.leather, bag).scale.set(0.55, 0.9, 1);
  const flap = mesh(new THREE.SphereGeometry(0.077, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), M.bark, bag);
  flap.scale.set(0.58, 0.9, 1.04);
  flap.position.y = 0.012;
  for (let i = 0; i < 3; i++) {
    const s = mesh(new THREE.SphereGeometry(0.014, 5, 4), M.bark, bag);
    s.position.set(-0.01, 0.065, -0.025 + i * 0.022);
  }
  const sprout = mesh(leafGeo(0.03, 0.07, 0.2), M.sprout, bag);
  sprout.position.set(-0.015, 0.06, 0.01);
  sprout.rotation.set(0.3, 0.4, 0.4);

  // ---- outer petal skirt: each petal swings on its own ----
  const petals: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const g = joint(hips, Math.sin(a) * 0.125, 0.05, Math.cos(a) * 0.1);
    // Yaw first, then flare about the petal's own (tangent) axis, so every petal flares
    // outward from where it sits, not just the ones at the front and back.
    g.rotation.order = 'YXZ';
    g.rotation.y = a;
    // his is a short leaf tunic, hers a knee-length petal skirt
    const leaf = mesh(male ? leafGeo(0.22, 0.32, 0.25) : leafGeo(0.2, 0.44), M.leafDark, g);
    leaf.rotation.x = Math.PI;
    // A shorter, lighter leaf tucked just inside, between this petal and the next. It rides
    // on the same joint, so it gets kicked out of the way of her legs with the petal.
    const inner = mesh(leafGeo(0.15, male ? 0.22 : 0.3), M.leafLight, g);
    inner.position.set(0.045, 0, -0.012);
    inner.rotation.set(Math.PI + 0.06, 0.18, 0);
    petals.push(g);
  }

  // ---- legs ----
  const legs: NymphRig['legs'] = [];
  for (const side of [-1, 1]) {
    const hip = joint(hips, side * 0.07, -0.02, 0);
    const legMat = male ? M.legging : M.skin;
    mesh(limb(male ? 0.064 : 0.06, 0.047, 0.4), legMat, hip);
    const knee = joint(hip, 0, -0.4, 0);
    mesh(limb(0.047, 0.037, 0.4), legMat, knee);
    // leaf-wrapped boots from mid-shin down
    const cuff = mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.2, 8), M.boot, knee);
    cuff.position.y = -0.3;
    for (let k = 0; k < 4; k++) {
      const l = mesh(leafGeo(0.06, 0.1, 0.4), M.leafDark, knee);
      const a = (k / 4) * Math.PI * 2 + 0.4;
      l.position.set(Math.sin(a) * 0.045, -0.2, Math.cos(a) * 0.045);
      l.rotation.set(0.25, a, 0, 'YXZ');
    }
    const ankle = joint(knee, 0, -0.4, 0);
    const foot = mesh(new THREE.SphereGeometry(0.05, 8, 5), M.boot, ankle);
    foot.scale.set(0.85, 0.6, 1.9);
    foot.position.set(0, -0.025, -0.045);
    const toe = mesh(leafGeo(0.05, 0.07, 0.3), M.leafDark, ankle);
    toe.position.set(0, -0.01, -0.12);
    toe.rotation.set(-Math.PI / 2 + 0.5, 0, 0);
    legs.push({ hip, knee, ankle });
  }

  // ---- torso ----
  const spine = joint(hips, 0, 0.04, 0);
  // hers tapers to a waist; his is straighter, with broader shoulders
  const torsoPts = (
    male
      ? [
          [0, 0],
          [0.126, 0],
          [0.122, 0.08],
          [0.118, 0.17],
          [0.132, 0.28],
          [0.148, 0.36],
          [0.138, 0.415],
          [0.085, 0.45],
          [0.04, 0.46],
          [0, 0.46],
        ]
      : [
          [0, 0],
          [0.128, 0],
          [0.118, 0.07],
          [0.096, 0.16],
          [0.11, 0.27],
          [0.122, 0.34],
          [0.112, 0.4],
          [0.072, 0.445],
          [0.035, 0.46],
          [0, 0.46],
        ]
  ).map(([r, y]) => new THREE.Vector2(r, y));
  const torso = mesh(new THREE.LatheGeometry(torsoPts, 12), M.dress, spine);
  torso.scale.z = 0.74;
  // leaf collar draped over the shoulders
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * (male ? 0.085 : 0.075), 0.44, Math.cos(a) * 0.058);
    g.rotation.y = a;
    spine.add(g);
    const leaf = mesh(leafGeo(0.09, 0.13, 0.3), i % 2 ? M.leafLight : M.leafDark, g);
    leaf.rotation.x = Math.PI - 1.0;
  }
  // satchel strap, right shoulder to left hip
  const strap = mesh(new THREE.TorusGeometry(male ? 0.19 : 0.175, 0.011, 4, 24), M.leather, spine);
  strap.position.set(0, 0.2, 0);
  // lay the ring flat around the body, then tip it so it runs from the right shoulder down
  strap.rotation.set(Math.PI / 2, 0, 0.75, 'ZYX');
  strap.scale.set(0.92, 0.54, 1);

  // ---- arms ----
  const arms: NymphRig['arms'] = [];
  for (const side of [-1, 1]) {
    const shoulder = joint(spine, side * (male ? 0.158 : 0.135), 0.39, 0);
    mesh(limb(male ? 0.048 : 0.042, male ? 0.04 : 0.035, 0.26), M.skin, shoulder);
    const elbow = joint(shoulder, 0, -0.26, 0);
    mesh(limb(male ? 0.04 : 0.035, male ? 0.033 : 0.03, 0.23), M.skin, elbow);
    // leafy bracer
    for (let k = 0; k < 3; k++) {
      const l = mesh(leafGeo(0.05, 0.09, 0.4), M.leafLight, elbow);
      const a = (k / 3) * Math.PI * 2 + side;
      l.position.set(Math.sin(a) * 0.03, -0.12, Math.cos(a) * 0.03);
      l.rotation.set(0.35, a, 0, 'YXZ');
    }
    const hand = joint(elbow, 0, -0.24, 0);
    const palm = mesh(new THREE.SphereGeometry(0.036, 8, 5), M.skin, hand);
    palm.scale.set(0.7, 1.15, 1);
    palm.position.y = -0.02;
    const thumb = mesh(limb(0.012, 0.011, 0.04), M.skin, hand);
    thumb.position.set(side * -0.005, -0.01, -0.025);
    thumb.rotation.x = 0.7;
    arms.push({ shoulder, elbow, hand });
  }

  // ---- head ----
  const neck = joint(spine, 0, 0.44, 0);
  mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.1, 8), M.skin, neck).position.y = 0.04;
  const head = joint(neck, 0, 0.19, 0);
  head.scale.setScalar(1.1);
  // One smooth skull, tapered toward a soft pointed chin (no seams on the face).
  const skullGeo = new THREE.SphereGeometry(0.15, 18, 14);
  {
    const sp = skullGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i) / 0.15;
      if (y < 0.1) {
        const t = (0.1 - y) / 1.1; // 0 at the cheekbones, 1 at the chin
        sp.setX(i, sp.getX(i) * (1 - (male ? 0.2 : 0.32) * t * t));
        sp.setZ(i, sp.getZ(i) * (1 - 0.12 * t) - 0.012 * t);
        sp.setY(i, sp.getY(i) - 0.012 * t);
      }
    }
    skullGeo.computeVertexNormals();
  }
  const skull = mesh(skullGeo, M.skin, head);
  skull.scale.set(0.95, 1.04, 0.98);
  // tiny nose
  mesh(new THREE.SphereGeometry(0.014, 6, 4), M.skin, head).position.set(0, -0.02, -0.15);
  for (const side of [-1, 1]) {
    if (!male) {
      const cheek = mesh(new THREE.CircleGeometry(0.024, 10), M.blush, head);
      cheek.position.set(side * 0.082, -0.04, -0.122);
      cheek.lookAt(side * 0.5, -0.27, -1);
    } else {
      // a firmer brow
      const brow = mesh(new THREE.BoxGeometry(0.05, 0.011, 0.012), M.hair, head);
      brow.position.set(side * 0.058, 0.05, -0.132);
      brow.rotation.set(0.25, 0, -side * 0.12);
    }
    // pointed ears
    const ear = mesh(new THREE.ConeGeometry(0.03, 0.13, 6), M.skin, head);
    ear.scale.z = 0.45;
    ear.position.set(side * 0.155, 0.0, 0.01);
    ear.rotation.set(0.35, 0, -side * 1.15);
  }
  // mouth: a small smile
  const mouth = mesh(new THREE.TorusGeometry(0.02, 0.0045, 4, 10, Math.PI), M.eye, head);
  mouth.position.set(0, -0.065, -0.128);
  mouth.rotation.set(0.2, 0, Math.PI);
  // eyes (their own joint so they can blink)
  const eyes = joint(head, 0, 0.0, 0);
  for (const side of [-1, 1]) {
    const e = mesh(new THREE.SphereGeometry(0.026, 10, 8), M.eye, eyes);
    e.position.set(side * 0.056, 0.005, -0.128);
    e.scale.set(0.85, male ? 1.1 : 1.25, 0.5);
    const s = mesh(new THREE.SphereGeometry(0.008, 6, 4), M.shine, eyes);
    s.position.set(side * 0.056 + 0.007, 0.018, -0.14);
    if (!male) {
      // a lash flick at the outer corner
      const lash = mesh(new THREE.BoxGeometry(0.022, 0.006, 0.006), M.eye, eyes);
      lash.position.set(side * 0.084, 0.028, -0.12);
      lash.rotation.z = side * 0.5;
    }
  }

  // ---- hair ----
  const { hair, locks } = buildHair(lk, head, M);

  // ---- headwear ----
  buildHeadwear(lk, head, M);

  // ---- on her back ----
  const { cape, wings } = buildBack(lk, spine, M);

  // ---- tools, held in the right hand ----
  const handR = arms[1].hand;
  const tools = buildHandTools(handR, M);

  // Soft glow at her feet so she reads from far away.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 20),
    new THREE.MeshBasicMaterial({ color: 0xc6ff9e, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  glow.userData.keep = true;
  root.add(glow);

  bake(root);
  return {
    root,
    hips,
    spine,
    neck,
    head,
    eyes,
    arms,
    legs,
    petals,
    hair,
    locks,
    cape,
    wings,
    tools,
    glow,
    anim: { phase: 0, speed: 0, air: 0, work: 0, blinkT: 2, last: new Map() },
  };
}

/** Hair: a cap and fringe for every style, plus the style's own locks, chain or bun. */
function buildHair(lk: Look, head: THREE.Group, M: Mats) {
  const hair: THREE.Group[] = [];
  const locks: THREE.Group[] = [];
  const short = lk.hair === 'short';
  const cap = mesh(new THREE.SphereGeometry(0.162, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), M.hair, head);
  cap.rotation.x = 0.42;
  cap.position.y = 0.012;
  cap.scale.set(1, 1.02, 1);
  const backCap = mesh(new THREE.SphereGeometry(0.158, 14, 10), M.hair, head);
  backCap.position.set(0, short ? 0.01 : -0.01, 0.04);
  backCap.scale.set(1, short ? 0.9 : 0.98, 0.92);
  // fringe: leaf-shaped locks sweeping across the forehead
  for (let i = 0; i < 5; i++) {
    const t = i / 4 - 0.5;
    const g = new THREE.Group();
    g.position.set(t * 0.2, 0.125 - Math.abs(t) * 0.05, -0.1 + Math.abs(t) * 0.04);
    g.rotation.set(0, t * 1.2, 0);
    head.add(g);
    const lock = mesh(leafGeo(0.07, short ? 0.08 : 0.11, 0.25), M.hairDS, g);
    lock.rotation.set(Math.PI - (short ? 0.85 : 0.55), 0, -t * 0.5 + 0.25);
  }
  /** A hanging chain of joints down the back; each segment's meshes come from `seg`. */
  const chain = (n: number, top: [number, number], step: number, seg: (j: THREE.Group, k: number) => void) => {
    let parent: THREE.Object3D = head;
    for (let k = 0; k < n; k++) {
      const j = k === 0 ? joint(parent, 0, top[0], top[1]) : joint(parent, 0, -step, 0.006);
      seg(j, k);
      hair.push(j);
      parent = j;
    }
  };
  const sideLocks = (len: number) => {
    for (const side of [-1, 1]) {
      const j = joint(head, side * 0.13, 0.03, -0.05);
      const l = mesh(leafGeo(0.07, len, 0.3), M.hairDS, j);
      l.rotation.set(Math.PI, side * 0.5, side * 0.12);
      const tip = mesh(leafGeo(0.05, 0.08, 0.2), M.hairTipDS, j);
      tip.position.y = -len + 0.04;
      tip.rotation.set(Math.PI, side * 0.5, side * 0.1);
      locks.push(j);
    }
  };

  if (lk.hair === 'long') {
    const seg = [
      { w: 0.25, l: 0.2 },
      { w: 0.22, l: 0.17 },
      { w: 0.17, l: 0.14 },
    ];
    chain(3, [-0.02, 0.105], 0.15, (j, k) => {
      const s = seg[k];
      const blob = mesh(new THREE.SphereGeometry(0.5, 10, 7), k === 2 ? M.hairTip : M.hair, j);
      blob.scale.set(s.w, s.l, 0.07);
      blob.position.y = -s.l * 0.42;
      // sharper strands at the edges so it reads as hair, not a cape
      for (const side of [-1, 1]) {
        const st = mesh(leafGeo(s.w * 0.35, s.l * 0.9, 0.1), k === 2 ? M.hairTipDS : M.hairDS, j);
        st.position.set(side * s.w * 0.36, -s.l * 0.15, 0);
        st.rotation.set(Math.PI, 0, side * 0.12);
      }
    });
    sideLocks(0.24);
  } else if (lk.hair === 'braid') {
    // one thick braid of alternating twists, tied off with a leaf
    chain(5, [-0.06, 0.13], 0.085, (j, k) => {
      for (let b = 0; b < 2; b++) {
        const lobe = mesh(new THREE.SphereGeometry(0.045 - k * 0.004, 8, 6), k === 4 && b ? M.hairTip : M.hair, j);
        lobe.scale.set(1, 1.15, 0.85);
        lobe.position.set((b ? 1 : -1) * 0.014, -0.02 - b * 0.042, 0);
      }
      if (k === 4) {
        const tie = mesh(new THREE.TorusGeometry(0.022, 0.008, 4, 10), M.twine, j);
        tie.rotation.x = Math.PI / 2;
        tie.position.y = -0.085;
        const leaf = mesh(leafGeo(0.045, 0.08), M.sprout, j);
        leaf.position.set(0.02, -0.085, 0.02);
        leaf.rotation.set(0.4, 0, -1.2);
        const tuft = mesh(leafGeo(0.05, 0.08, 0.2), M.hairTipDS, j);
        tuft.position.y = -0.09;
        tuft.rotation.x = Math.PI;
      }
    });
    sideLocks(0.15);
  } else if (lk.hair === 'bun') {
    const bun = mesh(new THREE.SphereGeometry(0.085, 12, 9), M.hair, head);
    bun.position.set(0, 0.13, 0.11);
    bun.scale.set(1, 0.9, 0.95);
    const wrap = mesh(new THREE.TorusGeometry(0.075, 0.013, 5, 14), M.hairTip, head);
    wrap.position.set(0, 0.105, 0.1);
    wrap.rotation.x = Math.PI / 2 - 0.6;
    // a twig hairpin through the bun, with a leaf
    const pin = mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.26, 5), M.bark, head);
    pin.position.set(0, 0.15, 0.12);
    pin.rotation.set(0.2, 0, 1.25);
    const pl = mesh(leafGeo(0.04, 0.07), M.sprout, head);
    pl.position.set(-0.12, 0.17, 0.12);
    pl.rotation.set(0.3, 0, 1.0);
    sideLocks(0.16);
  } else {
    // short and tufty: leaf-shaped locks flicking out around the back and sides
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.35 + (i / 8) * 1.3);
      const g = new THREE.Group();
      g.position.set(Math.sin(a) * 0.14, -0.02 + Math.abs(Math.cos(a)) * 0.03, Math.cos(a) * -0.13 + 0.03);
      g.rotation.y = Math.PI - a;
      head.add(g);
      const l = mesh(leafGeo(0.07, 0.1, 0.3), i % 2 ? M.hairTipDS : M.hairDS, g);
      l.rotation.set(Math.PI - 0.5, 0, (i % 3) * 0.15 - 0.15);
    }
  }
  return { hair, locks };
}

function buildHeadwear(lk: Look, head: THREE.Group, M: Mats) {
  const bloomAt = (parent: THREE.Object3D, mat: THREE.Material, size = 1) => {
    const b = new THREE.Group();
    parent.add(b);
    for (let i = 0; i < 6; i++) {
      const p = mesh(leafGeo(0.05 * size, 0.065 * size, 0.35), mat, b);
      p.rotation.set(0.35, 0, (i / 6) * Math.PI * 2, 'ZXY');
    }
    mesh(new THREE.SphereGeometry(0.02 * size, 6, 5), M.bloomHeart, b).position.z = 0.012 * size;
    return b;
  };
  const leafCrown = () => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const g = new THREE.Group();
      g.position.set(Math.sin(a) * 0.145, 0.07, Math.cos(a) * 0.14);
      g.rotation.y = a;
      head.add(g);
      const l = mesh(leafGeo(0.06, 0.09, 0.3), i % 2 ? M.sprout : M.sproutDark, g);
      l.rotation.x = -0.9;
    }
  };

  if (lk.head === 'antlers') {
    for (const side of [-1, 1]) {
      const tw = new THREE.Group();
      tw.position.set(side * 0.07, 0.12, 0.0);
      tw.rotation.set(0.3, 0, -side * 0.5);
      head.add(tw);
      const main = mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.16, 5), M.bark, tw);
      main.position.y = 0.08;
      const fork = mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.08, 5), M.bark, tw);
      fork.position.set(-side * 0.02, 0.1, 0);
      fork.rotation.z = side * 0.7;
      const fork2 = mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.06, 5), M.bark, tw);
      fork2.position.set(side * 0.015, 0.06, 0.005);
      fork2.rotation.z = -side * 0.8;
      for (const [x, y, rz] of [
        [0, 0.16, 0],
        [-side * 0.045, 0.13, side * 0.9],
        [side * 0.04, 0.075, -side * 1.1],
      ]) {
        const l = mesh(leafGeo(0.035, 0.06, 0.3), M.sprout, tw);
        l.position.set(x, y, 0);
        l.rotation.set(0.2, 0, rz);
      }
    }
    leafCrown();
    const b = bloomAt(head, M.bloom);
    b.position.set(0.12, 0.1, -0.06);
    b.lookAt(0.9, 0.9, -0.6);
  } else if (lk.head === 'flowers') {
    // a ring of blossoms in three colours, with leaves between
    const mats = [M.bloom, M.bloom2, M.bloom3];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const g = new THREE.Group();
      g.position.set(Math.sin(a) * 0.15, 0.085, Math.cos(a) * 0.145);
      g.rotation.set(-0.75, a, 0, 'YXZ');
      head.add(g);
      const b = bloomAt(g, mats[i % 3], 0.85);
      b.rotation.y = Math.PI; // face outward
      const l = mesh(leafGeo(0.035, 0.07, 0.3), M.sprout, g);
      l.rotation.set(0, Math.PI, 1.8);
      l.position.set(0.04, 0, 0.01);
    }
  } else if (lk.head === 'mushroom') {
    // a toadstool hat, worn at a jaunty angle
    const hat = new THREE.Group();
    hat.position.set(0, 0.11, 0.01);
    hat.rotation.set(0.1, 0, 0.14);
    head.add(hat);
    const cap = mesh(new THREE.SphereGeometry(0.22, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), M.capRed, hat);
    cap.scale.y = 0.62;
    const under = mesh(new THREE.CylinderGeometry(0.215, 0.16, 0.03, 18), M.capUnder, hat);
    under.position.y = -0.01;
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const r = i === 0 ? 0 : 0.06 + (i % 3) * 0.045;
      const d = mesh(new THREE.SphereGeometry(0.02 + (i % 2) * 0.008, 6, 4), M.capDot, hat);
      const y = Math.sqrt(Math.max(0, 1 - (r / 0.22) ** 2)) * 0.22 * 0.62;
      d.position.set(Math.cos(a) * r, y - 0.004, Math.sin(a) * r);
      d.scale.y = 0.45;
    }
  }
}

/** What she wears on her back (the satchel strap is always there). */
function buildBack(lk: Look, spine: THREE.Group, M: Mats) {
  let cape: THREE.Group | null = null;
  const wings: THREE.Group[] = [];
  if (lk.back === 'cape') {
    cape = joint(spine, 0, 0.43, 0.1);
    // overlapping big leaves hanging from the shoulders, with a twine tie at the collar
    for (let i = 0; i < 5; i++) {
      const t = i / 4 - 0.5;
      const l = mesh(leafGeo(0.2, 0.62 - Math.abs(t) * 0.16, 0.18), i % 2 ? M.leafLight : M.leafDark, cape);
      l.position.set(t * 0.2, 0.02, 0.01 - Math.abs(t) * 0.03);
      // Hang down and back, flared enough to clear the skirt at rest. The leaf is turned
      // around its own length (y = π) so it curves away from her body rather than into it.
      l.rotation.set(Math.PI - 0.36, Math.PI, t * 0.22);
    }
    const tie = mesh(new THREE.TorusGeometry(0.1, 0.012, 4, 14, Math.PI), M.twine, cape);
    tie.rotation.set(-Math.PI / 2, 0, 0);
    tie.position.set(0, 0.0, -0.04);
  } else if (lk.back === 'wings') {
    for (const side of [-1, 1]) {
      const w = joint(spine, side * 0.04, 0.33, 0.085);
      // upper and lower petals, flat against the back's plane, splaying outward
      const up = mesh(leafGeo(0.2, 0.4, 0.08), M.wing, w);
      up.rotation.set(0, 0, -side * 0.95);
      const lo = mesh(leafGeo(0.13, 0.26, 0.08), M.wing, w);
      lo.rotation.set(0, 0, -side * 2.2);
      lo.position.y = -0.03;
      w.userData.side = side;
      wings.push(w);
    }
  }
  return { cape, wings };
}

function buildHandTools(hand: THREE.Group, M: Mats): Record<ToolId, THREE.Object3D> {
  const tweezers = joint(hand, 0, -0.04, -0.01);
  for (const s of [-1, 1]) {
    const arm = mesh(new THREE.BoxGeometry(0.008, 0.008, 0.16), M.metal, tweezers);
    arm.position.set(s * 0.007, 0, -0.07);
    arm.rotation.y = -s * 0.05;
  }
  mesh(new THREE.SphereGeometry(0.01, 6, 4), M.bark, tweezers).position.set(0, 0, -0.15);
  tweezers.rotation.x = 0.4;

  // A glove: a green mitt over the hand.
  const glove = joint(hand, 0, 0, 0);
  const mitt = mesh(new THREE.SphereGeometry(0.045, 8, 6), M.glove, glove);
  mitt.scale.set(0.8, 1.25, 1.05);
  mitt.position.y = -0.025;
  const cuff = mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.04, 8), M.glove, glove);
  cuff.position.y = 0.015;

  // The rake: the grip is the joint's origin and the head hangs 1 m down the handle.
  // animateNymph moves it between the hand (carried upright like a staff) and the hips
  // (planted in the soil in front of her while raking).
  const rake = joint(hand, 0, 0, 0);
  const handle = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6), M.wood, rake);
  handle.position.y = -0.4;
  const bar = mesh(new THREE.BoxGeometry(0.26, 0.022, 0.022), M.metal, rake);
  bar.position.y = -1.04;
  for (let i = 0; i < 7; i++) {
    const t = mesh(new THREE.BoxGeometry(0.008, 0.008, 0.07), M.metal, rake);
    t.position.set(-0.12 + i * 0.04, -1.04, 0.035);
  }
  return { tweezers, glove, rake };
}

export function setNymphTool(rig: NymphRig, id: ToolId) {
  for (const [k, m] of Object.entries(rig.tools)) m.visible = k === id;
}

export interface NymphState {
  speed: number; // ground speed, m/s
  running: boolean;
  onGround: boolean;
  vy: number;
  riding: MountId | null;
  work: number; // 0..1, planting / raking
  tool: ToolId;
}

const lerp = THREE.MathUtils.lerp;

/** Pose the nymph for this frame. */
export function animateNymph(rig: NymphRig, s: NymphState, dt: number, time: number) {
  const A = rig.anim;
  A.speed += (s.speed - A.speed) * Math.min(1, dt * 8);
  A.air += ((s.onGround ? 0 : 1) - A.air) * Math.min(1, dt * 10);
  A.work += (Math.min(1, s.work * 2) - A.work) * Math.min(1, dt * 10);
  const sp = s.riding ? 0 : A.speed;
  // Stride length grows with speed, so the cycle rate stays sane and the feet don't skate much.
  const stride = lerp(1.1, 1.5, THREE.MathUtils.clamp((sp - 2) / 5, 0, 1));
  A.phase += (sp / (2 * stride)) * Math.PI * 2 * dt;
  const p = A.phase;
  const move = THREE.MathUtils.clamp(sp / 3, 0, 1); // walk blend
  const run = THREE.MathUtils.clamp((sp - 4.5) / 3, 0, 1); // run blend
  const idle = 1 - move;
  const air = s.riding ? 0 : A.air;
  const work = s.riding ? 0 : A.work * (1 - move * 0.7);

  const sinP = Math.sin(p);
  const cosP = Math.cos(p);
  const breathe = Math.sin(time * 1.7);
  const [L, R] = rig.legs;
  const [AL, AR] = rig.arms;

  // --- target pose (rotations in radians) ---
  const legSwing = lerp(0.55, 0.8, run) * move;
  let hipY = HIP_Y + move * (Math.abs(cosP) * lerp(0.025, 0.06, run) - lerp(0.02, 0.05, run));
  let hipRotY = sinP * 0.12 * move;
  let hipRotZ = 0;
  let lean = -lerp(0.04, 0.26, run) * move;
  let pose = {
    lHip: sinP * legSwing,
    rHip: -sinP * legSwing,
    lHipZ: -0.03,
    rHipZ: 0.03,
    lKnee: -(0.08 + Math.max(0, cosP) * lerp(0.6, 1.3, run) * move),
    rKnee: -(0.08 + Math.max(0, -cosP) * lerp(0.6, 1.3, run) * move),
    lAnkle: 0,
    rAnkle: 0,
    lSh: -sinP * lerp(0.4, 0.75, run) * move + idle * 0.04,
    rSh: sinP * lerp(0.4, 0.75, run) * move + idle * 0.04,
    lShZ: -(0.14 + idle * 0.03 * breathe),
    rShZ: 0.14 + idle * 0.03 * breathe,
    lElbow: 0.18 + lerp(0.2, 1.25, run) * move + Math.max(0, -sinP) * 0.3 * move,
    rElbow: 0.18 + lerp(0.2, 1.25, run) * move + Math.max(0, sinP) * 0.3 * move,
    headX: 0,
    headY: 0,
  };
  // feet flex: toes up as the leg reaches forward, pushing off behind
  pose.lAnkle = -pose.lHip * 0.4 - pose.lKnee * 0.6;
  pose.rAnkle = -pose.rHip * 0.4 - pose.rKnee * 0.6;

  // Idle: weight on one hip, a slow look around, breathing.
  hipRotZ += idle * 0.04;
  pose.lHipZ += idle * 0.02;
  pose.rKnee -= idle * 0.12;
  pose.headY += idle * (Math.sin(time * 0.31) * 0.35 + Math.sin(time * 0.83) * 0.1);
  pose.headX += idle * Math.sin(time * 0.47) * 0.08;

  // Airborne: tuck the legs, fling the arms out a little.
  if (air > 0.01) {
    const up = THREE.MathUtils.clamp(s.vy / 5, -1, 1);
    pose.lHip = lerp(pose.lHip, 0.7, air);
    pose.rHip = lerp(pose.rHip, -0.15, air);
    pose.lKnee = lerp(pose.lKnee, -1.2, air);
    pose.rKnee = lerp(pose.rKnee, -0.5 - up * 0.2, air);
    pose.lSh = lerp(pose.lSh, -0.3, air);
    pose.rSh = lerp(pose.rSh, 0.5, air);
    pose.lShZ = lerp(pose.lShZ, -0.9 - up * 0.3, air);
    pose.rShZ = lerp(pose.rShZ, 0.9 + up * 0.3, air);
    pose.lElbow = lerp(pose.lElbow, 0.6, air);
    pose.rElbow = lerp(pose.rElbow, 0.6, air);
    lean = lerp(lean, -0.1, air);
  }

  // Working the soil: crouch, bend forward and reach down with the tool hand.
  if (work > 0.01) {
    const dig = Math.sin(time * (s.tool === 'rake' ? 7 : 11));
    const rake = s.tool === 'rake' ? 1 : 0;
    hipY -= work * lerp(0.16, 0.08, rake);
    lean = lerp(lean, -0.5 + rake * 0.25, work);
    pose.lHip = lerp(pose.lHip, 0.55, work);
    pose.rHip = lerp(pose.rHip, -0.05, work);
    pose.lKnee = lerp(pose.lKnee, -0.85, work);
    pose.rKnee = lerp(pose.rKnee, -0.45, work);
    pose.lAnkle = lerp(pose.lAnkle, 0.3, work);
    pose.rAnkle = lerp(pose.rAnkle, 0.5, work);
    pose.rSh = lerp(pose.rSh, lerp(0.95, 0.55, rake) + dig * lerp(0.12, 0.25, rake), work);
    pose.rShZ = lerp(pose.rShZ, lerp(0.1, 0.05, rake), work);
    pose.rElbow = lerp(pose.rElbow, lerp(0.25, 0.7, rake) - dig * 0.2 * rake, work);
    pose.lSh = lerp(pose.lSh, lerp(0.35, 0.8, rake) + dig * 0.25 * rake, work);
    pose.lShZ = lerp(pose.lShZ, lerp(-0.25, 0.3, rake), work);
    pose.lElbow = lerp(pose.lElbow, lerp(0.5, 0.45, rake) - dig * 0.2 * rake, work);
    pose.headX = lerp(pose.headX, -0.45, work);
    pose.headY = lerp(pose.headY, 0, work);
  }

  // Riding: sit on the mount's back and hold on.
  if (s.riding) {
    // The mount's own gait moves her (she's parented to its back); just sway a little.
    hipY = s.riding === 'stag' ? 0.1 : 0.44;
    hipRotY = 0;
    hipRotZ = Math.sin(time * 1.3) * 0.02 * idle;
    lean = -0.1;
    if (s.riding === 'stag') {
      // astride the saddle, thighs hugging the stag's lean barrel, lower legs hanging
      pose.lHip = pose.rHip = 0.5;
      pose.lHipZ = -0.62;
      pose.rHipZ = 0.62;
      pose.lKnee = pose.rKnee = -0.95;
      pose.lAnkle = pose.rAnkle = 0.3;
      // hands resting on the stag's withers, in its leafy mane
      pose.lSh = pose.rSh = 0.42;
      pose.lShZ = -0.05;
      pose.rShZ = 0.05;
      pose.lElbow = pose.rElbow = 1.05;
      lean = -0.18;
    } else {
      // kneeling on the leaf mat, sitting back on her heels, hands resting on her thighs
      pose.lHip = pose.rHip = 0.12;
      pose.lHipZ = -0.12;
      pose.rHipZ = 0.12;
      pose.lKnee = pose.rKnee = -2.05;
      pose.lAnkle = pose.rAnkle = -0.5;
      pose.lSh = pose.rSh = 0.35;
      pose.lShZ = -0.08;
      pose.rShZ = 0.08;
      pose.lElbow = pose.rElbow = 0.75;
      lean = -0.08;
    }
    pose.headX = 0.05;
    pose.headY = Math.sin(time * 0.4) * 0.2;
  }

  // Rake: carried over the right shoulder (gripped at the chest, the handle resting on top
  // of the shoulder, the head riding up behind her), or planted in the soil and drawn back
  // and forth while raking.
  if (s.tool === 'rake') {
    const r = rig.tools.rake;
    const raking = work > 0.3;
    const want = raking ? rig.hips : rig.spine;
    if (r.parent !== want) want.add(r);
    if (raking) {
      const pull = Math.sin(time * 7) * 0.12;
      r.position.set(0.1, 0.02, -0.28 - pull);
      r.rotation.set(0.72, 0, 0);
    } else {
      // Handle runs up and back (-y of the rake → (0, 0.5, 0.87)), tines turned down.
      r.position.set(0.15, 0.34, -0.16);
      r.rotation.set(-2.09, Math.PI, 0);
      // Right hand holds the grip: upper arm hangs, forearm folds up to the chest.
      const hold = 1 - (s.riding ? 0 : air * 0.3);
      pose.rSh = lerp(pose.rSh, 0.05, hold);
      pose.rShZ = lerp(pose.rShZ, 0.08, hold);
      pose.rElbow = lerp(pose.rElbow, 2.45, hold);
    }
  }

  // --- apply, easing each joint toward its target ---
  const k = Math.min(1, dt * 16);
  const set = (o: THREE.Object3D, x: number, y: number, z: number) => {
    o.rotation.x += (x - o.rotation.x) * k;
    o.rotation.y += (y - o.rotation.y) * k;
    o.rotation.z += (z - o.rotation.z) * k;
  };
  rig.hips.position.y += (hipY - rig.hips.position.y) * Math.min(1, dt * 20);
  set(rig.hips, 0, hipRotY, hipRotZ);
  set(rig.spine, lean, -hipRotY * 1.6, -hipRotZ * 1.5);
  rig.spine.scale.set(1 + breathe * 0.008, 1 + breathe * 0.012, 1 + breathe * 0.012);
  set(rig.neck, -lean * 0.4 + pose.headX * 0.4, pose.headY * 0.4 + hipRotY * 0.8, 0);
  set(rig.head, pose.headX * 0.6 - lean * 0.2, pose.headY * 0.6, idle * Math.sin(time * 0.6) * 0.05);
  set(L.hip, pose.lHip, 0, pose.lHipZ);
  set(R.hip, pose.rHip, 0, pose.rHipZ);
  set(L.knee, pose.lKnee, 0, 0);
  set(R.knee, pose.rKnee, 0, 0);
  set(L.ankle, pose.lAnkle, 0, 0);
  set(R.ankle, pose.rAnkle, 0, 0);
  set(AL.shoulder, pose.lSh, 0, pose.lShZ);
  set(AR.shoulder, pose.rSh, 0, pose.rShZ);
  set(AL.elbow, pose.lElbow, 0, 0);
  set(AR.elbow, pose.rElbow, 0, 0);

  // Skirt petals: flare with speed and in the air, kicked out by the leg behind them.
  const flare = 0.22 + move * 0.15 + run * 0.15 + air * 0.35;
  for (let i = 0; i < rig.petals.length; i++) {
    const a = (i / rig.petals.length) * Math.PI * 2;
    const front = -Math.cos(a); // 1 at the front of the skirt
    const sideL = Math.max(0, -Math.sin(a));
    const sideR = Math.max(0, Math.sin(a));
    const kick =
      (pose.lHip * sideL + pose.rHip * sideR) * front * 0.6 +
      Math.max(0, front) * Math.max(0, pose.lHip, pose.rHip) * 0.5;
    const flutter = Math.sin(time * 9 + i * 1.7) * 0.06 * (move + air);
    const sitting = s.riding ? 0.55 : 0;
    const p = rig.petals[i];
    // Trailing petals lift behind her as she moves.
    const trail = Math.max(0, -front) * move * (0.15 + run * 0.25);
    p.rotation.x = -(flare + Math.max(0, kick) + flutter + trail + sitting * (front > 0 ? 1.2 : 0.4));
  }

  // Hair: lags behind, swings with the stride, lifts with speed and when falling.
  const stream = Math.min(1, A.speed / 7) * (s.riding ? 1 : 1);
  const fall = THREE.MathUtils.clamp(-s.vy / 8, 0, 1) * air;
  for (let i = 0; i < rig.hair.length; i++) {
    const h = rig.hair[i];
    // At rest the hair drapes back off the shoulders, then falls (so it hangs clear of the
    // belt and skirt); moving, it streams out behind.
    const drape = i === 0 ? -0.17 : 0.06;
    const target =
      drape -
      (stream * (0.35 + i * 0.12) + fall * 0.4) -
      lean * (i === 0 ? 1 : 0) +
      Math.sin(time * 1.3 - i * 0.6) * 0.04;
    const sway = Math.sin(p - i * 0.7) * 0.08 * move + Math.sin(time * 0.9 - i) * 0.03;
    h.rotation.x += (target - h.rotation.x) * Math.min(1, dt * Math.max(2.5, 8 - i * 1.5));
    h.rotation.z += (sway - h.rotation.z) * Math.min(1, dt * 6);
  }
  for (const [i, l] of rig.locks.entries()) {
    const side = i ? 1 : -1;
    l.rotation.x +=
      (-stream * 0.5 +
        Math.sin(time * 1.1 + i) * 0.05 -
        (rig.head.rotation.x + rig.neck.rotation.x) * 0.8 -
        l.rotation.x) *
      Math.min(1, dt * 6);
    l.rotation.z = side * (0.05 + Math.abs(Math.sin(p)) * 0.08 * move);
  }

  // Cape billows out behind her with speed and when falling.
  if (rig.cape) {
    const target = -(stream * 0.75 + fall * 0.5) - lean * 0.9 + Math.sin(time * 1.4) * 0.02 - (s.riding ? 0.25 : 0);
    rig.cape.rotation.x += (target - rig.cape.rotation.x) * Math.min(1, dt * 5);
    rig.cape.rotation.z = Math.sin(p) * 0.06 * move;
  }
  // Wings: a slow, idle shimmer, a quick flutter on the move, and a fast beat in the air.
  for (const w of rig.wings) {
    const side = w.userData.side as number;
    const rate = lerp(lerp(2.2, 9, move), 18, air);
    const amp = lerp(lerp(0.12, 0.2, move), 0.45, air);
    w.rotation.y = -side * (0.35 + Math.sin(time * rate) * amp); // sweep back from the shoulders
  }

  // Blink every few seconds.
  A.blinkT -= dt;
  let eyeOpen = 1;
  if (A.blinkT < 0.12) eyeOpen = Math.abs(A.blinkT - 0.06) / 0.06;
  if (A.blinkT < 0) A.blinkT = 2.5 + Math.random() * 3.5;
  rig.eyes.scale.y = Math.max(0.1, eyeOpen);
  rig.eyes.position.y = (1 - eyeOpen) * 0.004;

  // The glow pulses gently (and stays on the ground, so it's hidden while riding).
  rig.glow.visible = !s.riding;
  (rig.glow.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(time * 2) * 0.05;
}
