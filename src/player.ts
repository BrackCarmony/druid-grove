import * as THREE from 'three';
import { Colliders } from './colliders';
import type { MountDef, MountId, ToolId } from './economy';
import { animateMount, buildMount, MountModel } from './mounts';
import { World, wrap } from './world';

// The nymph: movement, mouse-look, riding, and a single continuous zoom that runs
// from first person -> over the shoulder -> a high overview of the whole world.

const EYE = 1.5;
const BODY_RADIUS = 0.3;
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 320;

export class Player {
  pos = new THREE.Vector3(0, 0, 4);
  vel = new THREE.Vector3();
  yaw = Math.PI; // facing -z
  pitch = -0.35;
  zoom = 0;
  zoomTarget = 0;
  onGround = true;
  keys = new Set<string>();
  model: THREE.Group;
  viewmodel: THREE.Group;
  mount: MountDef | null = null;
  private nymph: THREE.Group;
  private mountHolder = new THREE.Group();
  private mountModels = new Map<MountId, MountModel>();
  private toolModels: Record<ToolId, THREE.Object3D>;
  private walkPhase = 0;
  workAnim = 0;

  constructor(
    private world: World,
    private camera: THREE.PerspectiveCamera,
    private colliders: Colliders,
  ) {
    this.pos.y = world.heightAt(this.pos.x, this.pos.z);
    this.model = new THREE.Group();
    this.nymph = buildNymph();
    this.model.add(this.nymph, this.mountHolder);
    this.mountHolder.rotation.y = Math.PI; // mount models face +z
    const vm = buildViewmodels();
    this.viewmodel = vm.group;
    this.toolModels = vm.tools;
    camera.add(this.viewmodel);

    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.2);
  }

  scroll(dy: number) {
    // Exponential-feeling zoom so small scrolls near the nymph are fine-grained.
    const z = this.zoomTarget;
    const step = Math.max(0.6, z * 0.18) * Math.sign(dy);
    this.zoomTarget = THREE.MathUtils.clamp(z + step, ZOOM_MIN, ZOOM_MAX);
    if (this.zoomTarget < 0.8 && dy < 0) this.zoomTarget = 0;
  }

  get firstPerson() {
    return this.zoom < 0.5;
  }

  setTool(id: ToolId) {
    for (const [k, m] of Object.entries(this.toolModels)) m.visible = k === id;
  }

  ride(def: MountDef | null) {
    this.mount = def;
    for (const m of this.mountModels.values()) m.root.visible = false;
    if (def) {
      let m = this.mountModels.get(def.id);
      if (!m) {
        m = buildMount(def.id);
        this.mountModels.set(def.id, m);
        this.mountHolder.add(m.root);
      }
      m.root.visible = true;
      this.nymph.position.y = m.seatY;
    } else {
      this.nymph.position.y = 0;
    }
  }

  update(dt: number, time: number) {
    const mount = this.mount;
    // --- movement ---
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (this.keys.has('KeyW')) wish.add(fwd);
    if (this.keys.has('KeyS')) wish.sub(fwd);
    if (this.keys.has('KeyD')) wish.add(right);
    if (this.keys.has('KeyA')) wish.sub(right);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let speed = mount ? (running ? mount.runSpeed : mount.speed) : running ? 7.5 : 4.2;
    // Move faster when zoomed out so the overview isn't a slog.
    speed *= 1 + Math.min(this.zoom, 60) / 30;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const accel = this.onGround ? (mount ? 6 : 14) : 4;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);
    if (this.onGround && this.keys.has('Space')) {
      this.vel.y = mount ? (mount.id === 'stag' ? 7 : 2.5) : 5.2;
      this.onGround = false;
    }
    this.vel.y -= 14 * dt;
    const before = this.pos.clone();
    this.pos.addScaledVector(this.vel, dt);
    this.colliders.resolve(this.pos, mount ? mount.bodyRadius : BODY_RADIUS);
    // Velocity reflects what actually happened, so sliding along rocks feels right.
    // (Capped at the pre-collision speed so being pushed out of something never flings you.)
    if (dt > 0) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      let vx = (this.pos.x - before.x) / dt;
      let vz = (this.pos.z - before.z) / dt;
      const ns = Math.hypot(vx, vz);
      if (ns > sp && ns > 0) {
        vx *= sp / ns;
        vz *= sp / ns;
      }
      this.vel.x = vx;
      this.vel.z = vz;
    }
    // The planet wraps: walking off one side brings you in from the other.
    this.pos.x = wrap(this.pos.x);
    this.pos.z = wrap(this.pos.z);
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    }

    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += moving * dt * (mount ? 1.1 : 2.2);

    // --- camera ---
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 8);
    const eye = mount ? mount.eye : EYE;
    const head = new THREE.Vector3(this.pos.x, this.pos.y + eye, this.pos.z);
    const bob = this.onGround ? Math.sin(this.walkPhase * 2) * (mount ? 0.06 : 0.04) * Math.min(1, moving / 4) : 0;

    // When zoomed far out, ease the camera into looking down at the land.
    const overview = THREE.MathUtils.smoothstep(this.zoom, 10, 60);
    const pitch = THREE.MathUtils.lerp(this.pitch, Math.min(this.pitch, -0.9), overview);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(this.yaw) * Math.cos(pitch),
    );

    if (this.firstPerson) {
      this.camera.position.copy(head).y += bob;
      if (mount) this.camera.position.addScaledVector(fwd, 0.5);
    } else {
      const shoulder = right.clone().multiplyScalar(0.55 * (1 - overview));
      const target = head.clone().add(shoulder);
      const dist = this.zoom + (mount ? 2 : 0);
      this.camera.position.copy(target).addScaledVector(dir, -dist);
      const minY = this.world.heightAt(this.camera.position.x, this.camera.position.z) + 0.4;
      if (this.camera.position.y < minY) this.camera.position.y = minY;
    }
    this.camera.lookAt(this.camera.position.clone().add(dir));

    // --- models ---
    this.model.visible = !this.firstPerson || !!mount;
    this.nymph.visible = !this.firstPerson;
    this.model.position.copy(this.pos);
    if (moving > 0.3) {
      const targetYaw = Math.atan2(-this.vel.x, -this.vel.z);
      let d = targetYaw - this.model.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.model.rotation.y += d * Math.min(1, dt * (mount ? 5 : 10));
    }
    if (mount) {
      const m = this.mountModels.get(mount.id)!;
      animateMount(m, this.walkPhase, moving, time);
      this.nymph.children[0].position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.05;
      // In first person on a mount, only show the head/antlers ahead of you.
      m.root.visible = true;
    } else {
      const hop = Math.abs(Math.sin(this.walkPhase * 2)) * 0.08 * Math.min(1, moving / 4);
      this.nymph.children[0].position.y = hop + Math.sin(time * 2) * 0.02;
    }

    // --- first-person tool ---
    this.viewmodel.visible = this.firstPerson && !mount;
    this.workAnim = Math.max(0, this.workAnim - dt * 3);
    const w = Math.sin(this.workAnim * Math.PI * 4) * 0.05 * this.workAnim;
    this.viewmodel.position.set(0.32, -0.3 + bob * 0.5 + w, -0.55);
    this.viewmodel.rotation.x = -w * 3;
  }
}

