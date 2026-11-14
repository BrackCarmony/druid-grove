import * as THREE from 'three';
import { Dragon, DragonPose } from './dragon';
import { Chimes } from './fx';
import { MOON_DIR, restoreMoon } from './sky';

// The ending: when the planet is fully restored, the scene cuts to an ancient green dragon,
// asleep under moss nearby, waking. It thanks the nymph, takes wing and flies to the broken
// moon, which mends itself in a burst of light. Plays once when 100% is reached, and again
// from the home screen whenever the player likes.
//
// The director owns the camera while it runs (main.ts lets the nymph idle and skips input),
// and drives the dragon, the moon, the sounds and a letterboxed overlay from one timeline.

const LENGTH = 40; // seconds
const CURVE_R = 900;
const LAIR = 24; // metres from the nymph to the sleeping dragon // matches the planet curvature, so the dragon sits on the curved ground

interface Host {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  chimes: Chimes;
  /** Where the nymph stands (the dragon wakes a short way off, toward the moon). */
  playerPos: THREE.Vector3;
  groundAt(x: number, z: number): number;
  setTimeOfDay(t: number): void;
  /** Nothing built or standing within r of (x, z). */
  isClear(x: number, z: number, r: number): boolean;
  /** Move the nymph (while the screen is white). */
  teleport(x: number, z: number): void;
}

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
const lerp = THREE.MathUtils.lerp;

export class Ending {
  active = false;
  private t = 0;
  private dragon: Dragon | null = null;
  private onDone: (() => void) | null = null;
  private overlay: HTMLElement;
  private words: HTMLElement;
  private white: HTMLElement;
  private cues = new Set<string>();
  private baseFov = 70;
  // Layout, worked out when it starts.
  private dir = new THREE.Vector3(); // level, toward the moon
  private side = new THREE.Vector3();
  private home = new THREE.Vector3(); // the nymph
  private lair = new THREE.Vector3(); // where the dragon sleeps
  private faceHome = new THREE.Quaternion();
  private faceMoon = new THREE.Quaternion();
  private liftOff = new THREE.Vector3();
  private look = new THREE.Vector3();
  private v = new THREE.Vector3();
  private returnTo = new THREE.Vector3();

