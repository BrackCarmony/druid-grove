import * as THREE from 'three';
import type { Look } from './look';
import { animateNymph, buildNymph, NymphRig, setNymphTool } from './nymph';

// A small turntable of the character for the home screen's Customize panel. It has its own
// renderer, which only exists while the panel is open. Drag to turn her around.

export class LookPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private rig: NymphRig | null = null;
  private stand = new THREE.Group();
  private raf = 0;
  private last = 0;
  private yaw = 0.5;
  private spin = 0.35; // radians per second while nobody is dragging
  private drag: { x: number; yaw: number } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.scene.add(new THREE.HemisphereLight(0xd4e6ff, 0x6b5a42, 1.2));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.3);
    key.position.set(2, 4, -3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xc6ff9e, 0.8);
    rim.position.set(-2, 2, 3);
    this.scene.add(rim);
    // a mossy little plinth to stand on
    const moss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.12, 28),
      new THREE.MeshLambertMaterial({ color: 0x5f9e45, emissive: 0x0a1406 }),
    );
    moss.position.y = -0.06;
    this.stand.add(moss);
    this.scene.add(this.stand);
    this.camera.position.set(0, 1.15, -3.75);
    this.camera.lookAt(0, 0.95, 0);

    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, yaw: this.yaw };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag) this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.012;
    });
    const end = () => (this.drag = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  setLook(lk: Look) {
    if (this.rig) {
      this.stand.remove(this.rig.root);
      this.rig.root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.rig = buildNymph(lk);
    this.rig.glow.visible = false;
    setNymphTool(this.rig, 'tweezers');
    this.stand.add(this.rig.root);
  }

  start() {
    if (this.renderer) return;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    } catch {
      return; // no second WebGL context: the options still work, just without a preview
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      this.draw(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
  }

  private draw(now: number) {
    const r = this.renderer;
    if (!r || !this.rig) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
    if (!this.drag) this.yaw += this.spin * dt;
    this.stand.rotation.y = this.yaw;
    animateNymph(
      this.rig,
      { speed: 0, running: false, onGround: true, vy: 0, riding: null, work: 0, tool: 'tweezers' },
      dt,
      now / 1000,
    );
    r.render(this.scene, this.camera);
  }
}
