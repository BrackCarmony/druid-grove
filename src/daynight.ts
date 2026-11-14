import * as THREE from 'three';
import { MOON_DIR } from './sky';
import { lightUniforms, sharedUniforms } from './terrain';

// A 10-minute day. Time runs 0..1: 0 sunrise, 0.25 noon, ~0.5 sunset, 0.75 midnight.
// Colours are blended between three looks by the sun's height: day, twilight (dawn and
// dusk, the game's original pink-and-violet palette) and a blue moonlit night.

export const DAY_LENGTH = 600; // seconds
export const NEW_WORLD_TIME = 0.06; // a fresh world starts just after sunrise

interface Look {
  fog: number[];
  top: number[];
  mid: number[];
  key: number[]; // terrain key light (already scaled)
  ambLow: number[];
  ambHigh: number[];
  glow: number[]; // halo around the sun
  stars: number;
  dirCol: number; // DirectionalLight for everything else
  dirInt: number;
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
}

const DAY: Look = {
  fog: [0.79, 0.86, 0.93],
  top: [0.24, 0.46, 0.85],
  mid: [0.5, 0.7, 0.94],
  key: [1.0, 0.97, 0.9],
  ambLow: [0.46, 0.5, 0.6],
  ambHigh: [0.68, 0.74, 0.84],
  glow: [1.0, 0.95, 0.8],
  stars: 0,
  dirCol: 0xfff3e0,
  dirInt: 2.4,
  hemiSky: 0xd4e6ff,
  hemiGround: 0x6b5a42,
  hemiInt: 1.15,
};

const TWILIGHT: Look = {
  fog: [0xe9 / 255, 0xb7 / 255, 0xa6 / 255],
  top: [0.1, 0.08, 0.24],
  mid: [0.45, 0.3, 0.52],
  key: [1.05, 0.9, 0.76],
  ambLow: [0.42, 0.36, 0.55],
  ambHigh: [0.75, 0.62, 0.68],
  glow: [1.0, 0.62, 0.38],
  stars: 0.7,
  dirCol: 0xffdcb8,
  dirInt: 2.2,
  hemiSky: 0xc7a6d6,
  hemiGround: 0x5a4636,
  hemiInt: 1.1,
};

const NIGHT: Look = {
  fog: [0.11, 0.12, 0.24],
  top: [0.01, 0.015, 0.05],
  mid: [0.05, 0.06, 0.17],
  key: [0.36, 0.42, 0.66],
  ambLow: [0.13, 0.14, 0.26],
  ambHigh: [0.24, 0.27, 0.46],
  glow: [0, 0, 0],
  stars: 1.3,
  dirCol: 0xa8b8ff,
  dirInt: 0.75,
  hemiSky: 0x5a68b0,
  hemiGround: 0x1e1c2a,
  hemiInt: 0.7,
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class DayNight {
  /** 0..1 through the day. */
  time = NEW_WORLD_TIME;
  private c = new THREE.Color();
  private c2 = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
  ) {
    this.apply();
  }

  update(dt: number) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    this.apply();
  }

  /** How high the sun is (-1 below, 1 overhead). */
  get sunHeight() {
    return sharedUniforms.uSunDir.value.y;
  }

  get isNight() {
    return this.sunHeight < -0.05;
  }

  private apply() {
    const a = this.time * Math.PI * 2;
    // The sun climbs from the east-ish, arcs high to the south, and sets; the day is a bit
    // longer than the night.
    const sunDir = sharedUniforms.uSunDir.value.set(-Math.cos(a) * 0.8, Math.sin(a) * 0.85 + 0.12, -0.45).normalize();
    const e = sunDir.y;

    // Blend weights for the three looks.
    const day = smooth(0.08, 0.42, e);
    const night = 1 - smooth(-0.32, -0.02, e);
    const twi = Math.max(0, 1 - day - night);
    const mix3 = (k: 'fog' | 'top' | 'mid' | 'key' | 'ambLow' | 'ambHigh' | 'glow', out: THREE.Color) =>
      out.setRGB(
        DAY[k][0] * day + TWILIGHT[k][0] * twi + NIGHT[k][0] * night,
        DAY[k][1] * day + TWILIGHT[k][1] * twi + NIGHT[k][1] * night,
        DAY[k][2] * day + TWILIGHT[k][2] * twi + NIGHT[k][2] * night,
        THREE.LinearSRGBColorSpace, // raw: custom shaders write display values directly
      );
    const L = lightUniforms;
    mix3('fog', sharedUniforms.uFogColor.value);
    mix3('top', L.uSkyTop.value);
    mix3('mid', L.uSkyMid.value);
    mix3('key', L.uKeyCol.value);
    mix3('ambLow', L.uAmbLow.value);
    mix3('ambHigh', L.uAmbHigh.value);
    mix3('glow', L.uSunGlow.value);
    L.uStars.value = DAY.stars * day + TWILIGHT.stars * twi + NIGHT.stars * night;

    // Key light: the sun by day, the broken moon by night.
    const sunUp = smooth(-0.12, 0.1, e);
    L.uKeyDir.value.copy(MOON_DIR).lerp(sunDir, sunUp).normalize();

    // Built-in materials: scene fog (managed colour, so convert from display values) and lights.
    const fog = sharedUniforms.uFogColor.value;
    (this.scene.fog as THREE.FogExp2).color.setRGB(fog.r, fog.g, fog.b, THREE.SRGBColorSpace);
    const blendHex = (k: 'dirCol' | 'hemiSky' | 'hemiGround', out: THREE.Color) => {
      out.setHex(DAY[k]).multiplyScalar(day);
      out.add(this.c.setHex(TWILIGHT[k]).multiplyScalar(twi));
      out.add(this.c2.setHex(NIGHT[k]).multiplyScalar(night));
    };
    blendHex('dirCol', this.sun.color);
    this.sun.intensity = DAY.dirInt * day + TWILIGHT.dirInt * twi + NIGHT.dirInt * night;
    this.sun.position.copy(L.uKeyDir.value).multiplyScalar(100);
    blendHex('hemiSky', this.hemi.color);
    blendHex('hemiGround', this.hemi.groundColor);
    this.hemi.intensity = DAY.hemiInt * day + TWILIGHT.hemiInt * twi + NIGHT.hemiInt * night;
  }
}