  /**
   * Somewhere near (x, z) with open ground for the dragon 30 m toward the moon, a clear view of
   * it from just behind the nymph, and no cliff between them. Falls back to where she stands.
   */
  private findStage(x: number, z: number) {
    const h = this.host;
    const d = this.dir;
    const ok = (sx: number, sz: number) => {
      const lx = sx + d.x * LAIR;
      const lz = sz + d.z * LAIR;
      if (!h.isClear(lx, lz, 14)) return false;
      // The sightline from behind her to the dragon.
      for (let k = -8; k <= 18; k += 4) if (!h.isClear(sx + d.x * k, sz + d.z * k, 3.5)) return false;
      // And around each place the camera stands (behind her, off to each side, beside the dragon).
      const sd = this.side;
      // and the line from each of those to the dragon.
      for (const [back, side] of [
        [4, 2.5],
        [5, -4],
        [-11, 8.2],
        [6, 2],
      ]) {
        const cx = sx - d.x * back + sd.x * side;
        const cz = sz - d.z * back + sd.z * side;
        if (!h.isClear(cx, cz, 3.5)) return false;
        const n = Math.ceil(Math.hypot(lx - cx, lz - cz) / 3);
        for (let i = 1; i < n; i++)
          if (!h.isClear(cx + ((lx - cx) * i) / n, cz + ((lz - cz) * i) / n, 2.5)) return false;
      }
      const y0 = h.groundAt(sx, sz);
      return Math.abs(h.groundAt(lx, lz) - y0) < 5 && Math.abs(h.groundAt(sx + d.x * 15, sz + d.z * 15) - y0) < 4;
    };
    for (let r = 0; r <= 160; r += 8) {
      const n = Math.max(1, Math.round(r / 4));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const sx = x + Math.cos(a) * r;
        const sz = z + Math.sin(a) * r;
        if (ok(sx, sz)) return [sx, sz];
      }
    }
    return [x, z];
  }

  constructor(private host: Host) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'ending';
    this.overlay.className = 'hidden';
    this.overlay.innerHTML = `
      <div class="bar top"></div><div class="bar bottom"></div>
      <div class="words"></div>
      <div class="skip">Esc to skip</div>
      <div class="white"></div>`;
    document.body.appendChild(this.overlay);
    this.words = this.overlay.querySelector('.words')!;
    this.white = this.overlay.querySelector('.white')!;
  }

  play(onDone?: () => void) {
    if (this.active) return;
    const h = this.host;
    this.active = true;
    this.t = 0;
    this.cues.clear();
    this.onDone = onDone ?? null;
    this.baseFov = h.camera.fov;
    this.dir.set(MOON_DIR.x, 0, MOON_DIR.z).normalize();
    this.side.set(-this.dir.z, 0, this.dir.x);
    this.returnTo.copy(h.playerPos);
    const [sx, sz] = this.findStage(h.playerPos.x, h.playerPos.z);
    h.teleport(sx, sz);
    this.home.set(sx, h.groundAt(sx, sz), sz);
    this.lair.copy(this.home).addScaledVector(this.dir, LAIR);
    this.lair.y = h.groundAt(this.lair.x, this.lair.z);
    this.dragon ??= new Dragon();
    const d = this.dragon;
    // Asleep, facing the nymph.
    d.root.position.copy(this.lair);
    d.root.lookAt(this.home.x, this.lair.y, this.home.z);
    this.faceHome.copy(d.root.quaternion);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), MOON_DIR, new THREE.Vector3(0, 1, 0));
    // Object3D.lookAt points +z at the target; Matrix4.lookAt points -z, so turn it round.
    this.faceMoon
      .setFromRotationMatrix(m)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    d.root.scale.setScalar(1);
    d.root.visible = true;
    h.scene.add(d.root);
    restoreMoon(0);
    document.body.classList.add('cinematic');
    this.overlay.classList.remove('hidden');
    this.white.style.transition = 'none';
    this.white.style.opacity = '1'; // the cut: white straight away, so the move above never shows
    this.words.classList.remove('show');
  }

  skip() {
    if (!this.active) return;
    // Jump to the closing fade without setting off every sound it skips over.
    for (const c of ['in', 'reveal', 'rumble', 'roar', 'words', 'words-out', 'shimmer']) this.cues.add(c);
    this.words.classList.remove('show');
    this.t = Math.max(this.t, LENGTH - 2.2);
  }

  private cue(name: string, at: number, fn: () => void) {
    if (this.t >= at && !this.cues.has(name)) {
      this.cues.add(name);
      fn();
    }
  }

  private fade(to: number, seconds: number) {
    this.white.style.transition = `opacity ${seconds}s ease`;
    this.white.style.opacity = String(to);
  }

  update(dt: number) {
    if (!this.active || !this.dragon) return;
    this.t += dt;
    const t = this.t;
    const h = this.host;
    const d = this.dragon;
    const cam = h.camera;
    const sx = h.chimes;

    // ---- the overlay and sounds, on cue ----
    this.cue('in', 0, () => {
      this.white.style.transition = 'none';
      this.white.style.opacity = '1';
      h.setTimeOfDay(0.465); // dusk, so the mended moon glows
    });
    this.cue('reveal', 0.6, () => this.fade(0, 2.2));
    this.cue('rumble', 1.2, () => sx.rumble(7));
    this.cue('roar', 11.2, () => sx.roar());
    this.cue('words', 14, () => {
      this.words.textContent = 'Thank you, my child';
      this.words.classList.add('show');
    });
    this.cue('words-out', 19.5, () => this.words.classList.remove('show'));
    this.cue('shimmer', 31.6, () => sx.shimmer());
    this.cue('out', LENGTH - 2, () => this.fade(1, 1.4));
    // Wingbeats while it takes off and climbs.
    if (t > 20 && t < 29) {
      const beat = Math.floor((t - 20) * (3.2 / (Math.PI * 2)));
      this.cue(`beat${beat}`, 0, () => sx.whump(Math.max(0.15, 1 - (t - 20) / 9)));
    }

    // ---- the dragon ----
    const pose: DragonPose = { sleep: 1, eyes: 0, roar: 0, spread: 0, flap: 0, fly: 0 };
    pose.eyes = smooth(5, 5.6, t);
    pose.sleep = 1 - smooth(6.5, 10, t);
    pose.spread = smooth(8, 11, t);
    // A roar, then bowing its head low to the nymph while it speaks.
    pose.roar =
      smooth(10.8, 11.4, t) * (1 - smooth(13, 14.5, t)) - 0.7 * smooth(14, 15.5, t) * (1 - smooth(19, 20.5, t));
    pose.flap = smooth(20, 21, t) * (1 - smooth(27, 29, t) * 0.5);
    pose.fly = smooth(21.5, 23.5, t);
    d.pose(pose, dt);

    const groundY = (p: THREE.Vector3) => {
      // Sink by the planet's curvature as seen from the nymph, to sit on the curved ground.
      const dx = p.x - this.home.x;
      const dz = p.z - this.home.z;
      return h.groundAt(p.x, p.z) - (dx * dx + dz * dz) / (2 * CURVE_R);
    };
    if (t < 20) {
      d.root.position.copy(this.lair);
      d.root.position.y = groundY(this.lair) + Math.sin(t * 12) * 0.04 * smooth(1.2, 3, t) * (1 - smooth(5, 7, t)); // the ground trembles
      d.root.quaternion.copy(this.faceHome);
      this.liftOff.copy(d.root.position);
    } else {
      // Rise on the spot, turning toward the moon, then fly at it, faster and faster.
      const up = t - 20;
      const turn = smooth(21, 24, t);
      d.root.quaternion.slerpQuaternions(this.faceHome, this.faceMoon, turn);
      const climb = Math.min(up, 3) ** 2 * 1.1;
      const fly = Math.max(0, t - 23);
      const dist = 10 * fly + 14 * fly * fly;
      d.root.position
        .copy(this.liftOff)
        .add(this.v.set(0, climb, 0))
        .addScaledVector(MOON_DIR, dist);
      // It vanishes into the moon in a flash.
      const gone = smooth(30.4, 31.4, t);
      d.root.scale.setScalar(Math.max(0.001, 1 - gone));
      d.root.visible = gone < 1;
    }

    // ---- the moon ----
    const flash = smooth(30.6, 31.4, t) * (1 - smooth(31.4, 33.5, t));
    restoreMoon(smooth(31.2, 37, t), flash * 1.6);

    // ---- the camera ----
    const P = this.home;
    const head = this.v;
    let fov = this.baseFov;
    const at = (out: THREE.Vector3, back: number, side: number, up: number, from = P) =>
      out
        .copy(from)
        .addScaledVector(this.dir, -back)
        .addScaledVector(this.side, side)
        .setY(from.y + up);
    if (t < 6) {
      // Low behind the nymph, the mossy mound and the broken moon ahead; easing in.
      const k = smooth(0, 6, t);
      at(cam.position, lerp(6, 2, k), lerp(3, 2, k), lerp(3.4, 3, k));
      this.look.copy(this.lair).setY(this.lair.y + lerp(9, 7, k)); // the broken moon in frame above it
    } else if (t < 13.5) {
      // Pulled back and wider as it rises, spreads its wings and roars.
      const k = smooth(6, 12, t);
      at(cam.position, lerp(3, 7, k), lerp(-3, -5, k), lerp(3.2, 4, k));
      this.look.copy(this.lair).setY(this.lair.y + lerp(3, 7.5, k));
    } else if (t < 20) {
      // Close, from beside the dragon, as it bows its head to her.
      const k = smooth(13.5, 20, t);
      at(cam.position, -11, lerp(9, 7.5, k), lerp(7, 5.5, k));
      head
        .copy(this.lair)
        .lerp(P, 0.35)
        .setY(this.lair.y + 6);
      this.look.copy(head);
      fov = lerp(this.baseFov, 55, smooth(13.5, 15, t));
    } else if (t < 30) {
      // Back behind the nymph, watching it climb away toward the moon.
      at(cam.position, 6, 2, 3.2);
      const k = smooth(25, 30, t);
      this.look.copy(d.root.position).lerp(this.v.copy(cam.position).addScaledVector(MOON_DIR, 500), k);
      fov = lerp(this.baseFov, 45, smooth(24, 30, t));
    } else {
      // On the moon, closer and closer, as it mends.
      at(cam.position, 6, 2, 3.2);
      this.look.copy(cam.position).addScaledVector(MOON_DIR, 500);
      fov = lerp(45, 30, smooth(30, 38, t));
    }
    cam.position.y = Math.max(cam.position.y, h.groundAt(cam.position.x, cam.position.z) + 0.6);
    cam.lookAt(this.look);
    // A shake when it roars and as it heaves itself up.
    const shake =
      0.012 * smooth(1.2, 2.5, t) * (1 - smooth(5, 6.5, t)) + 0.02 * smooth(11, 11.4, t) * (1 - smooth(12.5, 13.5, t));
    if (shake > 0)
      cam.rotation.set(
        cam.rotation.x + (Math.random() - 0.5) * shake,
        cam.rotation.y + (Math.random() - 0.5) * shake,
        cam.rotation.z,
      );
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (t >= LENGTH) this.finish();
  }

  private finish() {
    const h = this.host;
    this.active = false;
    h.teleport(this.returnTo.x, this.returnTo.z); // back where she was, behind the white
    restoreMoon(1);
    if (this.dragon) h.scene.remove(this.dragon.root);
    h.camera.fov = this.baseFov;
    h.camera.updateProjectionMatrix();
    document.body.classList.remove('cinematic');
    this.words.classList.remove('show');
    this.fade(0, 1.6);
    setTimeout(() => {
      if (!this.active) this.overlay.classList.add('hidden');
    }, 1700);
    this.onDone?.();
  }
}
