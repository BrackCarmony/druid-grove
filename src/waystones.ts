import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Colliders } from './colliders';
import { grassTufts, mossMaterial } from './moss';
import { leafGeo, plain } from './rig';
import { scaleUV } from './wood';
import { wdist, World } from './world';

// Waystones: standing-stone arches you can step through to any other waystone.
// Each is also a bottomless seed hub (like the Seed Hollow), so they work as bases.
// There's one at home; the rest the player builds out across the planet.

const RANGE = 3.5;
const POST_BURY = 3; // metres of post below the base
const SPACING = 30;

export interface Waystone {
  x: number;
  z: number;
  obj: THREE.Group;
  label: string;
  home: boolean;
}

// ---------- textures (painted once, shared by every waystone) ----------

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function canvasTex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Weathered grey stone: mottled, speckled, a few cracks and pale lichen rosettes. Tiles. */
let stoneTex: THREE.CanvasTexture | null = null;
function stoneTexture() {
  if (stoneTex) return stoneTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = seeded(31);
  const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S])
        if (x + ox > -r && x + ox < S + r && y + oy > -r && y + oy < S + r) draw(x + ox, y + oy);
  };
  g.fillStyle = '#b4b0ba';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 15 + rnd() * 40;
    const l = rnd() < 0.5 ? 58 + rnd() * 8 : 76 + rnd() * 8;
    wrapped(x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, `hsla(${250 + rnd() * 30},6%,${l}%,0.45)`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 2500; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    g.fillStyle = rnd() < 0.5 ? `rgba(60,55,70,${0.2 + rnd() * 0.3})` : `rgba(240,238,245,${0.2 + rnd() * 0.3})`;
    g.fillRect(x, y, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  // Cracks: jagged dark lines with a lit edge.
  for (let i = 0; i < 7; i++) {
    let x = rnd() * S;
    let y = rnd() * S;
    const pts: [number, number][] = [[x, y]];
    let a = rnd() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      a += (rnd() - 0.5) * 1.2;
      x += Math.cos(a) * (5 + rnd() * 8);
      y += Math.sin(a) * (5 + rnd() * 8);
      pts.push([x, y]);
    }
    for (const [dx, col, w] of [
      [1, 'rgba(235,232,240,0.5)', 1],
      [0, 'rgba(50,45,58,0.75)', 1.4],
    ] as const) {
      wrapped(pts[0][0], pts[0][1], 90, (px, py) => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        for (const [qx, qy] of pts) g.lineTo(qx - pts[0][0] + px + dx, qy - pts[0][1] + py + dx);
        g.stroke();
      });
    }
  }
  // Lichen.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 3 + rnd() * 7;
    const hue = rnd() < 0.7 ? 75 + rnd() * 20 : 35 + rnd() * 10;
    wrapped(x, y, r + 4, (px, py) => {
      for (let k = 0; k < 7; k++) {
        g.fillStyle = `hsla(${hue},45%,${62 + rnd() * 12}%,0.75)`;
        g.beginPath();
        g.arc(px + (rnd() - 0.5) * r, py + (rnd() - 0.5) * r, 1.5 + rnd() * r * 0.45, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
  return (stoneTex = canvasTex(c));
}

/** A column of carved glyphs, white on clear, for glowing rune strips. */
let runeTex: THREE.CanvasTexture | null = null;
function runeTexture() {
  if (runeTex) return runeTex;
  const W = 64;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = seeded(77);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = '#fff';
  g.shadowBlur = 6;
  const cell = 56;
  for (let y0 = 10; y0 + cell <= H; y0 += cell + 8) {
    g.lineWidth = 4;
    g.beginPath();
    // A glyph: a stem and two or three strokes off it, or a ring with a tick.
    const cx = W / 2;
    if (rnd() < 0.25) {
      g.arc(cx, y0 + cell / 2, 14, 0, Math.PI * 2);
      g.moveTo(cx, y0 + 4);
      g.lineTo(cx, y0 + cell - 4);
    } else {
      g.moveTo(cx, y0 + 2);
      g.lineTo(cx, y0 + cell - 2);
      const n = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) {
        const y = y0 + 8 + rnd() * (cell - 16);
        const side = rnd() < 0.5 ? -1 : 1;
        g.moveTo(cx, y);
        g.lineTo(cx + side * (10 + rnd() * 10), y + (rnd() - 0.5) * 26);
      }
    }
    g.stroke();
  }
  return (runeTex = canvasTex(c, false));
}

/** A spiral swirl fading out to clear at the edges, for the portal. */
let swirlTex: THREE.CanvasTexture | null = null;
function swirlTexture() {
  if (swirlTex) return swirlTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = S / 2;
  g.lineCap = 'round';
  for (let arm = 0; arm < 5; arm++) {
    for (let k = 0; k < 120; k++) {
      const t = k / 120;
      const r = t * R * 0.95;
      const a = (arm / 5) * Math.PI * 2 + t * 5.5;
      const fade = Math.sin(t * Math.PI) * (1 - t * 0.4);
      g.fillStyle = `rgba(255,255,255,${0.35 * fade})`;
      g.beginPath();
      g.arc(R + Math.cos(a) * r, R + Math.sin(a) * r, 2 + t * 14, 0, Math.PI * 2);
      g.fill();
    }
  }
  const grd = g.createRadialGradient(R, R, 0, R, R, R * 0.4);
  grd.addColorStop(0, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = canvasTex(c, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.center.set(0.5, 0.5);
  return (swirlTex = t);
}

/** Soft glow filling the arch: brightest in the middle, fading to its sides and top. */
function veilTexture() {
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(W / 2, H * 0.55, 4, W / 2, H * 0.55, H * 0.55);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Hessian weave for the seed sacks. */
function burlapTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8bf92';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < S; i += 4) {
    g.fillStyle = 'rgba(120,90,50,0.35)';
    g.fillRect(i, 0, 1.5, S);
    g.fillRect(0, i + 2, S, 1.5);
  }
  return canvasTex(c);
}

// ---------- shared materials ----------

const PORTAL = 0x8fe8ff;
let mats: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  const swirl = swirlTexture();
  const swirl2 = swirl.clone();
  swirl2.center.set(0.5, 0.5);
  swirl2.needsUpdate = true;
  const glow = (map: THREE.Texture, opacity: number) =>
    new THREE.MeshBasicMaterial({
      color: PORTAL,
      map,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  return {
    stone: new THREE.MeshLambertMaterial({ color: 0xdcd8e4, map: stoneTexture() }),
    veil: new THREE.MeshBasicMaterial({
      color: PORTAL,
      map: veilTexture(),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    swirl: glow(swirl, 0.55),
    swirl2: glow(swirl2, 0.35),
    rune: glow(runeTexture(), 0.85),
    gem: new THREE.MeshLambertMaterial({ color: PORTAL, emissive: 0x2a9ac0 }),
    sack: new THREE.MeshLambertMaterial({ color: 0xffffff, map: burlapTexture() }),
    twine: new THREE.MeshLambertMaterial({ color: 0x8a6a3a }),
    seed: new THREE.MeshLambertMaterial({ color: 0x9a6a3a }),
    ivy: new THREE.MeshLambertMaterial({ color: 0x4f9e3e, side: THREE.DoubleSide }),
  };
}
export function stoneMaterials() {
  return (mats ??= makeMats());
}

/** A box with roughened, slightly tapered faces: a hewn block of stone. */
function roughBlock(w: number, h: number, d: number, segs: [number, number, number], taper: number, seed: number) {
  const geo = new THREE.BoxGeometry(w, h, d, ...segs);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const t = (y + h / 2) / h; // 0 bottom .. 1 top
    const k = 1 - taper * t;
    // Same corner, same nudge (box faces don't share vertices, so this keeps them joined).
    const n = (a: number) => Math.sin(x * 12.9 + y * 7.3 + z * 9.1 + a + seed) * 0.5;
    p.setXYZ(i, x * k + n(1) * 0.07, y + n(2) * 0.05, z * k + n(3) * 0.07);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A trail of ivy leaves climbing from `from` to `to`, wandering a little. */
function ivy(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3, n: number, seed: number) {
  const parts: THREE.BufferGeometry[] = [];
  const leaf = leafGeo(0.16, 0.2, 0.3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = from.clone().lerp(to, t);
    p.x += Math.sin(t * 9 + seed) * 0.12;
    p.addScaledVector(out, 0.02);
    // Leaves face out from the stone, turned every which way.
    const e = new THREE.Euler(0, 0, (rnd() - 0.5) * 2.5);
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out).multiply(new THREE.Quaternion().setFromEuler(e));
    const s = 0.8 + rnd() * 0.6;
    parts.push(plain(leaf.clone()).applyMatrix4(m.compose(p, q, new THREE.Vector3(s, s, s))));
  }
  return mergeGeometries(parts)!;
}

const POST_H = 3.2;

function stoneModel() {
  const g = new THREE.Group();
  const M = stoneMaterials();
  for (const s of [-1, 1]) {
    // Posts run 3 m into the ground so uneven terrain never shows a gap under them.
    const geo = scaleUV(roughBlock(0.78, POST_H + POST_BURY, 0.78, [2, 8, 2], 0.14, s * 3), 0.5, 3);
    const post = new THREE.Mesh(geo, M.stone);
    post.position.set(s * 1.2, (POST_H - POST_BURY) / 2, 0);
    post.rotation.z = s * 0.035;
    g.add(post);
    // Glowing runes carved up the front and back of each post.
    for (const f of [1, -1]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 2.1), M.rune);
      strip.position.set(s * 1.2 - s * 0.03, 1.55, f * 0.38);
      strip.rotation.set(0, f < 0 ? Math.PI : 0, s * 0.035);
      g.add(strip);
    }
  }
  // The lintel, slightly sagging at its ends, with moss and grass along its top.
  const lgeo = scaleUV(roughBlock(3.5, 0.6, 0.9, [10, 2, 3], 0, 7), 1.6, 0.35);
  const lp = lgeo.attributes.position;
  for (let i = 0; i < lp.count; i++) lp.setY(i, lp.getY(i) - Math.pow(lp.getX(i) / 1.75, 2) * 0.08);
  lgeo.computeVertexNormals();
  const lintel = new THREE.Mesh(lgeo, M.stone);
  lintel.position.y = POST_H + 0.25;
  g.add(lintel);
  const mgeo = new THREE.BoxGeometry(3.3, 0.08, 0.86, 14, 1, 4);
  const mp = mgeo.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const x = mp.getX(i);
    const z = mp.getZ(i);
    const edge = Math.abs(z) > 0.4 ? 1 : 0;
    // Trailing over the front and back edges in places, sagging with the stone.
    const hang = edge * (0.06 + 0.1 * Math.max(0, Math.sin(x * 3.1 + z * 4)));
    mp.setXYZ(i, x, mp.getY(i) - hang - Math.pow(x / 1.75, 2) * 0.08, z * (1 + edge * 0.04));
  }
  mgeo.computeVertexNormals();
  const moss = new THREE.Mesh(mgeo, mossMaterial(3, 1));
  moss.position.y = POST_H + 0.58;
  g.add(moss);
  const tufts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  for (let i = 0; i < 7; i++) {
    const x = -1.4 + (i / 6) * 2.8 + Math.sin(i * 4.1) * 0.15;
    tufts.push({
      p: new THREE.Vector3(x, POST_H + 0.6 - Math.pow(x / 1.75, 2) * 0.08, Math.sin(i * 2.7) * 0.25),
      n: new THREE.Vector3(0, 1, 0),
    });
  }
  g.add(grassTufts(tufts, 9, 0.8));
  // A glowing gem set in the lintel, both faces.
  for (const f of [1, -1]) {
    const setting = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.1, 6).rotateX(Math.PI / 2), M.stone);
    setting.position.set(0, POST_H + 0.25, f * 0.46);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), M.gem);
    gem.scale.set(1, 1.3, 0.5);
    gem.position.set(0, POST_H + 0.25, f * 0.52);
    g.add(setting, gem);
  }
  // Ivy climbing the left post and creeping onto the lintel.
  const ivyMesh = new THREE.Mesh(
    mergeGeometries([
      ivy(
        new THREE.Vector3(-1.48, 0.1, 0.4),
        new THREE.Vector3(-1.5, POST_H + 0.1, 0.42),
        new THREE.Vector3(0, 0, 1),
        22,
        3,
      ),
      ivy(
        new THREE.Vector3(-1.5, POST_H + 0.1, 0.46),
        new THREE.Vector3(-0.7, POST_H + 0.3, 0.47),
        new THREE.Vector3(0, 0, 1),
        9,
        5,
      ),
    ])!,
    M.ivy,
  );
  g.add(ivyMesh);

  // The portal: a soft glowing veil with two swirls turning against each other.
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(1.66, POST_H - 0.1), M.veil);
  veil.position.y = (POST_H - 0.1) / 2;
  const swirl = new THREE.Mesh(new THREE.PlaneGeometry(1.66, POST_H - 0.1), M.swirl);
  swirl.position.set(0, (POST_H - 0.1) / 2, 0.01);
  const swirl2 = new THREE.Mesh(new THREE.PlaneGeometry(1.66, POST_H - 0.1), M.swirl2);
  swirl2.position.set(0, (POST_H - 0.1) / 2, -0.01);
  g.add(veil, swirl, swirl2);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.7, 26, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: PORTAL,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 13;
  g.add(beam);

  // Flagstones through the arch (each snapped to the ground where it lies, see build()).
  const flags: [number, number, number][] = [
    [0, 0, 0.55],
    [0.15, 1.15, 0.45],
    [-0.1, 2.1, 0.4],
    [-0.12, -1.1, 0.45],
    [0.1, -2.05, 0.38],
  ];
  flags.forEach(([x, z, r], i) => {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.1, 7), M.stone);
    f.scale.set(1.25, 1, 1);
    f.rotation.y = i * 1.3;
    f.position.set(x, 0, z);
    f.name = 'ground';
    f.userData.lift = 0.02;
    g.add(f);
  });

  // Seed sacks and a spill of seed by the posts: this is a place to restock.
  // Each is named 'ground' and snapped to the terrain where it stands once placed (see build()).
  const v = (r: number, y: number) => new THREE.Vector2(r, y);
  const sackGeo = scaleUV(
    new THREE.LatheGeometry(
      [
        v(0.01, 0),
        v(0.34, 0.03),
        v(0.44, 0.2),
        v(0.42, 0.5),
        v(0.3, 0.72),
        v(0.12, 0.84),
        v(0.1, 0.9),
        v(0.16, 1.02),
        v(0.01, 1.04),
      ],
      12,
    ),
    3,
    2,
  );
  for (const s of [-1, 1]) {
    const bag = new THREE.Group();
    bag.name = 'ground';
    const sack = new THREE.Mesh(sackGeo, M.sack);
    sack.rotation.set(s * 0.08, s, -s * 0.1);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 4, 10).rotateX(Math.PI / 2), M.twine);
    tie.position.y = 0.86;
    sack.add(tie);
    bag.add(sack);
    bag.position.set(s * 2.1, 0, 0.55);
    g.add(bag);
    for (let i = 0; i < 7; i++) {
      const r = 0.08 + (i % 3) * 0.035;
      const seed = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), M.seed);
      seed.scale.set(1, 0.7, 1.3);
      seed.name = 'ground';
      seed.userData.lift = r * 0.5; // half-buried in the soil
      seed.position.set(s * (1.7 + (i % 3) * 0.22), 0, 0.9 + Math.floor(i / 3) * 0.25 + (i % 2) * 0.1);
      seed.rotation.set(i, i * 2, 0);
      g.add(seed);
    }
  }
  return g;
}

