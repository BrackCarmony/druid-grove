import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared helpers for the jointed, procedurally animated characters (the nymph and her mounts).
// Build each character from joints (empty groups that animate) holding small meshes, then
// bake() merges each joint's meshes per material so a character costs a few dozen draws.

export const lam = (color: number, emissive = 0, side: THREE.Side = THREE.FrontSide) =>
  new THREE.MeshLambertMaterial({ color, emissive, side });

/** A leaf blade from its stem at the origin to its tip at +y, edges curling toward +z. */
export function leafGeo(w: number, l: number, cup = 0.35) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(w * 0.62, l * 0.18, w * 0.55, l * 0.72, 0, l);
  s.bezierCurveTo(-w * 0.55, l * 0.72, -w * 0.62, l * 0.18, 0, 0);
  const g = new THREE.ShapeGeometry(s, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / w;
    const y = p.getY(i) / l;
    // Cup across the blade, and a gentle backward arch along it.
    p.setZ(i, x * x * w * cup * 2 + Math.sin(y * Math.PI) * l * 0.06);
  }
  g.computeVertexNormals();
  return g;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) {
  const m = new THREE.Mesh(geo, mat);
  parent.add(m);
  return m;
}

/** A pivot joint: an empty group whose meshes get baked together later. */
export function joint(parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  j.userData.joint = true;
  parent.add(j);
  return j;
}

/** A capsule hanging from its top end down -y. */
export function limb(r1: number, r2: number, len: number) {
  const g = new THREE.CylinderGeometry(r1, r2, len, 8, 1);
  g.translate(0, -len / 2, 0);
  const top = new THREE.SphereGeometry(r1, 8, 5);
  const bot = new THREE.SphereGeometry(r2, 8, 5);
  bot.translate(0, -len, 0);
  return merge([g, top, bot]);
}

export function plain(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
}
export function merge(geos: THREE.BufferGeometry[]) {
  return mergeGeometries(geos.map(plain))!;
}

/** Merge each joint's own meshes (not those under child joints) into one mesh per material. */
export function bake(root: THREE.Object3D) {
  const joints: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root || o.userData.joint) joints.push(o);
  });
  for (const j of joints) {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const owned: THREE.Mesh[] = [];
    const collect = (o: THREE.Object3D, m: THREE.Matrix4) => {
      for (const c of o.children) {
        if (c.userData.joint || c.userData.keep) continue;
        c.updateMatrix();
        const cm = m.clone().multiply(c.matrix);
        if (c instanceof THREE.Mesh) {
          const g = plain(c.geometry.clone()).applyMatrix4(cm);
          const list = byMat.get(c.material as THREE.Material) ?? [];
          list.push(g);
          byMat.set(c.material as THREE.Material, list);
          owned.push(c);
        }
        collect(c, cm);
      }
    };
    collect(j, new THREE.Matrix4());
    if (!owned.length) continue;
    for (const c of [...j.children]) if (!c.userData.joint && !c.userData.keep) j.remove(c);
    for (const [mat, geos] of byMat) j.add(new THREE.Mesh(mergeGeometries(geos)!, mat));
  }
}