function lambert(color: number, emissive = 0x000000) {
  return new THREE.MeshLambertMaterial({ color, emissive });
}

function buildNymph(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = lambert(0xb9e0a5, 0x1a2a10);
  const dress = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.9, 7), lambert(0x3f8a4a));
  dress.position.y = 0.45;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.4, 7), lambert(0x4fa05a));
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 1), skin);
  head.position.y = 1.42;
  body.add(dress, torso, head);

  // Leafy hair crown
  const leafMat = lambert(0x7cc451);
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 3), leafMat);
    leaf.scale.set(0.6, 0.25, 1.4);
    const a = (i / 9) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.17, 1.52 + (i % 2) * 0.05, Math.sin(a) * 0.17);
    leaf.lookAt(leaf.position.x * 3, 2.2, leaf.position.z * 3);
    body.add(leaf);
  }
  const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), lambert(0xff9ec4, 0x552233));
  bloom.position.set(0.14, 1.58, 0.08);
  body.add(bloom);

  // Arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.45, 5), skin);
    arm.position.set(side * 0.2, 1.0, 0);
    arm.rotation.z = side * 0.25;
    body.add(arm);
  }
  // Soft glow at the nymph's feet so she reads from far away.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 20),
    new THREE.MeshBasicMaterial({ color: 0xc6ff9e, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  root.add(glow);
  return root;
}

function buildViewmodels() {
  const group = new THREE.Group();
  const metal = lambert(0xc9ccd6);
  const wood = lambert(0x8a5a33);

  const tweezers = new THREE.Group();
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.28), metal);
    arm.position.set(s * 0.012, 0, -0.12);
    arm.rotation.y = -s * 0.04;
    tweezers.add(arm);
  }
  const seed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), lambert(0x6b4a2b));
  seed.position.set(0, 0, -0.26);
  tweezers.add(seed);
  tweezers.rotation.set(-0.5, 0.25, 0);

  const glove = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.16), lambert(0x6fae55));
  glove.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.08, 2, 6), lambert(0x6fae55));
    f.rotation.x = Math.PI / 2 + 0.3;
    f.position.set(-0.05 + i * 0.033, -0.01, -0.12);
    glove.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.06, 2, 6), lambert(0x6fae55));
  thumb.position.set(-0.09, 0, -0.03);
  thumb.rotation.z = 1;
  glove.add(thumb);
  glove.rotation.set(-0.6, 0.2, 0);

  const rake = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6), wood);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -0.5;
  rake.add(handle);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.03), metal);
  bar.position.z = -1.1;
  rake.add(bar);
  for (let i = 0; i < 9; i++) {
    const tine = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), metal);
    tine.position.set(-0.18 + i * 0.045, -0.06, -1.1);
    rake.add(tine);
  }
  rake.rotation.set(-0.45, 0.15, 0);
  rake.position.set(-0.1, 0, 0.2);

  group.add(tweezers, glove, rake);
  // Viewmodel draws on top of the world.
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.renderOrder = 10;
      (o.material as THREE.Material).depthTest = false;
    }
  });
  return { group, tools: { tweezers, glove, rake } as Record<ToolId, THREE.Object3D> };
}
