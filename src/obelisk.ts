import * as THREE from 'three';
import { Colliders } from './colliders';
import { grassTufts, mossMaterial } from './moss';
import { lam } from './rig';
import { stoneMaterials } from './waystones';
import { scaleUV } from './wood';
import { wdist, World } from './world';

// The Verdant Obelisk: a tall old standing stone near home where the nymph trades pollen and
// honey for tools, mounts and upgrades (the shop). Press E beside it.

export const OBELISK_X = 0;
export const OBELISK_Z = 19; // flat, dry ground in the starting glade, clear of the creek
const RANGE = 5;
const H = 7.5; // shaft height above its plinth
const BURY = 3;

/** A four-sided shaft tapering to `top` across, with a pyramid tip. */
function shaftGeometry(base: number, top: number, h: number) {
  const g = new THREE.CylinderGeometry(top / Math.SQRT2, base / Math.SQRT2, h, 4, 6);
  g.rotateY(Math.PI / 4);
  // Roughen it a little (the same nudge for every copy of a corner).
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = (a: number) => Math.sin(x * 9.1 + y * 5.3 + z * 7.7 + a) * 0.035;
    p.setXYZ(i, x + n(1), y + n(2) * 0.5, z + n(3));
  }
  g.computeVertexNormals();
  return scaleUV(g, 1.2, 3.5);
}

export class Obelisk {
  readonly x = OBELISK_X;
  readonly z = OBELISK_Z;
  group = new THREE.Group();
  private capstone: THREE.Mesh;
  private gemMat: THREE.MeshLambertMaterial;

  constructor(world: World, colliders: Colliders) {
    const M = stoneMaterials();
    const g = this.group;
    // On the lowest ground under it, with the plinth running deep for higher ground.
    let base = Infinity;
    for (const dx of [-1.6, 0, 1.6])
      for (const dz of [-1.6, 0, 1.6]) base = Math.min(base, world.heightAt(this.x + dx, this.z + dz));
    g.position.set(this.x, base, this.z);

    // Stepped plinth.
    const step = (w: number, h: number, y: number) => {
      const m = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(w, h, w, 2, 1, 2), w / 2.5, h / 2.5), M.stone);
      m.position.y = y;
      g.add(m);
    };
    step(3.6, 0.5 + BURY, 0.25 - BURY / 2);
    step(2.8, 0.45, 0.7);
    // The shaft and its pyramid tip.
    const shaft = new THREE.Mesh(shaftGeometry(1.7, 1.05, H), M.stone);
    shaft.position.y = 0.92 + H / 2;
    g.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.05 / Math.SQRT2 + 0.02, 1.1, 4).rotateY(Math.PI / 4), M.stone);
    tip.position.y = 0.92 + H + 0.55;
    g.add(tip);

    // A glowing green crystal floating just above the tip, slowly turning.
    this.gemMat = lam(0x9cf07a, 0x3c9a22);
    this.capstone = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), this.gemMat);
    this.capstone.scale.set(1, 1.6, 1);
    this.capstone.position.y = 0.92 + H + 1.75;
    g.add(this.capstone);

    // Rune columns glowing down all four faces.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.34, H * 0.78), M.rune);
      // The faces lean in as the shaft tapers: sit the strip on the face, tilted to match.
      const lean = Math.atan((1.7 - 1.05) / 2 / H);
      const r = (1.7 + 1.05) / 4 + 0.07;
      strip.position.set(Math.sin(a) * r, 0.92 + H * 0.5, Math.cos(a) * r);
      strip.rotation.set(-lean, a, 0, 'YXZ');
      g.add(strip);
    }

    // Moss round the foot of the shaft, and grass in the corners of the plinth.
    const moss = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.5, 12, 1, true), mossMaterial(3, 0.4));
    moss.position.y = 1.15;
    g.add(moss);
    const tufts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (const [x, z] of [
      [1.25, 1.2],
      [-1.2, 1.25],
      [1.2, -1.25],
      [-1.25, -1.2],
      [0.3, 1.3],
      [-1.3, -0.2],
    ])
      tufts.push({ p: new THREE.Vector3(x, 0.93, z), n: new THREE.Vector3(0, 1, 0) });
    g.add(grassTufts(tufts, 21, 1.1));

    // A beacon so it can be found from afar, like the other places to visit.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.8, 26, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xb8f59a,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 13 + H;
    g.add(beam);

    colliders.add(this.x, this.z, 1.7);
  }

  nearby(pos: THREE.Vector3) {
    return wdist(this.x, this.z, pos.x, pos.z) < RANGE;
  }

  update(time: number) {
    this.capstone.rotation.y = time * 0.6;
    this.capstone.position.y = 0.92 + H + 1.75 + Math.sin(time * 1.2) * 0.12;
    this.gemMat.emissiveIntensity = 0.9 + Math.sin(time * 1.3) * 0.25;
  }
}
