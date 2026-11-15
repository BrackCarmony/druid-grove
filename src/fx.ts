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

// "Breaking rock" from OpenGameArt (CC0).
const ROCK_BREAK = `${import.meta.env.BASE_URL}sfx/rock-break.mp3`;
// "Bear Growls" from OpenGameArt (CC0; recordings from the U.S. Fish & Wildlife Service).
const GROWLS = [1, 2].map((n) => `${import.meta.env.BASE_URL}sfx/bear-growl-${n}.mp3`);
const SFX_LEVEL = 0.22; // chimes at 100% effects volume
const MUSIC_LEVEL = 0.55; // the track at 100% music volume
const SONG_GAP = 4; // seconds of quiet between songs

/** A song is one or more audio files scheduled against the song's start. */
export interface Song {
  title: string;
  /** `at`: seconds from the song's start; omitted means right after the previous part ends. */
  parts: { url: string; at?: number }[];
}

/** Sound effects (synthesised chimes) and the music playlist, each with its own volume. */
export class Chimes {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null; // everything; M mutes here
  private master: GainNode | null = null; // sound effects
  private musicGain: GainNode | null = null;
  private songs: Song[] = [];
  private songIndex = 0;
  private buffers = new Map<string, Promise<AudioBuffer>>(); // music (pruned as songs change)
  private samples = new Map<string, Promise<AudioBuffer>>(); // sound effects (kept)
  private sfxVol = 1;
  private musicVol = 0.5;
  private lastBloom = 0;
  private growlUntil = 0; // AudioContext time the current growl ends
  private step = 0;
  muted = false;

