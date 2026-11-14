import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Mossy, grassy tops for buildings (the Seed Hollow log, bear dens): a painted moss texture so
// the green isn't one flat colour, and little tufts of grass blades and flowers to sit on it.

let tex: THREE.CanvasTexture | null = null;

/** A tiling moss texture: mottled greens, darker hollows, short blade strokes and a few specks. */
function mossTexture() {
  if (tex) return tex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // Seeded, so every visit paints the same moss.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const green = (l: number, a = 1) => {
    const h = 88 + (rnd() - 0.5) * 22;
    const s = 42 + rnd() * 18;
    return `hsla(${h},${s}%,${l}%,${a})`;
  };
  // Draw a shape at every wrapped position it touches, so the texture tiles seamlessly.
  const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S])
        if (x + ox > -r && x + ox < S + r && y + oy > -r && y + oy < S + r) draw(x + ox, y + oy);
  };
  g.fillStyle = green(42);
  g.fillRect(0, 0, S, S);
  // Big soft patches of lighter and darker moss.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 14 + rnd() * 30;
    const col = green(rnd() < 0.5 ? 30 + rnd() * 8 : 50 + rnd() * 10, 0.35);
    wrapped(x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // Clumpy moss cushions.
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 1.5 + rnd() * 4;
    g.fillStyle = green(rnd() < 0.45 ? 28 + rnd() * 8 : 46 + rnd() * 14, 0.8);
    wrapped(x, y, r, (px, py) => {
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    });
  }
  // Short grass blades.
  g.lineCap = 'round';
  for (let i = 0; i < 600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 4 + rnd() * 7;
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
    g.strokeStyle = green(rnd() < 0.3 ? 30 : 55 + rnd() * 12, 0.85);
    g.lineWidth = 1 + rnd() * 0.8;
    wrapped(x, y, len, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      g.stroke();
    });
  }
  // A few specks of tiny flowers and dry bits.
  const specks = ['#f4f0d8', '#f6d86b', '#d9a6e6', '#a07a4a'];
  for (let i = 0; i < 60; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    g.fillStyle = specks[Math.floor(rnd() * specks.length)];
    wrapped(x, y, 2, (px, py) => {
      g.beginPath();
      g.arc(px, py, 1.1 + rnd() * 0.8, 0, Math.PI * 2);
      g.fill();
    });
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Moss material; repeat sets how many times the texture tiles across the geometry's UVs. */
export function mossMaterial(repeatU: number, repeatV: number) {
  const map = mossTexture().clone();
  map.repeat.set(repeatU, repeatV);
  map.needsUpdate = true;
  return new THREE.MeshLambertMaterial({ color: 0xffffff, map });
}

/** Mutates material into the moss look (for materials made elsewhere, e.g. with shader patches). */
export function applyMoss(m: THREE.MeshLambertMaterial, repeatU: number, repeatV: number) {
  const map = mossTexture().clone();
  map.repeat.set(repeatU, repeatV);
  map.needsUpdate = true;
  m.map = map;
  m.color.set(0xffffff);
  return m;
}

const GRASS = [0x4f8f32, 0x67a83c, 0x7dbb48, 0x3f7a2c];
const FLOWERS = [0xf4f0d8, 0xf6d86b, 0xd9a6e6, 0xf2a8c6];

function tinted(geo: THREE.BufferGeometry, hex: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/**
 * Tufts of grass (and the odd flower) standing on a surface, merged into one mesh.
 * spots gives each tuft's position and surface normal in the parent's space.
 */
export function grassTufts(spots: { p: THREE.Vector3; n: THREE.Vector3 }[], seed = 1, size = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (const { p, n } of spots) {
    // Blades lean halfway between the surface normal and straight up, like real grass.
    const dir = n.clone().add(up).normalize();
    q.setFromUnitVectors(up, dir);
    const blades = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < blades; i++) {
      const h = (0.22 + rnd() * 0.22) * size;
      const blade = new THREE.ConeGeometry(0.035 * size, h, 3, 1);
      blade.translate(0, h / 2, 0);
      blade.rotateZ((rnd() - 0.5) * 0.7);
      blade.rotateX((rnd() - 0.5) * 0.7);
      blade.translate((rnd() - 0.5) * 0.16 * size, 0, (rnd() - 0.5) * 0.16 * size);
      blade.applyMatrix4(m.compose(p, q, new THREE.Vector3(1, 1, 1)));
      parts.push(tinted(blade, GRASS[Math.floor(rnd() * GRASS.length)]));
    }
    if (rnd() < 0.3) {
      const h = 0.3 * size;
      const stem = new THREE.CylinderGeometry(0.012 * size, 0.012 * size, h, 3);
      stem.translate(0, h / 2, 0);
      const bloom = new THREE.IcosahedronGeometry(0.05 * size, 0);
      bloom.translate(0, h, 0);
      for (const [geo, col] of [
        [stem, 0x4f8f32],
        [bloom, FLOWERS[Math.floor(rnd() * FLOWERS.length)]],
      ] as const) {
        geo.applyMatrix4(m.compose(p, q, new THREE.Vector3(1, 1, 1)));
        parts.push(tinted(geo, col));
      }
    }
  }
  const geo = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}
