// Save slots. Slot 1 keeps the original save key so existing worlds carry over.

export const SLOT_COUNT = 4;
const LAST_KEY = 'dg-last-slot';

export function slotKey(i: number) {
  return i === 0 ? 'druid-grove-planet-v3' : `druid-grove-planet-v3-s${i + 1}`;
}

export interface SlotInfo {
  planetPct: number | null; // null for saves made before this was recorded
  glades: number;
  pollen: number;
  honey: number;
  savedAt: number | null;
  playTime: number; // seconds
  mounts: string[];
}

export function slotInfo(i: number): SlotInfo | null {
  try {
    const raw = localStorage.getItem(slotKey(i));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      planetPct: typeof d.planetPct === 'number' ? d.planetPct : null,
      glades: (d.completed ?? []).length,
      pollen: d.pollen ?? 0,
      honey: d.honey ?? 0,
      savedAt: d.savedAt ?? null,
      playTime: d.extra?.playTime ?? 0,
      mounts: d.mounts ?? [],
    };
  } catch {
    return null;
  }
}

export function deleteSlot(i: number) {
  try {
    localStorage.removeItem(slotKey(i));
  } catch {
    /* ignore */
  }
}

export function lastSlot(): number {
  try {
    const n = Number(localStorage.getItem(LAST_KEY));
    return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT ? n : 0;
  } catch {
    return 0;
  }
}

export function setLastSlot(i: number) {
  try {
    localStorage.setItem(LAST_KEY, String(i));
  } catch {
    /* ignore */
  }
}
