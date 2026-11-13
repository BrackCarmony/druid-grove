import * as THREE from 'three';
import type { MountId } from './economy';

// Low-poly mount models with a simple walk cycle.

export interface MountModel {
  root: THREE.Group;
  legs: THREE.Object3D[];
  head: THREE.Object3D;
  seatY: number;
}

const lam = (color: number, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });

function leg(mat: THREE.Material, len: number, r: number) {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, len, 6), mat);
  m.position.y = -len / 2;
  pivot.add(m);
  return pivot;
}

function tortoise(): MountModel {
  const root = new THREE.Group();
  const skin = lam(0x8d9a5b);
  const shellMat = lam(0x4f6b34);
  const mossMat = lam(0x76b24c);

  const shell = new THREE.Mesh(new THREE.SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
  shell.scale.set(1, 0.75, 1.25);
  shell.position.y = 0.55;
  root.add(shell);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.0, 0.18, 12), lam(0x3b5228));
  rim.scale.z = 1.25;
  rim.position.y = 0.55;
  root.add(rim);
  // moss tufts and a few flowers on the shell
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 0.45 + (i % 3) * 0.15;
    const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), mossMat);
    tuft.position.set(Math.cos(a) * r, 1.1 - r * 0.35, Math.sin(a) * r * 1.2);
    tuft.scale.y = 0.5;
    root.add(tuft);
  }
  for (let i = 0; i < 4; i++) {
    const fl = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.08, 0),
      lam([0xff9ec4, 0xfff27a, 0xc3b5ff, 0xffffff][i], 0x222222),
    );
    fl.position.set(Math.cos(i * 1.7) * 0.5, 1.18, Math.sin(i * 1.7) * 0.55);
    root.add(fl);
  }

  const head = new THREE.Group();
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 7), skin);
  neck.rotation.x = Math.PI / 2 - 0.4;
  neck.position.set(0, 0.0, 0.2);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), skin);
  skull.scale.set(1, 0.85, 1.2);
  skull.position.set(0, 0.15, 0.48);
  const eyeMat = lam(0x1a1a1a);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), eyeMat);
    eye.position.set(s * 0.17, 0.24, 0.62);
    head.add(eye);
  }
  head.add(neck, skull);
  head.position.set(0, 0.55, 1.2);
  root.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-0.75, 0.7],
    [0.75, 0.7],
    [-0.75, -0.7],
    [0.75, -0.7],
  ]) {
    const l = leg(skin, 0.6, 0.18);
    l.position.set(x, 0.6, z);
    root.add(l);
    legs.push(l);
  }
  return { root, legs, head, seatY: 1.2 };
}

function stag(): MountModel {
  const root = new THREE.Group();
  const coat = lam(0x9a6a43);
  const pale = lam(0xe8d4b8);
  const antlerMat = lam(0x6b4a33);
  const leafMat = lam(0x7cc451);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.3, 4, 10), coat);
  body.rotation.x = Math.PI / 2;
  body.position.y = 1.35;
  root.add(body);
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 8), pale);
  belly.rotation.x = Math.PI / 2;
  belly.position.y = 1.2;
  root.add(belly);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), pale);
  tail.position.set(0, 1.5, -1.05);
  root.add(tail);

  const head = new THREE.Group();
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.9, 7), coat);
  neck.position.set(0, 0.35, 0.1);
  neck.rotation.x = 0.5;
  const skull = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.35, 4, 8), coat);
  skull.rotation.x = Math.PI / 2 - 0.3;
  skull.position.set(0, 0.8, 0.42);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), lam(0x2a1a14));
  nose.position.set(0, 0.7, 0.72);
  head.add(neck, skull, nose);
  // Antlers: branching tines with leaves
  for (const s of [-1, 1]) {
    const base = new THREE.Group();
    base.position.set(s * 0.12, 0.98, 0.32);
    base.rotation.z = -s * 0.5;
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5), antlerMat);
    main.position.y = 0.45;
    base.add(main);
    for (let k = 0; k < 3; k++) {
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.45, 5), antlerMat);
      tine.position.set(0, 0.3 + k * 0.22, 0);
      tine.rotation.set(0.6, 0, -s * (0.5 + k * 0.2));
      tine.translateY(0.2);
      base.add(tine);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 3), leafMat);
      leaf.scale.set(0.5, 0.25, 1);
      leaf.position.copy(tine.position).add(new THREE.Vector3(-s * 0.15, 0.15, 0.1));
      base.add(leaf);
    }
    head.add(base);
  }
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), lam(0x111111));
    eye.position.set(s * 0.14, 0.86, 0.52);
    head.add(eye);
  }
  head.position.set(0, 1.5, 0.95);
  root.add(head);

  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-0.25, 0.75],
    [0.25, 0.75],
    [-0.25, -0.75],
    [0.25, -0.75],
  ]) {
    const l = leg(coat, 1.15, 0.08);
    l.position.set(x, 1.15, z);
    root.add(l);
    legs.push(l);
  }
  return { root, legs, head, seatY: 1.75 };
}

export function buildMount(id: MountId): MountModel {
  return id === 'tortoise' ? tortoise() : stag();
}

export function animateMount(m: MountModel, phase: number, moving: number, time: number) {
  const amp = Math.min(1, moving / 3) * 0.55;
  m.legs.forEach((l, i) => {
    const off = i === 0 || i === 3 ? 0 : Math.PI;
    l.rotation.x = Math.sin(phase * 2 + off) * amp;
  });
  m.head.rotation.x = Math.sin(time * 1.3) * 0.05 + Math.sin(phase * 4) * 0.04 * amp;
}
