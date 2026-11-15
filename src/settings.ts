// Player settings, shared by every save slot and kept in this browser.

export type ViewDistance = 'low' | 'medium' | 'high';

export interface Settings {
  music: number; // 0..1
  sfx: number; // 0..1
  view: ViewDistance;
  grid: boolean; // grid lines on the tool's footprint on the ground
  lookSpeed: number; // mouse/touch look sensitivity, 1 = normal (0.25..3)
  invertY: boolean; // moving the mouse (or finger) up looks down
}

/** How much of the full draw distance each setting keeps. */
export const VIEW_SCALE: Record<ViewDistance, number> = { low: 0.5, medium: 0.75, high: 1 };

const KEY = 'dg-settings';
const DEFAULTS: Settings = { music: 0.5, sfx: 0.8, view: 'high', grid: true, lookSpeed: 1, invertY: false };

function read(): Settings {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      music: typeof d.music === 'number' ? Math.min(1, Math.max(0, d.music)) : DEFAULTS.music,
      sfx: typeof d.sfx === 'number' ? Math.min(1, Math.max(0, d.sfx)) : DEFAULTS.sfx,
      view: d.view in VIEW_SCALE ? d.view : DEFAULTS.view,
      grid: typeof d.grid === 'boolean' ? d.grid : DEFAULTS.grid,
      lookSpeed: typeof d.lookSpeed === 'number' ? Math.min(3, Math.max(0.25, d.lookSpeed)) : DEFAULTS.lookSpeed,
      invertY: typeof d.invertY === 'boolean' ? d.invertY : DEFAULTS.invertY,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = read();
const listeners: ((s: Settings) => void)[] = [];

export function onSettings(fn: (s: Settings) => void) {
  listeners.push(fn);
  fn(settings);
}

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* settings just won't stick */
  }
  for (const fn of listeners) fn(settings);
}
