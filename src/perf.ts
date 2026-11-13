import * as THREE from 'three';

// Lightweight frame profiler.
// The main loop calls begin() at the top of each frame, mark('name') after each chunk of
// work (the time since the previous mark is charged to that name), and end() at the bottom.
// Every 30 s of play a summary is sent to /api/perf, where nginx appends it to a log on the
// server (see deploy/ and scripts/perf-report.mjs). F3 shows the same numbers live.
//
// Reports are anonymous: a random id per page load, the device's GPU/screen, and game state.
// Turn them off with ?perf=off (remembered), back on with ?perf=on.

const WINDOW_S = 30;
const STALL_MS = 250; // gaps longer than this are a hidden tab or a breakpoint, not a frame

interface Section {
  sum: number;
  max: number;
}

export type GameSnapshot = Record<string, number | string | boolean>;

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function gpuName(gl: WebGL2RenderingContext) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/** GPU time of the render pass, where the browser exposes timer queries (often desktop only). */
class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  samples: number[] = [];

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  get supported() {
    return !!this.ext;
  }
  start() {
    if (!this.ext || this.pending.length > 4) return;
    this.active = this.gl.createQuery();
    if (this.active) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }
  stop() {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    // Results arrive a few frames later.
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) this.samples.push(this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6);
      this.gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}