export class Waystones {
  group = new THREE.Group();
  stones: Waystone[] = [];

  constructor(
    private world: World,
    private colliders: Colliders,
  ) {
    this.build(10, 16, 'Waystone · home'); // flat, dry ground in the starting glade, by the obelisk
  }

  get home() {
    return this.stones[0];
  }

  build(x: number, z: number, label?: string): Waystone {
    const obj = stoneModel();
    // Sit the arch at the lowest ground under it, so the portal never hangs above a dip;
    // the posts go deep enough to meet higher ground too.
    let base = Infinity;
    for (const dx of [-1.2, -0.6, 0, 0.6, 1.2])
      for (const dz of [-0.35, 0.35]) base = Math.min(base, this.world.heightAt(x + dx, z + dz));
    obj.position.set(x, base, z);
    for (const c of obj.children) {
      if (c.name !== 'ground') continue;
      c.position.y = this.world.heightAt(x + c.position.x, z + c.position.z) - base + (c.userData.lift ?? 0) - 0.03;
    }
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
    if (!mats) return;
    // Every portal shares its materials, so one turn of the swirls animates them all.
    const M = mats;
    M.swirl.map!.rotation = time * 0.6;
    M.swirl2.map!.rotation = -time * 0.35;
    M.veil.opacity = 0.34 + Math.sin(time * 2) * 0.06;
    M.rune.opacity = 0.65 + Math.sin(time * 1.3) * 0.2;
    M.gem.emissiveIntensity = 1 + Math.sin(time * 1.3) * 0.3;
  }
}
