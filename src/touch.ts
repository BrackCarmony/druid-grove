import { Player, ZOOM_MAX, ZOOM_STOPS } from './player';

// Touch controls for phones and tablets: a floating stick under the left thumb, drag anywhere
// else to look, pinch to zoom (catching at the same stops as the scroll wheel), and buttons for
// planting, hopping and the things keys do on a keyboard.

/** Whether to play with touch controls: a touch-first device, or ?touch=1 to try it on a desktop. */
export function wantsTouch() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q !== null) return q !== '0';
  return matchMedia('(pointer: coarse)').matches;
}

export interface TouchHost {
  player: Player;
  /** Playing, with no menu or cinematic up. */
  playing(): boolean;
  setPlanting(on: boolean): void;
  /** What the Use button would do here, or null to hide it. */
  useLabel(): string | null;
  use(): void;
  build(): void;
  rings(): void;
  menu(): void;
  /** Riding a mount (shows the auto-plant toggle), and whether auto-plant is on. */
  riding(): { on: boolean } | null;
  toggleAutoPlant(): void;
  /** Skip the ending if it's playing; returns whether it was. */
  skipEnding(): boolean;
}

const STICK_R = 56; // px the knob can travel from the stick's centre
const LOOK_SPEED = 2.4; // touch drags turn faster than mouse movement does
const RUN_AT = 0.92; // stick pushed this far runs

/** Keep a finger's events coming here even as it slides off (not possible for every pointer). */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* already lifted */
  }
}

interface Pt {
  id: number;
  x: number;
  y: number;
}

export class TouchControls {
  private root: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private useBtn: HTMLButtonElement;
  private autoBtn: HTMLButtonElement;
  private stick: (Pt & { ox: number; oy: number }) | null = null;
  private looks: Pt[] = [];
  private pinch: { d0: number; z0: number } | null = null;
  private lastTap = 0;

  constructor(private host: TouchHost) {
    document.body.classList.add('touch');
    const root = (this.root = document.getElementById('touch')!);
    root.classList.remove('hidden');
    root.innerHTML = `
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-top">
        <button class="t-btn t-small" data-act="menu" aria-label="Menu">☰</button>
        <button class="t-btn t-small" data-act="view" aria-label="Change view">👁</button>
        <button class="t-btn t-small" data-act="build">Build</button>
        <button class="t-btn t-small" data-act="rings">Rings</button>
        <button class="t-btn t-small hidden" data-act="auto">Auto</button>
      </div>
      <div class="t-actions">
        <button class="t-btn t-use hidden" data-act="use"></button>
        <button class="t-btn t-hop" data-act="hop">Hop</button>
        <button class="t-btn t-plant" data-act="plant">Plant</button>
      </div>`;
    this.base = root.querySelector('.t-stick')!;
    this.knob = root.querySelector('.t-knob')!;
    this.useBtn = root.querySelector('[data-act="use"]')!;
    this.autoBtn = root.querySelector('[data-act="auto"]')!;

    for (const b of root.querySelectorAll<HTMLButtonElement>('.t-btn')) this.bindButton(b);

    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
    // iOS Safari zooms the page on pinches and double-taps unless told not to.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private bindButton(b: HTMLButtonElement) {
    const act = b.dataset.act!;
    const p = this.host.player;
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.host.skipEnding()) return;
      b.classList.add('down');
      capture(b, e.pointerId);
      if (act === 'plant') this.host.setPlanting(true);
      else if (act === 'hop') p.keys.add('Space');
      else if (act === 'use') this.host.use();
      else if (act === 'build') this.host.build();
      else if (act === 'rings') this.host.rings();
      else if (act === 'menu') this.host.menu();
      else if (act === 'auto') this.host.toggleAutoPlant();
      else if (act === 'view') {
        // Step through first person, over the shoulder and the overview.
        const views = [0, ...ZOOM_STOPS];
        p.zoomTarget = views.find((v) => v > p.zoomTarget + 0.5) ?? 0;
      }
    });
    const release = () => {
      b.classList.remove('down');
      if (act === 'plant') this.host.setPlanting(false);
      else if (act === 'hop') p.keys.delete('Space');
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    // A double tap skips the ending.
    const now = performance.now();
    if (now - this.lastTap < 350 && this.host.skipEnding()) return;
    this.lastTap = now;
    if (!this.host.playing()) return;
    capture(this.root, e.pointerId);
    const pt = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (!this.stick && e.clientX < innerWidth * 0.4) {
      // The stick appears under the thumb, wherever it lands on the left.
      this.stick = { ...pt, ox: e.clientX, oy: e.clientY };
      this.base.classList.add('on');
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
      return;
    }
    this.looks.push(pt);
    if (this.looks.length === 2) this.pinch = { d0: this.spread(), z0: this.host.player.zoomTarget };
  }

  private move(e: PointerEvent) {
    const p = this.host.player;
    if (this.stick?.id === e.pointerId) {
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) {
        dx *= STICK_R / len;
        dy *= STICK_R / len;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      p.stick.set(dx / STICK_R, -dy / STICK_R);
      p.stickRun = len >= STICK_R * RUN_AT;
      return;
    }
    const pt = this.looks.find((l) => l.id === e.pointerId);
    if (!pt) return;
    const dx = e.clientX - pt.x;
    const dy = e.clientY - pt.y;
    pt.x = e.clientX;
    pt.y = e.clientY;
    if (!this.host.playing()) return;
    if (this.pinch && this.looks.length >= 2) {
      // Spreading the fingers zooms in; a single pinch can't sweep past a stop.
      const { d0, z0 } = this.pinch;
      let z = Math.min(ZOOM_MAX, Math.max(0, (z0 + 1) * Math.pow(d0 / Math.max(1, this.spread()), 1.6) - 1));
      // (the nearest stop it crosses, going either way)
      for (const stop of [...ZOOM_STOPS].sort((a, b) => Math.abs(a - z0) - Math.abs(b - z0)))
        if ((z0 < stop && z > stop) || (z0 > stop && z < stop)) {
          z = stop;
          break;
        }
      if (z < 0.8 && z < z0) z = 0;
      p.zoomTarget = z;
    } else p.look(dx * LOOK_SPEED, dy * LOOK_SPEED);
  }

  private up(e: PointerEvent) {
    if (this.stick?.id === e.pointerId) {
      this.stick = null;
      this.base.classList.remove('on');
      this.base.style.left = this.base.style.top = '';
      this.knob.style.transform = '';
      this.host.player.stick.set(0, 0);
      this.host.player.stickRun = false;
      return;
    }
    this.looks = this.looks.filter((l) => l.id !== e.pointerId);
    if (this.looks.length < 2) this.pinch = null;
  }

  private spread() {
    const [a, b] = this.looks;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Drop every touch (when a menu opens, the game pauses, etc.). */
  release() {
    if (this.stick) this.up({ pointerId: this.stick.id } as PointerEvent);
    this.looks = [];
    this.pinch = null;
    this.host.setPlanting(false);
    this.host.player.keys.delete('Space');
  }

  /** Refresh the context buttons (a few times a second). */
  update() {
    const label = this.host.useLabel();
    this.useBtn.classList.toggle('hidden', !label);
    if (label) this.useBtn.textContent = label;
    const r = this.host.riding();
    this.autoBtn.classList.toggle('hidden', !r);
    this.autoBtn.classList.toggle('on', !!r?.on);
    this.root.classList.toggle('paused', !this.host.playing());
  }
}
