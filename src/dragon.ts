import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { grassTufts } from './moss';
import { bake, joint, lam, leafGeo, mesh } from './rig';
import { barkMaterial } from './wood';

// The ancient green dragon who sleeps under the grey world and wakes when it is green again.
// About 20 m nose to tail, built from joints like the nymph and her mounts and posed
// procedurally: asleep (curled up, mossed over), awake (standing, roaring, wings open) and
// flying. Faces +z.

export interface DragonPose {
  sleep: number; // 1 curled up asleep .. 0 standing
  eyes: number; // 0 shut .. 1 open
  roar: number; // head up, jaw open
  spread: number; // wings 0 folded .. 1 open
  flap: number; // wingbeat strength
  fly: number; // 0 on the ground .. 1 flight pose (legs tucked, neck and tail streaming)
}

let scaleTex: THREE.CanvasTexture | null = null;

/** Overlapping scales, light grey so the material colour tints them. */
function scaleTexture() {
  if (scaleTex) return scaleTex;
  const W = 128;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, W, H);
  const r = 12;
  for (let row = -1; row < H / (r * 0.8) + 1; row++) {
    const y = row * r * 0.8;
    const off = row % 2 ? r : 0;
    for (let x = -r; x < W + r; x += r * 2) {
      const cx = x + off;
      for (const ox of [-W, 0, W]) {
        const grd = g.createRadialGradient(cx + ox, y - r * 0.2, 1, cx + ox, y, r);
        grd.addColorStop(0, '#f2f2f2');
        grd.addColorStop(0.75, '#bdbdbd');
        grd.addColorStop(1, '#6e6e6e');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(cx + ox, y, r, 0, Math.PI);
        g.fill();
      }
    }
  }
  scaleTex = new THREE.CanvasTexture(c);
  scaleTex.colorSpace = THREE.SRGBColorSpace;
  scaleTex.wrapS = scaleTex.wrapT = THREE.RepeatWrapping;
  scaleTex.repeat.set(6, 3);
  return scaleTex;
}

/** An ellipsoid centred `along` the chain's direction (+z, or -z for the tail). */
function lobe(rx: number, ry: number, rz: number, z = 0, y = 0) {
  return new THREE.SphereGeometry(1, 16, 10).scale(rx, ry, rz).translate(0, y, z);
}

/** A tapering round bone from a to b. */
function bone(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, segs = 6) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(r1, r0, len, segs).translate(0, len / 2, 0);
  geo.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
  );
  return geo.translate(a.x, a.y, a.z);
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Leg {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  ankle: THREE.Object3D;
  front: boolean;
  side: number;
}

interface Wing {
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  wrist: THREE.Object3D;
  tips: THREE.Object3D[];
  flank: THREE.Object3D;
  skin: THREE.Mesh;
  side: number;
}

// Membrane triangles: two per gap between the four fingers (scalloped), two for the trailing
// edge from the last finger to the flank (scalloped), and the inner panel back to the body.
const WING_TRIS = 3 * 2 + 2 + 3;

export class Dragon {
  root = new THREE.Group();
  private body: THREE.Object3D;
  private neck: THREE.Object3D[] = [];
  private head: THREE.Object3D;
  private jaw: THREE.Object3D;
  private lids: THREE.Object3D[] = [];
  private tail: THREE.Object3D[] = [];
  private legs: Leg[] = [];
  private wings: Wing[] = [];
  private eyeMat: THREE.MeshLambertMaterial;
  private t = 0;

