import * as THREE from 'three';
import { Colliders } from './colliders';
import { wdist, World } from './world';

// Waystones: standing-stone arches you can step through to any other waystone.
// There's one at home; the rest the player builds out across the planet.

const RANGE = 3.5;
const SPACING = 30;

const lam = (color: number, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });

export interface Waystone {
  x: number;
  z: number;
  obj: THREE.Group;
  label: string;
  home: boolean;
}

function stoneModel() {
  const g = new THREE.Group();
  const rock = lam(0x8b8794);
  const moss = lam(0x6aa83f);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.2, 0.7), rock);
    post.position.set(s * 1.2, 1.6, 0);
    post.rotation.z = s * 0.04;
    g.add(post);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.25, 0.75), moss);
    cap.position.set(s * 1.2, 3.25, 0);
    g.add(cap);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.55, 0.8), rock);
  lintel.position.y = 3.45;
  g.add(lintel);
  const portal = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 3.0),
    new THREE.MeshBasicMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  portal.position.y = 1.55;
  portal.name = 'portal';
  g.add(portal);
  const rune = new THREE.Mesh(new THREE.CircleGeometry(0.22, 6), lam(0x8fe8ff, 0x3aa8c8));
  rune.position.set(0, 3.45, 0.41);
  g.add(rune);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.7, 26, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 13;
  g.add(beam);
  return g;
}

export class Waystones {
  group = new THREE.Group();
  stones: Waystone[] = [];

  constructor(
    private world: World,
    private colliders: Colliders,
  ) {
    this.build(0, -10, 'Waystone · home');
  }

  get home() {
    return this.stones[0];
  }

  build(x: number, z: number, label?: string): Waystone {
    const obj = stoneModel();
    obj.position.set(x, this.world.heightAt(x, z), z);
    this.group.add(obj);
    this.colliders.add(x - 1.2, z, 0.5);
    this.colliders.add(x + 1.2, z, 0.5);
    const glade = this.world.glades[this.world.gladeOf[this.world.tileAt(x, z)]];
    const stone: Waystone = { x, z, obj, label: label ?? `Waystone · ${glade.name}`, home: !this.stones.length };
    this.stones.push(stone);
    return stone;
  }

  canBuildAt(x: number, z: number): string | null {
    for (const s of this.stones) {
      if (wdist(s.x, s.z, x, z) < SPACING) return `Too close to ${s.home ? 'the home waystone' : s.label}`;
    }
    return null;
  }

  nearby(pos: THREE.Vector3): Waystone | null {
    for (const s of this.stones) if (wdist(s.x, s.z, pos.x, pos.z) < RANGE) return s;
    return null;
  }

  /** Where to put someone arriving at a stone: just in front of the arch. */
  arrival(s: Waystone): [number, number] {
    return [s.x, s.z + 2.6];
  }

  update(time: number) {
    for (const s of this.stones) {
      const p = s.obj.getObjectByName('portal') as THREE.Mesh;
      (p.material as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(time * 2 + s.x) * 0.08;
    }
  }
}
