// The player character's appearance, chosen on the home screen. Like settings, it's kept in
// this browser and shared by every save slot.

export type Body = 'female' | 'male';
export type HairStyle = 'long' | 'braid' | 'bun' | 'short';
export type Headwear = 'antlers' | 'flowers' | 'mushroom' | 'none';
export type BackItem = 'none' | 'cape' | 'wings';

export interface Look {
  body: Body;
  hair: HairStyle;
  hairColor: string;
  skin: string;
  outfit: string;
  head: Headwear;
  back: BackItem;
}

export const HAIR_COLORS: Record<string, { name: string; base: number; tip: number }> = {
  moss: { name: 'Moss', base: 0x23574a, tip: 0x3f8a5c },
  fern: { name: 'Fern', base: 0x3c7a2a, tip: 0x72b043 },
  autumn: { name: 'Autumn', base: 0x9a4a22, tip: 0xd88238 },
  blossom: { name: 'Blossom', base: 0xc2668e, tip: 0xf2a8c6 },
  frost: { name: 'Frost', base: 0xc9d8d2, tip: 0xffffff },
  bark: { name: 'Bark', base: 0x3d2a1e, tip: 0x6b4a2b },
};

export const SKINS: Record<string, { name: string; base: number; blush: number }> = {
  mint: { name: 'Mint', base: 0xd2ecb8, blush: 0xf2a2a8 },
  sage: { name: 'Sage', base: 0xa8c88a, blush: 0xe2908c },
  birch: { name: 'Birch', base: 0xf2e6d2, blush: 0xf0a0a0 },
  acorn: { name: 'Acorn', base: 0xc08f66, blush: 0xd9786c },
  bark: { name: 'Bark', base: 0x7a5a40, blush: 0xb0605a },
};

export const OUTFITS: Record<string, { name: string; dress: number; dark: number; light: number }> = {
  forest: { name: 'Forest', dress: 0x2f6a36, dark: 0x2f7a3c, light: 0x74bf55 },
  autumn: { name: 'Autumn', dress: 0x8a4220, dark: 0xb5552a, light: 0xe8a040 },
  meadow: { name: 'Meadow', dress: 0x667f26, dark: 0x8aa83a, light: 0xd8d070 },
  twilight: { name: 'Twilight', dress: 0x3f3f7a, dark: 0x55508f, light: 0xa8a0e0 },
  blossom: { name: 'Blossom', dress: 0x8f4466, dark: 0xc26a8a, light: 0xf2b8cc },
};

export const BODY_NAMES: Record<Body, string> = { female: 'Nymph', male: 'Sylvan' };
export const HAIR_NAMES: Record<HairStyle, string> = { long: 'Long', braid: 'Braid', bun: 'Bun', short: 'Short' };
export const HEAD_NAMES: Record<Headwear, string> = {
  antlers: 'Twig antlers',
  flowers: 'Flower crown',
  mushroom: 'Toadstool hat',
  none: 'None',
};
export const BACK_NAMES: Record<BackItem, string> = { none: 'None', cape: 'Leaf cape', wings: 'Petal wings' };

export const DEFAULT_LOOK: Look = {
  body: 'female',
  hair: 'long',
  hairColor: 'moss',
  skin: 'mint',
  outfit: 'forest',
  head: 'antlers',
  back: 'none',
};

const KEY = 'dg-look';

function pick<T extends string>(v: unknown, options: Record<T, unknown>, def: T): T {
  return typeof v === 'string' && v in options ? (v as T) : def;
}

function read(): Look {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      body: pick(d.body, BODY_NAMES, DEFAULT_LOOK.body),
      hair: pick(d.hair, HAIR_NAMES, DEFAULT_LOOK.hair),
      hairColor: pick(d.hairColor, HAIR_COLORS, DEFAULT_LOOK.hairColor),
      skin: pick(d.skin, SKINS, DEFAULT_LOOK.skin),
      outfit: pick(d.outfit, OUTFITS, DEFAULT_LOOK.outfit),
      head: pick(d.head, HEAD_NAMES, DEFAULT_LOOK.head),
      back: pick(d.back, BACK_NAMES, DEFAULT_LOOK.back),
    };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export const look: Look = read();

export function updateLook(patch: Partial<Look>) {
  Object.assign(look, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    /* the look just won't stick */
  }
}
