import * as THREE from 'three';

// Pollen sparkle particles + tiny procedural chimes.

const MAX = 3000;

export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private next = 0;
  private c = new THREE.Color();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size: 0.13,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: makeDot(),
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.pos.fill(0);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -1000;
  }

  burst(x: number, y: number, z: number, color: number, n: number, spread = 0.4, up = 1.4) {
    this.c.setHex(color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = y + Math.random() * 0.3;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.6;
      this.vel[i * 3 + 1] = up * (0.5 + Math.random());
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      this.life[i] = 1;
      this.col[i * 3] = this.c.r;
      this.col[i * 3 + 1] = this.c.g;
      this.col[i * 3 + 2] = this.c.b;
    }
  }

  update(dt: number, time: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.55;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1000;
        continue;
      }
      this.vel[k + 1] *= 1 - dt * 0.9;
      this.pos[k] += (this.vel[k] + Math.sin(time * 2 + i) * 0.15) * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const fade = Math.min(1, this.life[i] * 2);
      this.col[k] *= 0.995 + 0.005 * fade;
      this.col[k + 1] *= 0.995 + 0.005 * fade;
      this.col[k + 2] *= 0.995 + 0.005 * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

function makeDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// ---------- sound ----------

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

export class Chimes {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastBloom = 0;
  private step = 0;
  muted = false;

  private ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  resume() {
    this.ensure().resume();
  }

  private note(semi: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = 523.25 * Math.pow(2, semi / 12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  bloom() {
    const now = performance.now();
    if (now - this.lastBloom < 70) return;
    this.lastBloom = now;
    this.step = (this.step + 1 + Math.floor(Math.random() * 3)) % PENTA.length;
    this.note(PENTA[this.step], 0.5, 0.18);
  }

  plantTick() {
    this.note(-24 + Math.random() * 2, 0.06, 0.06, 'triangle');
  }

  purchase() {
    [0, 4, 7, 12].forEach((s, i) => setTimeout(() => this.note(s, 0.6, 0.18, 'triangle'), i * 70));
  }

  fanfare() {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => setTimeout(() => this.note(s, 1.2, 0.2), i * 110));
  }

  deny() {
    this.note(-12, 0.15, 0.1, 'square');
  }
}
