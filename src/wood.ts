import * as THREE from 'three';

// Wood for logs, stumps and tree trunks: a painted bark texture (ridged plates split by dark
// vertical fissures, with the odd knot) and an end-grain texture of growth rings for cut tops.
// Both are painted in light neutral tones and tinted by the material colour, so one texture
// serves every kind of wood. They're shared: make geometry UVs repeat with scaleUV().

let barkTex: THREE.CanvasTexture | null = null;
let ringTex: THREE.CanvasTexture | null = null;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function finish(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function barkTexture() {
  if (barkTex) return barkTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = rng(11);
  const grey = (l: number, a = 1) => `hsla(${28 + (rnd() - 0.5) * 10},${14 + rnd() * 10}%,${l}%,${a})`;
  // Draw at every wrapped copy so the texture tiles.
  const wrapped = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S])
        if (x + ox > -r && x + ox < S + r && y + oy > -r && y + oy < S + r) draw(x + ox, y + oy);
  };
  g.fillStyle = grey(80);
  g.fillRect(0, 0, S, S);
  // Long vertical plates of slightly different shades.
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const w = 8 + rnd() * 16;
    const h = 40 + rnd() * 90;
    g.fillStyle = grey(70 + rnd() * 20, 0.6);
    wrapped(x, y, h, (px, py) => {
      g.beginPath();
      g.ellipse(px, py, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  // Fine grain streaks along the plates.
  g.lineCap = 'round';
  for (let i = 0; i < 500; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 10 + rnd() * 30;
    g.strokeStyle = grey(rnd() < 0.5 ? 60 + rnd() * 10 : 88 + rnd() * 8, 0.5);
    g.lineWidth = 0.6 + rnd();
    wrapped(x, y, len, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + (rnd() - 0.5) * 2, py + len);
      g.stroke();
    });
  }
  // Deep fissures: long, pointed dark splits running up the bark between the plates, in
  // broken lengths that overlap their neighbours like real bark.
  const lens = (x: number, y: number, len: number, w: number, drift: number) => {
    g.beginPath();
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const px = x + Math.sin(t * Math.PI) * drift - Math.sin(t * Math.PI) * w;
      if (k === 0) g.moveTo(px, y + t * len);
      else g.lineTo(px, y + t * len);
    }
    for (let k = 16; k >= 0; k--) {
      const t = k / 16;
      g.lineTo(x + Math.sin(t * Math.PI) * drift + Math.sin(t * Math.PI) * w, y + t * len);
    }
    g.fill();
  };
  for (let i = 0; i < 18; i++) {
    const x0 = (i / 18) * S + (rnd() - 0.5) * 8;
    let y = rnd() * S;
    const end = y + S;
    while (y < end) {
      const len = 30 + rnd() * 70;
      const w = 1.5 + rnd() * 2;
      const x = x0 + (rnd() - 0.5) * 6;
      const drift = (rnd() - 0.5) * 6;
      wrapped(x, y + len / 2, len, (px, py) => {
        g.fillStyle = grey(90, 0.55); // a lit lip beside the groove
        lens(px + 1.8, py - len / 2, len, w * 0.7, drift);
        g.fillStyle = grey(20, 0.92);
        lens(px, py - len / 2, len, w, drift);
      });
      y += len * (0.75 + rnd() * 0.4); // the next one starts before this ends, or just after
    }
  }
  // Short cross cracks between fissures.
  for (let i = 0; i < 50; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 4 + rnd() * 8;
    g.strokeStyle = grey(30, 0.7);
    g.lineWidth = 1 + rnd();
    wrapped(x, y, len, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + len, py + (rnd() - 0.5) * 3);
      g.stroke();
    });
  }
  // A couple of knots.
  for (let i = 0; i < 3; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    wrapped(x, y, 14, (px, py) => {
      for (let r = 12; r > 2; r -= 3) {
        g.strokeStyle = grey(r % 2 ? 35 : 55, 0.8);
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(px, py, r * 0.7, r, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = grey(20);
      g.beginPath();
      g.ellipse(px, py, 2, 3, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  return (barkTex = finish(c));
}

/** Growth rings for a cut end, centred on the texture (cylinder caps map to that). */
function ringTexture() {
  if (ringTex) return ringTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = rng(23);
  g.fillStyle = 'hsl(32,30%,82%)';
  g.fillRect(0, 0, S, S);
  for (let r = 4; r < S * 0.7; r += 2.5 + rnd() * 3.5) {
    g.strokeStyle = `hsla(26,30%,${50 + rnd() * 15}%,${0.5 + rnd() * 0.4})`;
    g.lineWidth = 0.8 + rnd() * 1.2;
    g.beginPath();
    // Slightly wobbly rings.
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const rr = r * (1 + 0.04 * Math.sin(a * 3 + r * 0.1));
      const x = S / 2 + Math.cos(a) * rr;
      const y = S / 2 + Math.sin(a) * rr;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // Radial drying cracks.
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = 6 + rnd() * 20;
    const r1 = r0 + 15 + rnd() * 30;
    g.strokeStyle = 'hsla(25,30%,28%,0.8)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
    g.lineTo(S / 2 + Math.cos(a + 0.05) * r1, S / 2 + Math.sin(a + 0.05) * r1);
    g.stroke();
  }
  return (ringTex = finish(c));
}

// The textures average lighter than white-on-colour would, so the tint is brightened a little
// to keep each wood roughly the shade it was as a flat colour.
const LIFT = 1.25;

function tint(color: number) {
  return new THREE.Color(color).multiplyScalar(LIFT);
}

export function barkMaterial(color: number, side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshLambertMaterial({ color: tint(color), map: barkTexture(), side });
}

export function endGrainMaterial(color: number) {
  return new THREE.MeshLambertMaterial({ color: tint(color), map: ringTexture() });
}

/** Scale a geometry's UVs so the shared texture repeats u times around and v times along it. */
export function scaleUV<T extends THREE.BufferGeometry>(geo: T, u: number, v: number) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return geo;
}

/**
 * A wood cylinder with bark around its side and growth rings on its ends (CylinderGeometry's
 * groups: side, top, bottom). Its caps keep the 0..1 UVs the ring texture is centred in.
 */
export function woodCylinder(geo: THREE.CylinderGeometry, barkColor: number, cutColor: number, u: number, v: number) {
  // The side's vertices come first in a CylinderGeometry.
  const { radialSegments, heightSegments } = geo.parameters;
  const uv = geo.attributes.uv;
  for (let k = 0; k < (radialSegments + 1) * (heightSegments + 1); k++) uv.setXY(k, uv.getX(k) * u, uv.getY(k) * v);
  const cut = endGrainMaterial(cutColor);
  return { geo, materials: [barkMaterial(barkColor), cut, cut] };
}