  constructor() {
    const scales = new THREE.MeshLambertMaterial({ color: 0x5fae62, map: scaleTexture() });
    const dark = new THREE.MeshLambertMaterial({ color: 0x45884a, map: scaleTexture() });
    const belly = lam(0xb8cf7a);
    const spine = lam(0x8fd06a, 0x2a4a18, THREE.DoubleSide);
    const membrane = lam(0x86c86a, 0x2c5a1e, THREE.DoubleSide);
    const horn = barkMaterial(0x6b4a33);
    const claw = lam(0xe8dcc0);
    const leafMat = lam(0x5fae4a, 0, THREE.DoubleSide);
    this.eyeMat = lam(0xe8ff7a, 0x9acc20);
    const mouth = lam(0x5a1e22);

    const body = (this.body = joint(this.root, 0, 4.4, 0));
    mesh(lobe(2.2, 1.95, 3.8, 0.3), scales, body);
    mesh(lobe(1.85, 1.45, 3.4, 0.3, -0.55), belly, body);
    mesh(lobe(2.0, 1.85, 1.9, 2.5, 0.15), scales, body);
    const leaf = leafGeo(0.9, 1.5, 0.25);

    // Back plates: big leaf-shaped spines down the middle.
    const plates = (parent: THREE.Object3D, z: number, y: number, size: number, dir: number) => {
      const p = mesh(leaf, spine, parent);
      p.position.set(0, y, z);
      p.rotation.set(-0.35 * dir, 0, 0);
      p.scale.setScalar(size);
    };
    for (let i = 0; i < 4; i++) plates(body, 2 - i * 1.4, 1.5 - Math.abs(i - 1.5) * 0.08, 1.15, 1);

    // Moss, grass and flowers grown over its back while it slept.
    const tufts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let i = 0; i < 22; i++) {
      const a = (i * 2.39996) % (Math.PI * 2);
      const z = -2.6 + ((i * 0.618) % 1) * 5.2;
      const x = Math.cos(a) * 1.3;
      const n = v3(x / 1.9, 1, 0).normalize();
      tufts.push({
        p: v3(x, Math.sqrt(Math.max(0.1, 1 - (x / 1.9) ** 2 - ((z - 0.3) / 3.4) ** 2)) * 1.7 - 0.05, z),
        n,
      });
    }
    const grass = grassTufts(tufts, 13, 1.6);
    grass.userData.keep = true;
    body.add(grass);

    // Neck: five segments curving up from the chest.
    let parent: THREE.Object3D = body;
    let at = v3(0, 0.6, 3.1);
    for (let i = 0; i < 5; i++) {
      const r = 1.15 - i * 0.1;
      const j = joint(parent, at.x, at.y, at.z);
      mesh(lobe(r, r * 0.95, 1.2, 0.6), i % 2 ? scales : dark, j);
      mesh(lobe(r * 0.75, r * 0.6, 1.1, 0.6, -r * 0.4), belly, j);
      plates(j, 0.5, r * 0.85, 0.75 - i * 0.06, 1);
      this.neck.push(j);
      parent = j;
      at = v3(0, 0, 1.25);
    }