  private ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : 1;
      this.out.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = SFX_LEVEL * this.sfxVol;
      this.master.connect(this.out);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.out);
    }
    return this.ctx;
  }

  resume() {
    this.ensure().resume();
    void this.sample(ROCK_BREAK).catch(() => {}); // tiny; decode it before the first smash
  }

  private sample(url: string) {
    let p = this.samples.get(url);
    if (!p) {
      const ctx = this.ensure();
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((d) => ctx.decodeAudioData(d));
      this.samples.set(url, p);
      p.catch(() => this.samples.delete(url));
    }
    return p;
  }

  /** A bear growls (hiring one). Buying more while it's still growling doesn't start another. */
  growl() {
    if (this.muted) return;
    const ctx = this.ensure();
    if (ctx.currentTime < this.growlUntil) return;
    this.growlUntil = ctx.currentTime + 1.3; // covers the decode, until the real end is known
    this.play(GROWLS[Math.floor(Math.random() * GROWLS.length)], 1.6, 0.06, (end) => (this.growlUntil = end));
  }

  /** Play a recorded effect through the effects volume, with a little pitch variation. */
  private play(url: string, vol: number, spread = 0.1, onStart?: (endsAt: number) => void) {
    if (this.muted) return;
    const ctx = this.ensure();
    this.sample(url)
      .then((buf) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
        onStart?.(ctx.currentTime + buf.duration / src.playbackRate.value);
        const g = ctx.createGain();
        g.gain.value = vol;
        src.connect(g).connect(this.master!);
        src.start();
      })
      .catch(() => {});
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVol = sfx;
    this.musicVol = music;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master!.gain.setTargetAtTime(SFX_LEVEL * sfx, t, 0.05);
    if (this.songs.length) this.musicGain!.gain.setTargetAtTime(MUSIC_LEVEL * music, t, 0.1);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.out!.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** Start the music playlist (call from a user gesture; safe to call repeatedly). */
  startMusic(songs: Song[]) {
    const ctx = this.ensure();
    void ctx.resume();
    if (this.songs.length || !songs.length) return;
    this.songs = songs;
    this.songIndex = Math.floor(Math.random() * songs.length);
    // Fade in gently the first time.
    this.musicGain!.gain.setValueAtTime(0, ctx.currentTime);
    this.musicGain!.gain.linearRampToValueAtTime(MUSIC_LEVEL * this.musicVol, ctx.currentTime + 4);
    void this.playNext();
  }

  private async buffer(url: string) {
    let p = this.buffers.get(url);
    if (!p) {
      const ctx = this.ensure();
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((d) => ctx.decodeAudioData(d));
      this.buffers.set(url, p);
      p.catch(() => this.buffers.delete(url)); // let a later attempt retry
    }
    return p;
  }

  /** Schedule every part of the next song on the audio clock, then queue the one after. */
  private async playNext() {
    const ctx = this.ensure();
    const song = this.songs[this.songIndex % this.songs.length];
    this.songIndex++;
    try {
      const bufs = await Promise.all(song.parts.map((p) => this.buffer(p.url)));
      // Keep only this song's and the next song's audio decoded.
      const next = this.songs[this.songIndex % this.songs.length];
      const keep = new Set([...song.parts, ...next.parts].map((p) => p.url));
      for (const url of [...this.buffers.keys()]) if (!keep.has(url)) this.buffers.delete(url);
      for (const p of next.parts) void this.buffer(p.url).catch(() => {});

      const t0 = ctx.currentTime + 0.1;
      let prevEnd = 0;
      let last: AudioBufferSourceNode | null = null;
      let lastEnd = -1;
      song.parts.forEach((part, i) => {
        const at = part.at ?? prevEnd; // no time given: straight after the previous part
        const src = ctx.createBufferSource();
        src.buffer = bufs[i];
        src.connect(this.musicGain!);
        src.start(t0 + at);
        prevEnd = at + bufs[i].duration;
        if (prevEnd > lastEnd) {
          lastEnd = prevEnd;
          last = src;
        }
      });
      // When the final part (tail included) has rung out, take a breath and play the next song.
      (last as AudioBufferSourceNode | null)?.addEventListener('ended', () => {
        setTimeout(() => void this.playNext(), SONG_GAP * 1000);
      });
    } catch (e) {
      console.warn(`Music failed to load: ${song.title}`, e);
      if (this.songs.length > 1) setTimeout(() => void this.playNext(), 5000);
    }
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

  /** Notes one after another, `gap` ms apart. */
  private seq(semis: number[], gap: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    semis.forEach((n, i) => setTimeout(() => this.note(n, dur, vol, type), i * gap));
  }

  /** A short burst of filtered noise: knocks, thumps, rustles, rattles. */
  private hit(freq: number, type: BiquadFilterType, vol: number, dur: number, delay = 0, q = 1) {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (dur + 0.05)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  /** A low buzz, like a hive. */
  private buzz(dur: number, vol: number) {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.linearRampToValueAtTime(240, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    // A wobble in the loudness, like wings.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const depth = ctx.createGain();
    depth.gain.value = vol * 0.5;
    lfo.connect(depth).connect(g.gain);
    o.connect(f).connect(g).connect(this.master!);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** Something bought at the obelisk: each part of the shop has its own little sound. */
  shop(kind: 'tool' | 'mount' | 'planting' | 'seeds' | 'squirrels' | 'soil' | 'hives' | 'fairies') {
    switch (kind) {
      case 'tool': // a wooden knock, then a bright ring
        this.hit(900, 'bandpass', 1.4, 0.08, 0, 4);
        this.hit(600, 'bandpass', 1.0, 0.1, 0.09, 4);
        setTimeout(() => this.seq([7, 12, 19], 80, 0.7, 0.16, 'triangle'), 170);
        break;
      case 'mount': // two hoof-falls and a rising call
        this.hit(220, 'lowpass', 2.2, 0.16);
        this.hit(180, 'lowpass', 2.2, 0.16, 0.2);
        setTimeout(() => this.seq([-5, 0, 7, 12], 120, 0.9, 0.15), 380);
        break;
      case 'planting': // a leafy rustle and a climbing run
        this.hit(4000, 'highpass', 0.5, 0.25);
        this.seq([0, 2, 4, 7, 9], 55, 0.5, 0.15, 'triangle');
        break;
      case 'seeds': // seeds rattling in the satchel
        for (let i = 0; i < 6; i++) this.hit(2500 + Math.random() * 2000, 'bandpass', 0.9, 0.03, i * 0.045, 6);
        setTimeout(() => this.seq([4, 9], 90, 0.5, 0.15, 'triangle'), 300);
        break;
      case 'squirrels': // a quick chitter
        this.seq([24, 26, 24, 28, 26], 45, 0.05, 0.06, 'square');
        setTimeout(() => this.seq([7, 12], 90, 0.5, 0.14, 'triangle'), 280);
        break;
      case 'soil': // an earthy thump and low notes
        this.hit(150, 'lowpass', 2.6, 0.3);
        this.seq([-12, -5, 0], 110, 0.8, 0.18);
        break;
      case 'hives': // a buzz, then a warm chord
        this.buzz(0.45, 0.07);
        setTimeout(() => this.seq([0, 4, 7], 70, 0.8, 0.14, 'triangle'), 300);
        break;
      case 'fairies': // a twinkling sparkle
        this.seq([24, 28, 31, 36, 31, 36], 50, 0.4, 0.08);
        this.hit(7000, 'highpass', 0.25, 0.4);
        break;
    }
  }

  fanfare() {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => setTimeout(() => this.note(s, 1.2, 0.2), i * 110));
  }

  /** A boulder shattering under hooves. */
  crunch() {
    this.play(ROCK_BREAK, 0.9);
  }

  deny() {
    this.note(-12, 0.15, 0.1, 'square');
  }

  /** Filtered noise with a gain envelope (attack, hold, release in seconds). */
  private noise(freq: number, q: number, vol: number, attack: number, hold: number, release: number, sweepTo = freq) {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const len = attack + hold + release + 0.1;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // brown-ish: deep and rumbly
      d[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + hold + release);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + hold);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  /** The ground groaning as something huge stirs beneath it. */
  rumble(seconds: number) {
    this.noise(140, 1, 1.4, seconds * 0.3, seconds * 0.4, seconds * 0.3);
  }

  /** A great dragon's roar: a growl that swells and falls, over a breathy rush. */
  roar() {
    if (this.muted) return;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const dur = 2.6;
    for (const [base, vol] of [
      [70, 0.32],
      [104, 0.22],
      [141, 0.12],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.8, t);
      o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.5);
      o.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
      // A fast wobble gives it a throaty growl.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lg = ctx.createGain();
      lg.gain.value = base * 0.12;
      lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(400, t);
      f.frequency.linearRampToValueAtTime(1400, t + 0.5);
      f.frequency.linearRampToValueAtTime(300, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.25);
      g.gain.setValueAtTime(vol, t + 1.4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f).connect(g).connect(this.master!);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.1);
      lfo.stop(t + dur + 0.1);
    }
    this.noise(900, 0.7, 0.9, 0.2, 1.3, 1.1, 250);
  }

  /** Wingbeats: a soft whump of air. */
  whump(vol = 1) {
    this.noise(220, 1.5, 1.6 * vol, 0.05, 0.05, 0.4, 80);
  }

  /** The moon made whole: a slow, bright, rising shimmer of chimes. */
  shimmer() {
    const notes = [0, 7, 12, 16, 19, 24, 28, 31, 36];
    notes.forEach((s, i) => setTimeout(() => this.note(s - 12, 3.2, 0.16), i * 220));
    notes.forEach((s, i) => setTimeout(() => this.note(s, 2.4, 0.08, 'triangle'), 900 + i * 160));
  }
}