export class Perf {
  readonly sid = Math.random().toString(36).slice(2, 10);
  private sections = new Map<string, Section>();
  private cpu: number[] = []; // ms of JS work per frame (begin → end)
  private intervals: number[] = []; // ms between frame starts (what the player feels)
  private stalls = 0;
  private frameStart = 0;
  private lastMark = 0;
  private lastStart = 0;
  private windowStart = performance.now();
  private gpu: GpuTimer;
  private ctx: Record<string, string | number>;
  private enabled: boolean;
  private sentLoad = false;
  private overlay: HTMLElement | null = null;
  private live = new Map<string, number>(); // smoothed ms per section for the overlay
  private liveFrame = 0;
  private liveTimer = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private snapshot: () => GameSnapshot,
  ) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.gpu = new GpuTimer(gl);
    this.ctx = {
      device: gpuName(gl),
      w: innerWidth,
      h: innerHeight,
      dpr: r2(renderer.getPixelRatio()),
      cores: navigator.hardwareConcurrency ?? 0,
      mem: (navigator as { deviceMemory?: number }).deviceMemory ?? 0,
      // A dev server started before vite.config.ts existed won't define it.
      build: typeof __BUILD__ === 'undefined' ? 'dev' : __BUILD__,
    };
    const q = new URLSearchParams(location.search).get('perf');
    try {
      if (q === 'off') localStorage.setItem('dg-perf-off', '1');
      if (q === 'on') localStorage.removeItem('dg-perf-off');
    } catch {}
    let off = false;
    try {
      off = localStorage.getItem('dg-perf-off') === '1';
    } catch {}
    // Only the deployed build reports; in dev, ?perf=on sends to the dev server (which 404s) for testing.
    this.enabled = !off && (import.meta.env.PROD || q === 'on');
    addEventListener('resize', () => {
      this.ctx.w = innerWidth;
      this.ctx.h = innerHeight;
    });
    addEventListener('pagehide', () => this.flush(true));
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
  }

  /** One-off timings from startup (ms since navigation start). */
  load(marks: Record<string, number>) {
    if (this.sentLoad) return;
    this.sentLoad = true;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    this.send({
      kind: 'load',
      marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round(v)])),
      domReady: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      gpuTimer: this.gpu.supported,
    });
  }

  begin() {
    const now = performance.now();
    if (this.lastStart) {
      const gap = now - this.lastStart;
      if (gap > STALL_MS) this.stalls++;
      else this.intervals.push(gap);
    }
    this.lastStart = this.frameStart = this.lastMark = now;
  }

  mark(name: string) {
    const now = performance.now();
    const ms = now - this.lastMark;
    this.lastMark = now;
    let s = this.sections.get(name);
    if (!s) this.sections.set(name, (s = { sum: 0, max: 0 }));
    s.sum += ms;
    if (ms > s.max) s.max = ms;
    if (this.overlay) this.live.set(name, (this.live.get(name) ?? ms) * 0.95 + ms * 0.05);
  }

  /** Wrap the render call so its GPU time can be measured too. */
  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.gpu.start();
    this.renderer.render(scene, camera);
    this.gpu.stop();
    this.mark('render');
  }

  end() {
    const now = performance.now();
    const cpu = now - this.frameStart;
    this.cpu.push(cpu);
    if (this.overlay) {
      this.liveFrame = this.liveFrame * 0.95 + cpu * 0.05;
      this.liveTimer -= cpu;
      if (this.liveTimer <= 0) {
        this.liveTimer = 500;
        this.drawOverlay();
      }
    }
    if (now - this.windowStart > WINDOW_S * 1000) this.flush(false);
  }

  toggleOverlay() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      return;
    }
    this.overlay = document.createElement('pre');
    this.overlay.id = 'perf-overlay';
    document.body.appendChild(this.overlay);
    this.live.clear();
    this.drawOverlay();
  }

  private drawOverlay() {
    if (!this.overlay) return;
    const iv = this.intervals.slice(-120);
    const avg = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
    const info = this.renderer.info.render;
    const rows = [...this.live.entries()].sort((a, b) => b[1] - a[1]);
    const gpu = this.gpu.samples.slice(-30);
    const lines = [
      `${avg ? (1000 / avg).toFixed(0) : '–'} fps · frame ${avg.toFixed(1)} ms · js ${this.liveFrame.toFixed(2)} ms`,
      gpu.length ? `gpu ${(gpu.reduce((a, b) => a + b, 0) / gpu.length).toFixed(2)} ms` : 'gpu timer n/a',
      `${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris`,
      '',
      ...rows.map(([k, v]) => `${k.padEnd(12)} ${v.toFixed(2).padStart(6)} ms`),
      '',
      this.enabled ? `reporting every ${WINDOW_S}s` : 'reporting off',
    ];
    this.overlay.textContent = lines.join('\n');
  }

  private flush(final: boolean) {
    const frames = this.cpu.length;
    const now = performance.now();
    const dur = (now - this.windowStart) / 1000;
    if (frames < (final ? 60 : 1)) {
      if (!final) this.reset(now);
      return;
    }
    const cpu = [...this.cpu].sort((a, b) => a - b);
    const iv = [...this.intervals].sort((a, b) => a - b);
    const ivSum = iv.reduce((a, b) => a + b, 0);
    const gpu = [...this.gpu.samples].sort((a, b) => a - b);
    const sections: Record<string, [number, number]> = {};
    for (const [k, s] of this.sections) sections[k] = [Math.round((s.sum / frames) * 1000) / 1000, r2(s.max)];
    const info = this.renderer.info;
    const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    this.send({
      kind: 'window',
      dur: r2(dur),
      frames,
      stalls: this.stalls,
      fps: iv.length ? r2(1000 / (ivSum / iv.length)) : 0,
      // Percentiles in ms: [p50, p90, p99, max]
      interval: [pct(iv, 0.5), pct(iv, 0.9), pct(iv, 0.99), iv[iv.length - 1] ?? 0].map(r2),
      cpu: [pct(cpu, 0.5), pct(cpu, 0.9), pct(cpu, 0.99), cpu[cpu.length - 1]].map(r2),
      gpu: gpu.length ? [pct(gpu, 0.5), pct(gpu, 0.9), pct(gpu, 0.99), gpu[gpu.length - 1]].map(r2) : null,
      long: [iv.filter((t) => t > 20).length, iv.filter((t) => t > 34).length, iv.filter((t) => t > 50).length],
      // Per section: [mean ms per frame, worst single frame ms]
      sections,
      draw: {
        calls: info.render.calls,
        tris: info.render.triangles,
        geos: info.memory.geometries,
        tex: info.memory.textures,
        progs: info.programs?.length ?? 0,
      },
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0,
      game: this.snapshot(),
    });
    this.reset(now);
  }

  private reset(now: number) {
    this.windowStart = now;
    this.sections.clear();
    this.cpu.length = 0;
    this.intervals.length = 0;
    this.gpu.samples.length = 0;
    this.stalls = 0;
  }

  private send(data: Record<string, unknown>) {
    const body = JSON.stringify({ v: 1, sid: this.sid, t: Date.now(), ...this.ctx, ...data });
    if (!this.enabled) {
      if (!import.meta.env.PROD) console.debug('[perf]', JSON.parse(body));
      return;
    }
    try {
      if (!navigator.sendBeacon('/api/perf', body)) {
        void fetch('/api/perf', { method: 'POST', body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }
}