    // Head.
    const head = (this.head = joint(parent, 0, 0, 1.2));
    head.scale.setScalar(1.3);
    mesh(lobe(0.95, 0.8, 1.05, 0.5, 0.05), scales, head);
    mesh(lobe(0.68, 0.5, 1.1, 1.55, -0.12), scales, head); // snout
    for (const s of [-1, 1]) {
      const brow = mesh(lobe(0.35, 0.18, 0.55, 0.85, 0.5), dark, head);
      brow.position.x = s * 0.5;
      brow.rotation.y = s * 0.25;
      const nostril = mesh(new THREE.SphereGeometry(0.07, 6, 4), mouth, head);
      nostril.position.set(s * 0.2, 0.05, 2.5);
      // Eye, and a lid that rolls down over it.
      const eye = mesh(new THREE.SphereGeometry(0.2, 12, 8), this.eyeMat, head);
      eye.position.set(s * 0.62, 0.22, 0.95);
      const pupil = mesh(new THREE.SphereGeometry(0.06, 6, 4).scale(0.5, 1.6, 1), lam(0x111111), head);
      pupil.position.set(s * 0.8, 0.22, 1.05);
      const lidJ = joint(head, s * 0.62, 0.22, 0.95);
      lidJ.rotation.y = s * 1.0;
      const lid = joint(lidJ);
      mesh(new THREE.SphereGeometry(0.23, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), dark, lid);
      this.lids.push(lid);
      // Branching wooden horns sweeping back, with a few leaves.
      const hornGeo = [
        bone(v3(s * 0.45, 0.55, 0.4), v3(s * 0.8, 1.3, -0.4), 0.2, 0.13),
        bone(v3(s * 0.8, 1.3, -0.4), v3(s * 1.0, 1.9, -1.4), 0.13, 0.07),
        bone(v3(s * 0.8, 1.3, -0.4), v3(s * 1.4, 1.75, -0.2), 0.09, 0.04),
        bone(v3(s * 0.95, 1.7, -1.0), v3(s * 1.5, 2.2, -0.9), 0.07, 0.03),
      ];
      mesh(mergeGeometries(hornGeo.map((g) => g.toNonIndexed()))!, horn, head);
      for (const [x, y, z, ry] of [
        [1.4, 1.75, -0.2, 0.4],
        [1.5, 2.2, -0.9, -0.3],
        [1.0, 1.9, -1.4, 0.9],
      ]) {
        const l = mesh(leafGeo(0.25, 0.45, 0.3), leafMat, head);
        l.position.set(s * x, y, z);
        l.rotation.set(-0.3, s * ry, s * -0.8);
      }
      // Cheek frills.
      const frill = mesh(leafGeo(0.5, 0.9, 0.3), spine, head);
      frill.position.set(s * 0.75, -0.1, 0.3);
      frill.rotation.set(0.2, s * -0.6, s * -1.3);
    }
    // Teeth along the upper jaw.
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) {
        const tooth = mesh(new THREE.ConeGeometry(0.05, 0.18, 4).rotateX(Math.PI), claw, head);
        tooth.position.set(s * (0.5 - i * 0.04), -0.5, 1.0 + i * 0.27);
      }
    }
    const jaw = (this.jaw = joint(head, 0, -0.3, 0.6));
    mesh(lobe(0.58, 0.2, 1.05, 0.95, -0.15), scales, jaw);
    mesh(lobe(0.45, 0.08, 0.9, 0.95, 0.05), mouth, jaw);
    for (let i = 0; i < 5; i++) {
      for (const s of [-1, 1]) {
        const tooth = mesh(new THREE.ConeGeometry(0.045, 0.15, 4), claw, jaw);
        tooth.position.set(s * (0.42 - i * 0.04), 0.06, 0.5 + i * 0.28);
      }
    }

    // Tail: nine segments tapering to a leafy tip.
    parent = body;
    at = v3(0, 0.1, -3.3);
    for (let i = 0; i < 9; i++) {
      const r = 1.5 * (1 - i / 10.5);
      const j = joint(parent, at.x, at.y, at.z);
      mesh(lobe(r, r * 0.9, 1.3, -0.68), i % 2 ? scales : dark, j);
      if (i < 7) plates(j, -0.6, r * 0.85, 0.85 - i * 0.08, -1);
      this.tail.push(j);
      parent = j;
      at = v3(0, 0, -1.35);
    }
    for (const s of [-1, 1]) {
      const fin = mesh(leafGeo(1.0, 2.2, 0.2), spine, parent);
      fin.position.set(0, 0, -0.8);
      fin.rotation.set(-Math.PI / 2, 0, s * 0.5);
    }

    // Legs.
    for (const [front, z] of [
      [true, 2.4],
      [false, -1.9],
    ] as const) {
      for (const s of [-1, 1]) {
        const hip = joint(body, s * 1.75, -0.6, z);
        mesh(lobe(0.95, 1.25, 1.0, 0, -0.5), scales, hip);
        mesh(bone(v3(0, 0, 0), v3(0, -2.2, 0), 0.78, 0.55, 10), scales, hip);
        const knee = joint(hip, 0, -2.2, 0);
        mesh(new THREE.SphereGeometry(0.56, 10, 6), scales, knee);
        mesh(bone(v3(0, 0, 0), v3(0, -1.8, 0), 0.52, 0.4, 10), scales, knee);
        const ankle = joint(knee, 0, -1.8, 0);
        mesh(lobe(0.62, 0.32, 0.95, 0.4, -0.05), dark, ankle);
        for (const cx of [-0.36, 0, 0.36]) {
          const c = mesh(new THREE.ConeGeometry(0.11, 0.45, 5).rotateX(Math.PI / 2), claw, ankle);
          c.position.set(cx, -0.14, 1.4);
        }
        this.legs.push({ hip, knee, ankle, front, side: s });
      }
    }

    // Wings: an upper arm angling out and back, a forearm bending forward at the elbow, and a
    // wrist from which four long fingers fan back. The membrane between them is rebuilt from
    // the bones every frame (see stretchWing), so it stays attached through every bend.
    for (const s of [-1, 1]) {
      const shoulder = joint(body, s * 1.3, 1.45, 1.4);
      shoulder.rotation.order = 'YZX';
      const armLen = 3.6;
      mesh(new THREE.SphereGeometry(0.5, 8, 6), dark, shoulder);
      mesh(bone(v3(0, 0, 0), v3(s * armLen, 0, 0), 0.42, 0.3), dark, shoulder);
      const elbow = joint(shoulder, s * armLen, 0, 0);
      elbow.rotation.order = 'YZX';
      const foreLen = 4.6;
      mesh(new THREE.SphereGeometry(0.34, 8, 6), dark, elbow);
      mesh(bone(v3(0, 0, 0), v3(s * foreLen, 0, 0), 0.3, 0.2), dark, elbow);
      const wrist = joint(elbow, s * foreLen, 0, 0);
      wrist.rotation.order = 'YZX';
      mesh(new THREE.SphereGeometry(0.26, 8, 6), dark, wrist);
      // A hooked thumb claw on the leading edge.
      const thumb = mesh(new THREE.ConeGeometry(0.1, 0.6, 5), claw, wrist);
      thumb.position.set(s * 0.15, 0.1, 0.35);
      thumb.rotation.set(1.2, 0, s * -0.4);
      // Fingers, from the leading edge round to the trailing edge, each bending once partway.
      const fingerDirs = [
        [0.95, 0.25, 6.0],
        [0.8, -0.4, 6.8],
        [0.5, -0.85, 6.2],
        [0.15, -1, 5.0],
      ];
      const tips: THREE.Object3D[] = [];
      const fingers: THREE.BufferGeometry[] = [];
      for (const [dx, dz, len] of fingerDirs) {
        const d = v3(s * dx, 0, dz).normalize();
        const knuckle = d.clone().multiplyScalar(len * 0.45);
        // The outer part kinks back a little more.
        const d2 = d
          .clone()
          .applyAxisAngle(v3(0, 1, 0), s * 0.25)
          .add(v3(0, -0.05, 0))
          .normalize();
        const tip = knuckle.clone().addScaledVector(d2, len * 0.55);
        fingers.push(
          bone(v3(0, 0, 0), knuckle, 0.17, 0.11).toNonIndexed(),
          bone(knuckle, tip, 0.11, 0.04).toNonIndexed(),
        );
        const marker = new THREE.Object3D();
        marker.position.copy(tip);
        marker.userData.keep = true;
        wrist.add(marker);
        tips.push(marker);
      }
      mesh(mergeGeometries(fingers)!, dark, wrist);
      // Where the membrane's trailing edge meets the flank.
      const flank = new THREE.Object3D();
      flank.position.set(s * 1.5, 0.9, -3.0);
      flank.userData.keep = true;
      body.add(flank);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WING_TRIS * 9), 3));
      const skin = new THREE.Mesh(geo, membrane);
      skin.userData.keep = true;
      body.add(skin);
      this.wings.push({ shoulder, elbow, wrist, tips, flank, skin, side: s });
    }

    bake(this.root);
    this.root.traverse((o) => {
      o.frustumCulled = false;
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.fog = false;
      }
    });
    this.root.userData.noPlanet = true; // it flies far off; don't curve it down with the planet
    this.pose({ sleep: 1, eyes: 0, roar: 0, spread: 0, flap: 0, fly: 0 }, 0);
  }

  /** Pose for this moment; dt drives the wingbeat and breathing. */
  pose(p: DragonPose, dt: number) {
    this.t += dt;
    const t = this.t;
    const L = THREE.MathUtils.lerp;
    const stand = 1 - p.sleep;
    const breathe = Math.sin(t * (p.sleep > 0.5 ? 0.9 : 1.6)) * 0.04;

    // Body: lying low when asleep, standing, or level in flight.
    this.body.position.y = L(1.9, 4.4, stand) + breathe;
    this.body.rotation.x = L(-0.05 * stand, -0.1, p.fly);
    this.body.scale.set(1 + breathe * 0.5, 1 + breathe, 1);

    // Neck: curled round to the side asleep; arched up awake; reaching forward in flight.
    const roar = p.roar;
    this.neck.forEach((j, i) => {
      const sleepX = i === 0 ? 0.15 : 0.12;
      const awakeX = i < 2 ? -0.42 - roar * 0.15 : 0.12 + roar * 0.02;
      const flyX = i === 0 ? -0.15 : 0.03;
      j.rotation.x = L(L(sleepX, awakeX, stand), flyX, p.fly) + Math.sin(t * 1.3 - i * 0.6) * 0.03 * stand;
      j.rotation.y = L(0.32, 0, stand) + Math.sin(t * 0.7 - i * 0.5) * 0.04 * stand * (1 - p.fly);
    });
    this.head.rotation.x = L(L(0.3, 0.35, stand) - roar * 0.55, 0.15, p.fly);
    this.head.rotation.y = L(0.4, 0, stand);
    this.jaw.rotation.x = Math.max(0, roar) * 0.7 + Math.max(0, Math.sin(t * 0.9)) * 0.05 * stand;
    for (const lid of this.lids) lid.rotation.x = L(Math.PI / 2 - 0.05, -0.6, p.eyes);
    this.eyeMat.emissiveIntensity = 0.3 + p.eyes * 1.4;

    // Tail: curled round the other way asleep; swaying; streaming and undulating in flight.
    this.tail.forEach((j, i) => {
      j.rotation.y = L(-0.3, 0, stand) + Math.sin(t * 1.2 - i * 0.55) * L(0.03, 0.09, stand) * (1 - p.fly * 0.5);
      j.rotation.x = L(L(0.04, 0.06 - (i < 3 ? 0.04 : 0), stand), Math.sin(t * 3 - i * 0.7) * 0.06, p.fly);
    });

    // Legs: folded under asleep; planted standing; tucked back in flight.
    for (const leg of this.legs) {
      const [sh, sk, sa] = leg.front ? [-0.9, 1.9, -1.0] : [-1.1, 2.0, -0.9];
      const [ah, ak, aa] = leg.front ? [-0.35, 0.55, -0.2] : [0.6, -0.9, 0.3];
      const [fh, fk, fa] = leg.front ? [0.9, -1.3, 0.5] : [1.2, 0.4, 0.9];
      leg.hip.rotation.x = L(L(sh, ah, stand), fh, p.fly);
      leg.knee.rotation.x = L(L(sk, ak, stand), fk, p.fly);
      leg.ankle.rotation.x = L(L(sa, aa, stand), fa, p.fly);
      leg.hip.rotation.z = leg.side * L(0.25, 0.05, stand);
    }

    // Wings: folded along the back, spread with a bent arm, and beating (the elbow and wrist
    // following the shoulder a moment behind, so the wing ripples).
    const ph = t * 3.2;
    for (const w of this.wings) {
      const s = w.side;
      const sp = p.spread;
      const f0 = Math.sin(ph) * p.flap;
      const f1 = Math.sin(ph - 0.5) * p.flap;
      const f2 = Math.sin(ph - 1.0) * p.flap;
      w.shoulder.rotation.y = s * L(1.05, 0.4, sp);
      w.shoulder.rotation.z = s * (L(0.55, 0.32, sp) + f0 * 0.7 + roar * 0.25);
      w.shoulder.rotation.x = L(0.15, 0, sp);
      w.elbow.rotation.y = -s * L(2.75, 0.95, sp) - s * Math.max(0, -f1) * 0.25; // folds a little on the upstroke
      w.elbow.rotation.z = s * (L(-0.1, -0.12, sp) + f1 * 0.3);
      w.wrist.rotation.y = s * L(2.55, 0.5, sp) + s * Math.max(0, -f2) * 0.2;
      w.wrist.rotation.z = s * (L(-0.2, -0.1, sp) + f2 * 0.3);
    }
    this.root.updateMatrixWorld(true);
    for (const w of this.wings) this.stretchWing(w);
  }

  private wp = Array.from({ length: 8 }, () => new THREE.Vector3());

  /** Rebuild a wing's membrane between its bones, in the body's space. */
  private stretchWing(w: Wing) {
    const inv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const at = (o: THREE.Object3D, out: THREE.Vector3) => out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    const [S, E, W, T0, T1, T2, T3, B] = this.wp;
    at(w.shoulder, S);
    at(w.elbow, E);
    at(w.wrist, W);
    w.tips.forEach((tip, i) => at(tip, [T0, T1, T2, T3][i]));
    at(w.flank, B);
    const pos = w.skin.geometry.attributes.position as THREE.BufferAttribute;
    let k = 0;
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      if (w.side < 0) [b, c] = [c, b];
      pos.setXYZ(k++, a.x, a.y, a.z);
      pos.setXYZ(k++, b.x, b.y, b.z);
      pos.setXYZ(k++, c.x, c.y, c.z);
    };
    const m = new THREE.Vector3();
    // Between the fingers, the edge sags in toward the wrist.
    for (const [a, b] of [
      [T0, T1],
      [T1, T2],
      [T2, T3],
    ]) {
      m.copy(a).lerp(b, 0.5).lerp(W, 0.2);
      tri(W, m, a);
      tri(W, b, m);
    }
    // Trailing edge from the last finger back to the flank, sagging toward the elbow.
    m.copy(T3).lerp(B, 0.5).lerp(E, 0.25);
    tri(E, m, T3);
    tri(E, B, m);
    // Inner panel.
    tri(E, T3, W);
    tri(S, B, E);
    tri(S, E, W);
    pos.needsUpdate = true;
    w.skin.geometry.computeVertexNormals();
  }
}
