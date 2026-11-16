import * as THREE from 'three';
import { Apiary } from './apiary';
import { Bot } from './bot';
import { Colliders } from './colliders';
import { Economy, HIVE, MOUNTS, RING, TOOLS, UPGRADES, UpgradeGroup } from './economy';
import {
  BACK_NAMES,
  BODY_NAMES,
  HAIR_COLORS,
  HAIR_NAMES,
  HEAD_NAMES,
  Look,
  look,
  OUTFITS,
  SKINS,
  updateLook,
} from './look';
import { LookPreview } from './lookPreview';
import { DayNight, NEW_WORLD_TIME } from './daynight';
import { Perf } from './perf';
import { onSettings, settings, updateSettings, VIEW_SCALE, ViewDistance } from './settings';
import { deleteSlot, lastSlot, setLastSlot, SLOT_COUNT, slotInfo, slotKey } from './slots';
import { planetizeTree, planetUniforms } from './planet';
import { Waystone, Waystones } from './waystones';
import { SPECIES, Wildlife } from './wildlife';
import { FairyRings, Ring } from './fairies';
import { Chimes, Particles, Song } from './fx';
import { Flowers } from './flowers';
import { COMPLETE_AT, Garden } from './garden';
import { Player } from './player';
import { TouchControls, wantsTouch } from './touch';
import { Cloud } from './cloud';
import { Tips, TIPS_DONE } from './tips';
import { DeadScenery, HeartTrees } from './props';
import { createSky, restoreMoon } from './sky';
import { Ending } from './ending';
import { Obelisk } from './obelisk';
import { Stations } from './stations';
import { createTerrain, cursorUniforms, FOG_HEX, MAX_ZONES, sharedUniforms } from './terrain';
import { HALF, SOIL_NAMES, Soil, wdist, World, wrap } from './world';

/** Inline icons (drawn in style.css). */
const HONEY = '<i class="i-honey"></i>';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Playing with touch controls (phones, tablets). Words for keys say what to tap instead. */
const TOUCH = wantsTouch();
// The itch.io build (npm run build:itch) is served from itch's domain, so the game's server
// (cloud saves) isn't reachable from it: that option is hidden there.
if (import.meta.env.MODE === 'itch') document.body.classList.add('itch');
const botQuery = new URLSearchParams(location.search);
const say = (keys: string, touch: string) => (TOUCH ? touch : keys);

/** Worlds copied to the server (see cloud.ts); off until the player turns it on. */
const cloud = new Cloud();

/** The few starting tips (see tips.ts), in order. */
let plantTime = 0; // seconds spent planting, for the first tip
const tips = new Tips([
  {
    text: () =>
      `${say('Hold the mouse button', 'Hold <b>Plant</b>')} to press seeds into the grey dirt. They bloom into flowers, and flowers make pollen.`,
    done: 'planted',
  },
  {
    text: () => 'Running low on seeds. Go back to the glowing <b>Seed Hollow</b> (⌂ on the compass) to refill.',
    when: () => !econ.riding && econ.seeds < econ.seedCap * 0.3,
    done: 'refilled',
  },
  {
    text: () =>
      `You can afford a new tool. Visit the <b>Verdant Obelisk</b> by the Hollow and ${say('press <b>E</b>', 'tap <b>Trade</b>')}.`,
    when: () => {
      const costs = TOOLS.filter((t) => !econ.tools.has(t.id)).map((t) => t.cost);
      return !costs.length || econ.pollen >= Math.min(...costs);
    },
    done: 'shopped',
  },
  {
    text: () => `${say('Scroll', 'Pinch')} to zoom out and see how much of the world is still grey.`,
    done: 'zoomed',
  },
  {
    text: () =>
      `${say('Press <b>B</b>', 'Tap <b>Build</b>')} and pick a <b>Squirrel Cache</b>: it keeps your seeds topped up far from home.`,
    when: () => econ.pollen >= econ.cacheCost,
    done: 'built',
  },
]);

// ---------- scene ----------
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_HEX, sharedUniforms.uFogDensity.value);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);
scene.add(camera);

const sun = new THREE.DirectionalLight(0xffdcb8, 2.2);
const hemi = new THREE.HemisphereLight(0xc7a6d6, 0x5a4636, 1.1);
scene.add(sun, hemi);
const dayNight = new DayNight(scene, sun, hemi); // moves the sun and recolours sky, haze and light

const tScript = performance.now();
const world = new World();
const tWorld = performance.now();
const colliders = new Colliders();
const terrain = createTerrain(world);
scene.add(terrain.mesh);
const sky = createSky();
sky.userData.noPlanet = true; // the sky stays put around the camera
scene.add(sky);
const scenery = new DeadScenery(world, colliders);
scene.add(scenery.group);

const flowers = new Flowers(world);
scene.add(flowers.group);
const hearts = new HeartTrees(world, colliders);
scene.add(hearts.group);
const particles = new Particles();
scene.add(particles.points);

const econ = new Economy();
const chimes = new Chimes();
const player = new Player(world, camera, colliders);
// The ending: the dragon wakes and mends the moon once the whole planet is green.
const ending = new Ending({
  scene,
  camera,
  chimes,
  playerPos: player.pos,
  groundAt: (x, z) => world.heightAt(x, z),
  setTimeOfDay: (t) => (dayNight.time = t),
  isClear: (x, z, r) => colliders.clear(x, z, r),
  teleport: (x, z) => {
    player.pos.set(x, world.heightAt(x, z), z);
  },
});
let moonRestored = false;
// Stonebreaker Hooves: the stag smashes boulders instead of stopping at them.
let lastCrunch = 0;
player.trample = (x, z, r) => {
  if (econ.riding !== 'stag' || !econ.level('trample')) return;
  scenery.trample(x, z, r + 0.25, (rx, ry, rz, size) => {
    particles.burst(rx, ry, rz, 0x8a8590, 8 + Math.round(size * 10), 0.5 + size, 2.2);
    const now = performance.now();
    if (now - lastCrunch > 90) {
      lastCrunch = now;
      chimes.crunch();
    }
  });
};
scene.add(player.model);
const stations = new Stations(world, econ, colliders);
scene.add(stations.group);

// ---------- HUD ----------
let toastTimer = 0;
let pollenPulse = false;
let newsTimer = 0;
let brookTimer = 0;
/** Water has run in some creek of this world (so the news is only told once). */
let hadWater = false;
const BROOK_EAR = 14; // metres a running creek can be heard from
/** The synthesised brook is off until a recorded babbling-brook sound replaces it. */
const BROOK_SOUND = false;

/** How loud running water is where she stands: 1 beside a creek, fading to 0 at BROOK_EAR. */
function brookLevel() {
  let best = BROOK_EAR;
  const { x, z } = player.pos;
  for (let dz = -BROOK_EAR; dz <= BROOK_EAR; dz += 2)
    for (let dx = -BROOK_EAR; dx <= BROOK_EAR; dx += 2) {
      const d = Math.hypot(dx, dz);
      if (d >= best) continue;
      const t = world.tileAt(x + dx, z + dz);
      if (world.wet[t] > 128) best = d;
    }
  return Math.pow(1 - best / BROOK_EAR, 1.5);
}
/** A line of news under the toasts (wildlife returning), with a soft chime. */
function news(msg: string) {
  const el = $('news');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(newsTimer);
  newsTimer = window.setTimeout(() => el.classList.remove('show'), 7000);
  chimes.shop('planting');
}

function toast(msg: string, big = false) {
  const el = $('toast');
  el.innerHTML = msg; // our own strings; may contain icon markup
  el.className = 'show' + (big ? ' big' : '');
  toastTimer = big ? 5 : 2.5;
}

const garden = new Garden(world, econ, flowers, hearts, scenery, particles, chimes, {
  toast,
  // Pulsing the counter forces a layout, so it's done at most once per HUD tick
  // rather than once per bloom (thousands per second when glades are restored).
  earned: () => {
    pollenPulse = true;
  },
  waterFlows: () => {
    if (hadWater || !started) return;
    hadWater = true;
    news('Water is running in the creeks again.');
  },
});

const apiary = new Apiary(world, econ, colliders);
scene.add(apiary.group);
const fairies = new FairyRings(world, econ, garden, stations, particles);
scene.add(fairies.group);
// Animals come back as the planet recovers (fewer on phones).
const wildlife = new Wildlife(world, TOUCH ? 0.6 : 1);
scene.add(wildlife.group);
const waystones = new Waystones(world, colliders);
scene.add(waystones.group);
// The shop: a great stone obelisk near home, and any more raised out in the world.
const obelisks = [new Obelisk(world, colliders)];
scene.add(obelisks[0].group);
/** The obelisk she's standing at, if any. */
const obeliskHere = () => obelisks.find((o) => o.nearby(player.pos)) ?? null;
/** Obelisks (the shops) need this much room between them. */
const OBELISK_SPACING = 40;
function addObelisk(x: number, z: number) {
  const glade = world.glades[world.gladeOf[world.tileAt(x, z)]];
  const o = new Obelisk(world, colliders, x, z, `Obelisk · ${glade.name}`);
  obelisks.push(o);
  scene.add(o.group);
  return o;
}
stations.extraHubs = () => waystones.stones.map((w) => ({ x: w.x, z: w.z, label: w.label }));

interface SaveExtra {
  caches: { x: number; z: number; stock: number }[];
  hives?: { x: number; z: number; honey: number }[];
  rings?: { x: number; z: number }[];
  dens?: { x: number; z: number }[]; // beyond the home den
  bearHomes?: number[];
  stones?: { x: number; z: number }[]; // beyond the home waystone
  obelisks?: { x: number; z: number }[]; // beyond the home obelisk
  trampled?: number[]; // tiles whose boulder the stag smashed
  playTime?: number; // seconds played in this world
  timeOfDay?: number; // 0..1 through the day/night cycle
  moonRestored?: boolean; // reached 100% and saw the dragon mend the moon
  tips?: number; // how far through the starting tips (TIPS_DONE when finished or hidden)
  challenges?: Challenges;
}

/**
 * Things the player has done at least once in this world, for challenge achievements:
 * "Home Sweet Home" (never build a waystone), "Lonely Bears" (never hire a bear; the free
 * ones from the first hive and from dens don't count), "Fairies are Forever" (never remove
 * a fairy ring).
 */
interface Challenges {
  waystone: boolean;
  bear: boolean;
  ringRemoved: boolean;
  /** Worlds saved before tracking began can't tell whether a ring was ever removed. */
  ringsUnknown?: boolean;
}

// The world is generated up front (it's the same planet for every slot); the save
// for the chosen slot is applied on top when the player picks one on the home screen.
let activeSlot = -1;
let challenges: Challenges = { waystone: false, bear: false, ringRemoved: false };
let loaded: { extra: unknown } | null = null;
let playTime = 0;
function loadSlot(i: number) {
  activeSlot = i;
  garden.key = slotKey(i);
  loaded = garden.load(player);
  const extra = loaded?.extra as SaveExtra | undefined;
  if (extra) {
    for (const c of extra.caches ?? []) stations.build(c.x, c.z, c.stock);
    for (const d of extra.dens ?? []) apiary.buildDen(d.x, d.z);
    for (const h of extra.hives ?? []) apiary.build(h.x, h.z, h.honey);
    for (const r of extra.rings ?? []) fairies.build(r.x, r.z);
    for (const w of extra.stones ?? []) waystones.build(w.x, w.z);
    for (const o of extra.obelisks ?? []) addObelisk(o.x, o.z);
    for (const t of extra.trampled ?? []) scenery.smash(t);
    playTime = extra.playTime ?? 0;
  }
  dayNight.time = extra?.timeOfDay ?? NEW_WORLD_TIME;
  moonRestored = extra?.moonRestored ?? false;
  // Worlds from before the tips existed only get them if they've barely started.
  tips.reset(extra?.tips ?? (loaded && econ.lifetimePollen > 500 ? TIPS_DONE : 0));
  // Older worlds: work out what can be known from what's built and bought.
  challenges = extra?.challenges ?? {
    waystone: econ.stonesBuilt > 0,
    bear: econ.bears > (econ.hivesBuilt > 0 ? 1 : 0) + econ.densBuilt,
    ringRemoved: false,
    ...(loaded && econ.ringsBuilt > 0 ? { ringsUnknown: true } : {}),
  };
  restoreMoon(moonRestored ? 1 : 0);
  // Boulders can't sit inside a den mound (older saves may have some).
  for (const d of apiary.dens) scenery.trample(d.x, d.z, 4.5, () => {});
  apiary.syncBears(extra?.bearHomes);
  fairies.syncFairies(); // wayfarers
  flowers.reset(); // chunks streamed in behind the home screen predate the save
  wildlife.reset(Wildlife.stageAt(planetProgress().pct));
  hadWater = world.glades.some((g) => g.completed && g.total > 0); // the ones already back don't announce again
  player.setTool(econ.current);
  player.setArmor(econ.level('armor') > 0);
  player.ride(econ.mount);
  renderHotbar();
}

/** Planet-wide restoration: bloomed share of all plantable land, and glades restored. */
const planetTotal = world.glades.reduce((n, g) => n + g.total, 0);
const tReady = performance.now();
const realGlades = world.glades.filter((g) => g.total > 0).length;
function planetProgress() {
  let bloomed = 0;
  let done = 0;
  for (const g of world.glades) {
    bloomed += g.bloomed;
    if (g.completed && g.total > 0) done++;
  }
  return { pct: (100 * bloomed) / planetTotal, done };
}
player.setTool(econ.current);
player.ride(econ.mount);

function fmt(n: number) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString();
  const units = ['K', 'M', 'B', 'T'];
  let u = -1;
  let v = n;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return v.toFixed(v < 100 ? 1 : 0) + units[u];
}

// Hotbar: slots 1-3 are tools, 4-5 are mounts.
const SLOTS = [
  ...TOOLS.map((t) => ({ kind: 'tool' as const, def: t })),
  ...MOUNTS.map((m) => ({ kind: 'mount' as const, def: m })),
];

function renderHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  SLOTS.forEach((s, i) => {
    const owned = s.kind === 'tool' ? econ.tools.has(s.def.id) : econ.mounts.has(s.def.id);
    const active = s.kind === 'tool' ? !econ.riding && econ.current === s.def.id : econ.riding === s.def.id;
    const d = document.createElement('div');
    d.className = 'slot' + (active ? ' active' : '') + (owned ? '' : ' locked');
    const name = s.kind === 'mount' ? s.def.name.split(' ').pop() : s.def.name;
    d.innerHTML = `<div class="k">${i + 1}</div><div>${name}</div>${owned ? '' : `<div class="k">✿ ${fmt(s.def.cost)}</div>`}`;
    d.onpointerdown = (e) => {
      e.preventDefault();
      if (started && !menuOpen) selectSlot(i);
    };
    bar.appendChild(d);
  });
}

function selectSlot(i: number) {
  const s = SLOTS[i];
  if (!s) return;
  if (s.kind === 'tool') {
    if (!econ.tools.has(s.def.id)) return;
    econ.current = s.def.id;
    econ.riding = null;
    player.setTool(s.def.id);
    player.ride(null);
  } else {
    if (!econ.mounts.has(s.def.id)) return;
    if (econ.riding === s.def.id) {
      econ.riding = null;
      player.ride(null);
    } else {
      econ.riding = s.def.id;
      player.ride(s.def);
      const [x, z] = [player.pos.x, player.pos.z];
      particles.burst(x, world.heightAt(x, z) + 0.5, z, 0xd8ffb0, 60, 2, 2);
      if (econ.autoPlant) toast(`Riding the ${s.def.name}. It plants as it walks (${say('F', 'Auto')} to toggle).`);
    }
  }
  renderHotbar();
}

/** Shop buttons and whether each can be bought now; re-checked every second while the shop is open. */
let shopButtons: { button: HTMLButtonElement; can: () => boolean }[] = [];

function card(name: string, desc: string, label: string, can: () => boolean, onBuy: () => void) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<div class="name">${name}</div><div class="desc">${desc}</div>`;
  const b = document.createElement('button');
  b.innerHTML = label;
  b.disabled = !can();
  b.onclick = onBuy;
  el.appendChild(b);
  shopButtons.push({ button: b, can });
  return el;
}

/** Light up anything that's become affordable (or dim what no longer is) without rebuilding the shop. */
function refreshShopButtons() {
  for (const { button, can } of shopButtons) button.disabled = !can();
  renderShopTabs();
}

// ---------- shop pages ----------
const shopPages = [...document.querySelectorAll<HTMLElement>('#shop .shop-page')];
let shopPage = (() => {
  try {
    return localStorage.getItem('dg-shop-page') ?? 'tools';
  } catch {
    return 'tools';
  }
})();
if (!shopPages.some((p) => p.dataset.page === shopPage)) shopPage = 'tools';
const shopTabs = shopPages.map((page) => {
  const b = document.createElement('button');
  b.innerHTML = page.dataset.title!;
  b.onclick = () => {
    shopPage = page.dataset.page!;
    try {
      localStorage.setItem('dg-shop-page', shopPage);
    } catch {
      /* fine */
    }
    renderShopTabs();
  };
  $('shop-tabs').appendChild(b);
  return { b, page };
});
/** Show the chosen page; dot the tabs with something affordable on them. */
function renderShopTabs() {
  for (const { b, page } of shopTabs) {
    const on = page.dataset.page === shopPage;
    b.classList.toggle('on', on);
    page.classList.toggle('hidden', !on);
    b.classList.toggle(
      'can',
      !on && [...page.querySelectorAll<HTMLButtonElement>('.card button')].some((x) => !x.disabled),
    );
  }
}

function renderShop() {
  shopButtons = [];
  $('shop-pollen').textContent = fmt(econ.pollen);
  $('shop-honey').textContent = fmt(econ.honey);
  // (No sound given: the purchase makes its own, like a bear's growl.)
  const bought = (msg: string, sound?: Parameters<typeof chimes.shop>[0]) => {
    if (sound) chimes.shop(sound);
    tips.flag('shopped');
    toast(msg);
    renderShop();
    renderHotbar();
  };

  const tools = $('shop-tools');
  tools.innerHTML = '';
  for (const t of TOOLS) {
    if (t.cost === 0) continue;
    const owned = econ.tools.has(t.id);
    tools.appendChild(
      card(
        t.name,
        t.blurb,
        owned ? 'Owned' : `✿ ${fmt(t.cost)}`,
        () => !owned && econ.pollen >= t.cost,
        () => {
          if (econ.buyTool(t)) {
            econ.riding = null;
            player.ride(null);
            player.setTool(t.id);
            bought(`${t.name} acquired!`, 'tool');
          }
        },
      ),
    );
  }

  const mounts = $('shop-mounts');
  mounts.innerHTML = '';
  MOUNTS.forEach((m, i) => {
    const owned = econ.mounts.has(m.id);
    const needs = !econ.has(m.requires);
    const desc = `${m.blurb}<br>Plants a ${m.radius * 2}m circle · carries ${fmt(econ.mountCap(m))} seeds`;
    const label = owned ? 'Owned' : needs ? `Requires ${econ.nameOf(m.requires)}` : `✿ ${fmt(m.cost)}`;
    mounts.appendChild(
      card(
        m.name,
        desc,
        label,
        () => !owned && !needs && econ.pollen >= m.cost,
        () => {
          if (econ.buyMount(m))
            bought(
              `${m.name} joined you! ${say(`Press ${TOOLS.length + i + 1}`, 'Tap it in the bar')} to ride.`,
              'mount',
            );
        },
      ),
    );
  });

  const hives = $('shop-hives');
  hives.innerHTML = '';
  {
    const needs = !econ.has('hive');
    const cost = econ.bearCost;
    hives.appendChild(
      card(
        `Hire a Bear <span class="desc">${econ.bears} working</span>`,
        `Bears carry honey from your hives back to their den. Each carries ${econ.bearCarry}. New bears move into the den with the most hives per bear.`,
        needs ? say('Build a Beehive first (H)', 'Build a Beehive first') : `✿ ${fmt(cost)}`,
        () => !needs && econ.pollen >= cost,
        () => {
          if (econ.pollen < econ.bearCost) return;
          econ.pollen -= econ.bearCost;
          econ.bears++;
          challenges.bear = true;
          apiary.syncBears();
          chimes.growl();
          const den = apiary.bears[apiary.bears.length - 1].den;
          bought(
            `A bear lumbers out of the ${den === apiary.home ? 'home den' : den.label.replace('Bear Den · ', 'den at ')}.`,
          );
        },
      ),
    );
  }

  const groups: UpgradeGroup[] = ['mounts', 'planting', 'seeds', 'squirrels', 'soil', 'hives', 'fairies'];
  for (const grp of groups) {
    const box = $(`shop-${grp}`);
    if (grp !== 'hives' && grp !== 'mounts') box.innerHTML = ''; // (those already hold other cards)
    for (const u of UPGRADES.filter((x) => x.group === grp)) {
      const lvl = econ.level(u.id);
      const maxed = lvl >= u.max;
      const needs = u.requires && !econ.has(u.requires);
      const cost = econ.upgradeCost(u);
      const name = u.max > 1 ? `${u.name} <span class="desc">Lv ${lvl}/${u.max}</span>` : u.name;
      const honey = u.currency === 'honey';
      let label = `${honey ? HONEY : '✿'} ${fmt(cost)}`;
      if (maxed) label = u.max === 1 ? 'Owned' : 'Maxed';
      else if (needs) label = `Requires ${econ.nameOf(u.requires!)}`;
      box.appendChild(
        card(
          name,
          u.blurb(lvl),
          label,
          () => !maxed && !needs && econ.wallet(u.currency) >= cost,
          () => {
            if (econ.buyUpgrade(u)) {
              if (u.id === 'family') stations.syncSquirrels();
              if (u.id === 'flock') fairies.syncFairies();
              if (u.id === 'armor') {
                player.setArmor(true);
                return bought('Horse Armor equipped. The Bramble Stag is not a horse, but it looks magnificent.', grp);
              }
              bought(`${u.name}${u.max > 1 ? ` Lv ${econ.level(u.id)}` : ''}`, grp);
            }
          },
        ),
      );
    }
  }

  // The wayfarer: an expensive fairy with no ring, roaming the planet for missed ground.
  // Listed last: early on, ring fairies are the better buy.
  const cost = econ.wayfarerCost;
  const needs = !econ.has('ring');
  $('shop-fairies').append(
    card(
      `Wayfarer Fairy <span class="desc">${econ.wayfarers} roaming</span>`,
      `No ring and no range: wanders the whole planet planting any bare ground no ring covers. Flies faster and carries twice as many seeds.`,
      needs ? 'Requires a Fairy Ring' : `${HONEY} ${fmt(cost)}`,
      () => !needs && econ.honey >= cost,
      () => {
        if (econ.honey < econ.wayfarerCost) return;
        econ.honey -= econ.wayfarerCost;
        econ.wayfarers++;
        fairies.syncFairies();
        bought('A wayfarer fairy sets out from the Seed Hollow.', 'fairies');
      },
    ),
  );
  renderShopTabs();
}

/** Where a structure would go: the cursor on foot, or under the mount. Returns null + toasts on failure. */
function placement(): [number, number] | null {
  let x = player.pos.x;
  let z = player.pos.z;
  if (!econ.riding && garden.aimValid) {
    const d = wdist(x, z, garden.aim.x, garden.aim.z);
    if (d > 8) {
      toast('Too far away to build there.');
      return null;
    }
    x = garden.aim.x;
    z = garden.aim.z;
  }
  const t = world.tileAt(x, z);
  if (t < 0 || world.soil[t] === Soil.Creek) {
    toast("Can't build in a creek bed.");
    return null;
  }
  const why = stations.canBuildAt(x, z) ?? apiary.canBuildAt(x, z) ?? fairies.canBuildAt(x, z) ?? stoneNear(x, z);
  if (why) {
    toast(why + '.');
    return null;
  }
  return [x, z];
}

function afford(cost: number, have: number, what: string) {
  if (have >= cost) return true;
  chimes.deny();
  toast(`${what} costs ${fmt(cost)}.`);
  return false;
}

function built(x: number, z: number, color: number, msg: string) {
  chimes.purchase();
  tips.flag('built');
  particles.burst(x, world.heightAt(x, z) + 1, z, color, 50, 1.5, 2);
  toast(msg);
}

function buildCache() {
  const p = placement();
  if (!p || !afford(econ.cacheCost, econ.pollen, 'A squirrel cache ✿')) return;
  econ.pollen -= econ.cacheCost;
  econ.cachesBuilt++;
  stations.build(p[0], p[1]);
  built(p[0], p[1], 0xffd36b, `Squirrel cache built! Next one costs ✿ ${fmt(econ.cacheCost)}.`);
}

function buildHive() {
  if (!econ.has('rake')) return toast('Beehives need the Rake first.');
  const p = placement();
  if (!p) return;
  const taken = apiary.hiveBlockedAt(p[0], p[1]);
  if (taken) {
    chimes.deny();
    return toast(`${taken}. Only one hive per glade.`);
  }
  if (!afford(econ.hiveCost, econ.pollen, 'A beehive ✿')) return;
  econ.pollen -= econ.hiveCost;
  econ.hivesBuilt++;
  apiary.build(p[0], p[1]);
  let msg = `Beehive built! Bees forage blooms within ${HIVE.radius}m. One hive per glade. Next hive ✿ ${fmt(econ.hiveCost)}.`;
  if (econ.bears === 0) {
    econ.bears = 1;
    apiary.syncBears();
    msg = 'Beehive built! A bear has moved into the den to carry the honey home.';
  }
  built(p[0], p[1], 0xffb627, msg);
}

function buildRing() {
  if (!econ.has('hive')) return toast(`Fairy rings cost honey. Build a Beehive${say(' (H)', '')} first.`);
  const p = placement();
  if (!p || !afford(econ.ringCost, econ.honey, `A fairy ring ${HONEY}`)) return;
  econ.honey -= econ.ringCost;
  econ.ringsBuilt++;
  fairies.build(p[0], p[1]);
  built(
    p[0],
    p[1],
    0xe0b8ff,
    `Fairy ring built! Its fairies plant everything within ${econ.ringRadius}m (G lists your rings). Next ring ${HONEY} ${fmt(econ.ringCost)}.`,
  );
}

function stoneNear(x: number, z: number) {
  for (const w of waystones.stones) if (wdist(w.x, w.z, x, z) < 6) return 'Too close to a waystone';
  for (const o of obelisks) if (wdist(o.x, o.z, x, z) < 7) return 'Too close to an obelisk';
  return null;
}

function buildObelisk() {
  if (!econ.has('rake')) return toast('Obelisks need the Rake first.');
  const p = placement();
  if (!p) return;
  const close = obelisks.find((o) => wdist(o.x, o.z, p[0], p[1]) < OBELISK_SPACING);
  if (close) {
    chimes.deny();
    return toast(`Too close to ${close.label}. Obelisks need ${OBELISK_SPACING}m between them.`);
  }
  if (!afford(econ.obeliskCost, econ.pollen, 'An obelisk ✿')) return;
  econ.pollen -= econ.obeliskCost;
  econ.obelisksBuilt++;
  const o = addObelisk(p[0], p[1]);
  built(p[0], p[1], 0x9cf07a, `${o.label} raised! Trade at it just like the one at home.`);
}

function buildDen() {
  if (!econ.has('hive')) return toast('Build a Beehive first. Dens are for bears.');
  const p = placement();
  if (!p) return;
  const why = apiary.denBlockedAt(p[0], p[1]);
  if (why) {
    chimes.deny();
    return toast(`${why}. Dens need 40m between them.`);
  }
  if (!afford(econ.denCost, econ.pollen, 'A bear den ✿')) return;
  econ.pollen -= econ.denCost;
  econ.densBuilt++;
  const den = apiary.buildDen(p[0], p[1]);
  scenery.trample(den.x, den.z, 4.5, () => {}); // clear boulders out of the mound
  econ.bears++;
  apiary.syncBears([], den);
  built(p[0], p[1], 0xffa02b, `${den.label} built, and a bear moved in. Bears pick hives near their own den.`);
}

function buildStone() {
  if (!econ.has('rake')) return toast('Waystones need the Rake first.');
  const p = placement();
  if (!p) return;
  const why = waystones.canBuildAt(p[0], p[1]);
  if (why) {
    chimes.deny();
    return toast(`${why}. Waystones need 30m between them.`);
  }
  if (!afford(econ.stoneCost, econ.pollen, 'A waystone ✿')) return;
  econ.pollen -= econ.stoneCost;
  econ.stonesBuilt++;
  challenges.waystone = true;
  const st = waystones.build(p[0], p[1]);
  built(
    p[0],
    p[1],
    0x8fe8ff,
    `${st.label} raised! Stand in any waystone and ${say('press E', 'tap Travel')} to travel.`,
  );
}

// ---------- build menu (B) ----------
interface BuildOption {
  name: string;
  cost: () => string;
  ok: () => boolean;
  build: () => void;
}
const BUILDS: BuildOption[] = [
  {
    name: 'Squirrel Cache',
    cost: () => `✿ ${fmt(econ.cacheCost)}`,
    ok: () => econ.pollen >= econ.cacheCost,
    build: buildCache,
  },
  {
    name: 'Beehive',
    cost: () => (econ.has('rake') ? `✿ ${fmt(econ.hiveCost)}` : 'needs the Rake'),
    ok: () => econ.has('rake') && econ.pollen >= econ.hiveCost,
    build: buildHive,
  },
  {
    name: 'Fairy Ring',
    cost: () => (econ.has('hive') ? `${HONEY} ${fmt(econ.ringCost)}` : 'needs a hive'),
    ok: () => econ.has('hive') && econ.honey >= econ.ringCost,
    build: buildRing,
  },
  {
    name: 'Bear Den',
    cost: () => (econ.has('hive') ? `✿ ${fmt(econ.denCost)}` : 'needs a hive'),
    ok: () => econ.has('hive') && econ.pollen >= econ.denCost,
    build: buildDen,
  },
  {
    name: 'Waystone',
    cost: () => (econ.has('rake') ? `✿ ${fmt(econ.stoneCost)}` : 'needs the Rake'),
    ok: () => econ.has('rake') && econ.pollen >= econ.stoneCost,
    build: buildStone,
  },
  {
    name: 'Obelisk',
    cost: () => (econ.has('rake') ? `✿ ${fmt(econ.obeliskCost)}` : 'needs the Rake'),
    ok: () => econ.has('rake') && econ.pollen >= econ.obeliskCost,
    build: buildObelisk,
  },
];
let buildOpen = false;

function showBuild(open: boolean) {
  buildOpen = open;
  $('build').classList.toggle('hidden', !open);
  if (open) renderBuild();
}

// Tap a build option (it's redrawn constantly, so listen on the list).
$('build-list').addEventListener('pointerdown', (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.build-opt');
  const opt = row && BUILDS[Number(row.dataset.i)];
  if (!opt) return;
  e.preventDefault();
  showBuild(false);
  opt.build();
});
$('build-close').onclick = () => showBuild(false);

function renderBuild() {
  $('build-list').innerHTML = BUILDS.map(
    (b, i) =>
      `<div class="build-opt${b.ok() ? '' : ' no'}" data-i="${i}"><span class="k">${i + 1}</span>${b.name}<span class="cost">${b.cost()}</span></div>`,
  ).join('');
}

// ---------- waystone travel (E in a waystone) ----------
function renderTravel(here: Waystone) {
  const list = $('travel-list');
  list.innerHTML = '';
  const stones = [...waystones.stones].sort(
    (a, b) => wdist(here.x, here.z, a.x, a.z) - wdist(here.x, here.z, b.x, b.z),
  );
  for (const st of stones) {
    const row = document.createElement('div');
    row.className = 'ring-row';
    const info = document.createElement('div');
    info.className = 'ring-info';
    const dist = Math.round(wdist(here.x, here.z, st.x, st.z));
    const glade = world.glades[world.gladeOf[world.tileAt(st.x, st.z)]];
    info.innerHTML = `<div class="name">${st.label}</div><div class="desc">${
      st === here
        ? 'You are here'
        : `${dist}m ${bearingName(here, st)} · ${glade.completed ? 'restored' : `${Math.floor((100 * glade.bloomed) / Math.max(1, glade.total))}% planted`}`
    }</div>`;
    const btn = document.createElement('button');
    btn.textContent = st === here ? 'Here' : 'Travel';
    btn.disabled = st === here;
    btn.onclick = () => travel(st);
    row.append(info, btn);
    list.appendChild(row);
  }
}

function bearingName(from: { x: number; z: number }, to: { x: number; z: number }) {
  const deg = (Math.atan2(wrap(to.x - from.x), -wrap(to.z - from.z)) * 180) / Math.PI;
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][
    ((Math.round(deg / 45) % 8) + 8) % 8
  ];
}

function travel(st: Waystone) {
  const [x, z] = waystones.arrival(st);
  particles.burst(player.pos.x, player.pos.y + 1, player.pos.z, 0x8fe8ff, 80, 1.2, 2);
  player.pos.set(x, world.heightAt(x, z), z);
  player.vel.set(0, 0, 0);
  player.yaw = Math.PI; // face away from the arch
  particles.burst(x, world.heightAt(x, z) + 1, z, 0x8fe8ff, 120, 1.5, 3);
  const flash = $('flash');
  flash.classList.remove('go');
  void flash.offsetWidth;
  flash.classList.add('go');
  chimes.fanfare();
  openMenu(null);
  toast(`Arrived at ${st.label}.`);
}

// ---------- compass ----------
const COMPASS_W = 560;
const COMPASS_FOV = 180;
const camDir = new THREE.Vector3();

function renderCompass() {
  camera.getWorldDirection(camDir);
  const heading = (Math.atan2(camDir.x, -camDir.z) * 180) / Math.PI;
  const px = COMPASS_W / COMPASS_FOV;
  const rel = (deg: number) => ((((deg - heading) % 360) + 540) % 360) - 180;
  let html = '';
  for (let d = 0; d < 360; d += 15) {
    const r = rel(d);
    if (Math.abs(r) > COMPASS_FOV / 2) continue;
    const label = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][d / 45];
    const x = COMPASS_W / 2 + r * px;
    html +=
      d % 45 === 0
        ? `<span class="cp-card${d === 0 ? ' n' : ''}" style="left:${x}px">${label}</span>`
        : `<span class="cp-tick" style="left:${x}px"></span>`;
  }
  const mark = (tx: number, tz: number, cls: string, glyph: string, label = '', clamp = false) => {
    const dx = wrap(tx - player.pos.x);
    const dz = wrap(tz - player.pos.z);
    const dist = Math.hypot(dx, dz);
    if (dist < 4) return;
    let r = rel((Math.atan2(dx, -dz) * 180) / Math.PI);
    if (Math.abs(r) > COMPASS_FOV / 2) {
      if (!clamp) return;
      r = Math.sign(r) * (COMPASS_FOV / 2 - 14); // pinned inside the faded edge, so it stays visible
    }
    const x = COMPASS_W / 2 + r * px;
    html += `<span class="cp-mark ${cls}" style="left:${x}px">${glyph}${label ? `<em>${label}</em>` : ''}</span>`;
  };
  const near = <T extends { x: number; z: number }>(list: T[], n: number) =>
    [...list]
      .sort((a, b) => wdist(a.x, a.z, player.pos.x, player.pos.z) - wdist(b.x, b.z, player.pos.x, player.pos.z))
      .slice(0, n);
  for (const w of near(waystones.stones.slice(1), 4)) mark(w.x, w.z, 'stone', '◆');
  for (const o of near(obelisks.slice(1), 2)) mark(o.x, o.z, 'obelisk', '▲');
  for (const d of near(apiary.dens.slice(1), 3)) mark(d.x, d.z, 'den', '●');
  const hd = Math.round(wdist(player.pos.x, player.pos.z, stations.hollow.x, stations.hollow.z));
  mark(stations.hollow.x, stations.hollow.z, 'home', '⌂', `${fmt(hd)}m`, true);
  $('compass-strip').innerHTML = html;
}

// ---------- input ----------
/** Any full-screen menu is open (the game pauses input while one is). */
let menuOpen = false;
type MenuKind = 'shop' | 'rings' | 'travel' | 'pause' | 'thanks';
let pausedAt = 0; // when the Esc menu last opened (see the Escape handling below)
let escClosedAt = -1e9; // when Esc last closed a menu (that Esc mustn't also open the pause menu)
let menuKind: MenuKind | null = null;
let started = false;
let mouseDown = false;
let skipSave = false;

function lock() {
  if (TOUCH || botQuery.get('bot') === '1') return; // touch play (and the bot) never capture a mouse
  canvas.requestPointerLock?.();
}

function openMenu(kind: MenuKind | null) {
  menuKind = kind;
  menuOpen = kind !== null;
  showBuild(false);
  $('shop').classList.toggle('hidden', kind !== 'shop');
  $('rings').classList.toggle('hidden', kind !== 'rings');
  $('travel').classList.toggle('hidden', kind !== 'travel');
  $('pause').classList.toggle('hidden', kind !== 'pause');
  $('thanks').classList.toggle('hidden', kind !== 'thanks');
  if (kind === 'pause') {
    pausedAt = performance.now();
    showPauseMain();
  }
  if (kind === 'shop') {
    renderShop();
    tips.flag('shopped');
  }
  if (kind === 'rings') renderRings();
  if (kind === 'travel') renderTravel(waystones.nearby(player.pos)!);
  if (kind) touch?.release();
  if (kind) document.exitPointerLock?.();
  else lock();
}

// ---------- fairy ring list ----------
interface RingRow {
  ring: Ring;
  info: HTMLElement;
}
let ringRows: RingRow[] = [];

function ringStatus(r: Ring) {
  const dist = Math.round(wdist(player.pos.x, player.pos.z, r.x, r.z));
  const where = dist < 4 ? 'right here' : `${dist}m away`;
  let work: string;
  if (r.left > 0) work = `<b>${fmt(r.left)}</b> tiles left to plant`;
  else if (r.locked > 0) work = `<span class="warn">Stuck: ${fmt(r.locked)} tiles need a soil upgrade</span>`;
  else work = '<span class="ok">Finished, nothing left in reach</span>';
  return `${r.fairies.length} fairies · ${where}<br>${work}`;
}

/** Honey back for removing `n` rings: the prices of the last n rings bought. */
function ringRefund(n: number) {
  let total = 0;
  for (let k = 1; k <= n; k++) total += Math.ceil(RING.baseCost * Math.pow(RING.growth, econ.ringsBuilt - k));
  return total;
}

const finishedRings = () => fairies.rings.filter((r) => r.left === 0 && r.locked === 0);

/** Take up every ring with nothing left to plant, refunding their honey. Returns how many. */
function removeFinishedRings() {
  fairies.refreshCounts();
  const now = finishedRings();
  if (!now.length) return 0;
  const refund = ringRefund(now.length);
  for (const r of now) fairies.remove(r);
  challenges.ringRemoved = true;
  econ.ringsBuilt -= now.length;
  econ.honey += refund;
  chimes.purchase();
  toast(
    `${now.length} finished ring${now.length === 1 ? '' : 's'} removed. ${HONEY} ${fmt(refund)} returned. Build them somewhere new with R.`,
  );
  return now.length;
}

function renderRings() {
  fairies.refreshCounts();
  // Remove every finished ring in one go (two clicks).
  const done = finishedRings();
  const clear = $<HTMLButtonElement>('rings-clear');
  clear.classList.toggle('hidden', !done.length);
  const rs = done.length === 1 ? '' : 's';
  clear.innerHTML = `Remove ${done.length} finished ring${rs} (+${HONEY} ${fmt(ringRefund(done.length))})`;
  let clearArmed = false;
  clear.onclick = () => {
    if (!clearArmed) {
      clearArmed = true;
      clear.textContent = `Click again to remove ${done.length} ring${rs}`;
      return;
    }
    removeFinishedRings();
    renderRings();
  };
  const list = $('rings-list');
  list.innerHTML = '';
  ringRows = [];
  const wf = econ.wayfarers ? ` · ${econ.wayfarers} wayfarer${econ.wayfarers === 1 ? '' : 's'} roaming` : '';
  $('rings-sub').textContent = fairies.rings.length
    ? `${fairies.rings.length} ring${fairies.rings.length === 1 ? '' : 's'} · each tends ${econ.ringRadius}m around itself${wf}`
    : wf.slice(3);
  if (!fairies.rings.length) {
    list.innerHTML = `<p class="dim">No fairy rings yet. ${say('Press <b>R</b>', 'Use <b>Build</b>')} to build one (costs honey).</p>`;
    return;
  }
  // Finished rings first: those are the ones worth moving.
  const rings = [...fairies.rings].sort((a, b) => a.left - b.left);
  for (const r of rings) {
    const row = document.createElement('div');
    row.className = 'ring-row';
    const info = document.createElement('div');
    info.className = 'ring-info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = r.label;
    const status = document.createElement('div');
    status.className = 'desc';
    status.innerHTML = ringStatus(r);
    info.append(name, status);
    const btn = document.createElement('button');
    btn.className = 'remove';
    // Removing the newest-priced ring frees that price slot, so refund exactly that.
    const refund = Math.ceil(RING.baseCost * Math.pow(RING.growth, econ.ringsBuilt - 1));
    btn.innerHTML = `Remove (+${HONEY} ${fmt(refund)})`;
    let armed = false;
    btn.onclick = () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Click again to remove';
        return;
      }
      fairies.remove(r);
      challenges.ringRemoved = true;
      econ.ringsBuilt--;
      econ.honey += refund;
      chimes.purchase();
      toast(`${r.label} removed. ${HONEY} ${fmt(refund)} returned. Build it somewhere new with R.`);
      renderRings();
    };
    row.append(info, btn);
    list.appendChild(row);
    ringRows.push({ ring: r, info: status });
  }
}

function updateRings() {
  for (const row of ringRows) row.info.innerHTML = ringStatus(row.ring);
}

function saveNow() {
  if (skipSave || activeSlot < 0 || ending.active) return; // mid-ending she's been moved to the stage
  const extra: SaveExtra = {
    caches: stations.caches.map((c) => ({ x: c.x, z: c.z, stock: c.stock })),
    hives: apiary.hives.map((h) => ({ x: h.x, z: h.z, honey: h.honey })),
    rings: fairies.rings.map((r) => ({ x: r.x, z: r.z })),
    dens: apiary.dens.slice(1).map((d) => ({ x: d.x, z: d.z })),
    bearHomes: apiary.bearHomes(),
    stones: waystones.stones.slice(1).map((w) => ({ x: w.x, z: w.z })),
    obelisks: obelisks.slice(1).map((o) => ({ x: o.x, z: o.z })),
    trampled: [...scenery.trampled],
    playTime,
    timeOfDay: dayNight.time,
    moonRestored,
    tips: tips.step,
    challenges,
  };
  garden.save(player, extra);
  cloud.saved(activeSlot);
}

// ---------- home screen: save slots ----------
function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function duration(sec: number) {
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  const last = lastSlot();
  for (let i = 0; i < SLOT_COUNT; i++) {
    const info = slotInfo(i);
    const row = document.createElement('div');
    row.className = 'save-slot' + (info ? '' : ' empty') + (info && i === last ? ' last' : '');
    const text = document.createElement('div');
    text.className = 'save-slot-text';
    if (info) {
      const pct =
        info.planetPct === null
          ? ''
          : ` · ${info.planetPct < 10 ? info.planetPct.toFixed(1) : Math.floor(info.planetPct)}% restored`;
      const bits = [
        `${info.glades} glade${info.glades === 1 ? '' : 's'}`,
        `✿ ${fmt(info.pollen)}`,
        ...(info.honey > 0 ? [`${HONEY} ${fmt(info.honey)}`] : []),
        ...(info.playTime >= 60 ? [`played ${duration(info.playTime)}`] : []),
        ...(info.savedAt ? [ago(info.savedAt)] : []),
      ];
      text.innerHTML = `<b>World ${i + 1}${pct}</b><span class="save-slot-meta">${bits.join(' · ')}</span>`;
    } else {
      text.innerHTML = `<b>World ${i + 1}</b><span class="save-slot-meta">Empty: a grey planet waiting for seeds</span>`;
    }
    const go = document.createElement('button');
    go.className = 'save-slot-play';
    go.textContent = info ? 'Continue' : 'New world';
    go.onclick = () => startGame(i);
    // Hold off while the cloud may be about to bring a newer copy of this world.
    go.disabled = cloud.state === 'syncing';
    row.append(text, go);
    if (info) {
      const del = document.createElement('button');
      del.className = 'save-slot-delete';
      del.textContent = 'Delete';
      let armed = false;
      let timer = 0;
      del.onclick = () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Delete forever?';
          del.classList.add('armed');
          timer = window.setTimeout(() => {
            armed = false;
            del.textContent = 'Delete';
            del.classList.remove('armed');
          }, 3000);
          return;
        }
        clearTimeout(timer);
        deleteSlot(i);
        cloud.deleted(i);
        renderSlots();
      };
      row.append(del);
    }
    box.append(row);
  }
}
renderSlots();

// ---------- home screen: settings and credits ----------
const music = (f: string) => import.meta.env.BASE_URL + 'music/' + f;
// Each song plays its loop twice, then the next song starts.
const SONGS: Song[] = [
  // "forest" plays twice through (each part starts as the one before falls silent).
  { title: 'forest', parts: [{ url: music('forest.mp3') }, { url: music('forest.mp3') }] },
  // Sylvan Waltz, per the composer's notes: intro, then the main loop at 11.08 s; the main loop
  // is re-triggered when it reaches 1:26.08 of its own length (the last ~3 s of each file is a
  // reverb tail that rings out underneath the next part).
  {
    title: 'Sylvan Waltz',
    parts: [
      { url: music('sylvan-waltz-intro.mp3'), at: 0 },
      { url: music('sylvan-waltz-main.mp3'), at: 11.08 },
      { url: music('sylvan-waltz-main.mp3'), at: 11.08 + 86.08 },
    ],
  },
  {
    title: 'The Outer Forest',
    parts: [{ url: music('the-outer-forest.mp3') }, { url: music('the-outer-forest.mp3') }],
  },
];
let viewScale = 1;
onSettings((s) => {
  chimes.setVolumes(s.sfx, s.music);
  viewScale = VIEW_SCALE[s.view];
  flowers.viewScale = viewScale;
  hearts.viewScale = viewScale;
  terrain.setRadius(HALF * viewScale);
});
// Browsers only allow audio after the player interacts, so the music starts on the first click or key.
const startMusic = () => {
  chimes.startMusic(SONGS);
  removeEventListener('pointerdown', startMusic);
  removeEventListener('keydown', startMusic);
};
addEventListener('pointerdown', startMusic);
addEventListener('keydown', startMusic);

type HomePanel = 'main' | 'worlds' | 'settings' | 'credits' | 'look' | 'cloud';
/** The title screen's menu, or one of its cards opened over the art. */
function showHome(panel: HomePanel) {
  $('home-cloud').classList.toggle('hidden', panel !== 'cloud');
  if (panel === 'cloud') renderCloud();
  $('home-main').classList.toggle('hidden', panel !== 'main');
  $('home-card').classList.toggle('hidden', panel === 'main');
  $('home-worlds').classList.toggle('hidden', panel !== 'worlds');
  if (panel === 'worlds') renderSlots();
  if (panel === 'main') renderContinue();
  $('home-settings').classList.toggle('hidden', panel !== 'settings');
  $('home-credits').classList.toggle('hidden', panel !== 'credits');
  $('home-look').classList.toggle('hidden', panel !== 'look');
  if (panel === 'look') {
    renderLookOpts();
    lookPreview.setLook(look);
    lookPreview.start();
  } else lookPreview.stop();
}
$('open-settings').onclick = () => showHome('settings');
$('open-look').onclick = () => showHome('look');
$('title-start').onclick = () => showHome('worlds');
$('title-continue').onclick = () => {
  const i = lastSlot();
  if (slotInfo(i)) startGame(i);
};
// Pollen motes drifting up off the nymph's patch of grass in the title painting.
for (let k = 0; k < 16; k++) {
  const m = document.createElement('i');
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  m.style.cssText =
    `left:${r(8, 60)}%;top:${r(55, 92)}%;--d:${r(7, 13)}s;--delay:${r(-12, 0)}s;--dx:${r(-40, 40)}px;` +
    `scale:${r(0.5, 1.1)}`;
  document.querySelector('.motes')!.append(m);
}
/** "Continue" on the title goes straight back into the world played last, if there is one. */
function renderContinue() {
  const i = lastSlot();
  const info = slotInfo(i);
  const btn = $<HTMLButtonElement>('title-continue');
  btn.classList.toggle('hidden', !info);
  btn.disabled = cloud.state === 'syncing';
  if (info) btn.dataset.world = `World ${i + 1}`;
}
// Arrow keys walk the title menu (Enter or Space picks, as buttons do).
addEventListener('keydown', (e) => {
  if (started || $('home-main').classList.contains('hidden')) return;
  if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
  const items = [...document.querySelectorAll<HTMLButtonElement>('.title-nav button')].filter(
    (b) => !b.classList.contains('hidden') && !b.disabled,
  );
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = at < 0 ? 0 : (at + (e.code === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
  items[next].focus();
  e.preventDefault();
});

/** The home screen's intro names the character being played. */
function renderIntro() {
  $('intro-kind').textContent = look.body === 'male' ? 'sylvan' : 'wood nymph';
}
renderIntro();

// ---------- home screen: character customization ----------
const lookPreview = new LookPreview($<HTMLCanvasElement>('look-preview'));
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
function renderLookOpts() {
  const box = $('look-opts');
  box.textContent = '';
  const row = (label: string) => {
    const r = document.createElement('div');
    r.className = 'look-row';
    const l = document.createElement('span');
    l.textContent = label;
    r.appendChild(l);
    box.appendChild(r);
    return r;
  };
  const apply = (patch: Partial<Look>) => {
    updateLook(patch);
    lookPreview.setLook(look);
    player.setLook(look);
    renderLookOpts();
    renderIntro();
  };
  const choices = <K extends 'body' | 'hair' | 'head' | 'back'>(
    label: string,
    key: K,
    names: Record<Look[K], string>,
  ) => {
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const [v, name] of Object.entries(names) as [Look[K], string][]) {
      const b = document.createElement('button');
      b.textContent = name;
      b.classList.toggle('on', look[key] === v);
      b.onclick = () => {
        const patch: Partial<Look> = { [key]: v };
        // switching body picks that body's usual hairstyle; it can still be changed after
        if (key === 'body') patch.hair = v === 'male' ? 'short' : 'long';
        apply(patch);
      };
      seg.appendChild(b);
    }
    row(label).appendChild(seg);
  };
  const swatches = (
    label: string,
    key: 'hairColor' | 'skin' | 'outfit',
    opts: Record<string, { name: string }>,
    color: (k: string) => number,
  ) => {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    for (const [k, o] of Object.entries(opts)) {
      const b = document.createElement('button');
      b.title = o.name;
      b.setAttribute('aria-label', `${label}: ${o.name}`);
      b.style.background = hex(color(k));
      b.classList.toggle('on', look[key] === k);
      b.onclick = () => apply({ [key]: k });
      wrap.appendChild(b);
    }
    row(`${label} · ${opts[look[key]].name}`).appendChild(wrap);
  };
  choices('Body', 'body', BODY_NAMES);
  choices('Hair', 'hair', HAIR_NAMES);
  swatches('Hair colour', 'hairColor', HAIR_COLORS, (k) => HAIR_COLORS[k].base);
  swatches('Skin', 'skin', SKINS, (k) => SKINS[k].base);
  swatches('Outfit', 'outfit', OUTFITS, (k) => OUTFITS[k].dark);
  choices('Headwear', 'head', HEAD_NAMES);
  choices('On the back', 'back', BACK_NAMES);
}
$('open-credits').onclick = () => showHome('credits');
$('open-cloud').onclick = () => showHome('cloud');

// ---------- cloud save ----------
function renderCloud() {
  const on = cloud.on;
  $('cloud-off').classList.toggle('hidden', on);
  $('cloud-on').classList.toggle('hidden', !on);
  $('cloud-code').textContent = cloud.code ?? '';
  const busy = cloud.state === 'syncing';
  for (const id of ['cloud-create', 'cloud-link', 'cloud-sync']) $<HTMLButtonElement>(id).disabled = busy;
  $('cloud-status').textContent = busy
    ? 'Syncing…'
    : cloud.lastSync
      ? `Last synced ${ago(cloud.lastSync)}. Worlds upload every 30 seconds while you play.`
      : '';
  $('cloud-error').textContent = cloud.error; // also a bad code typed while it's off
  // The line under the worlds on the home screen.
  const line = $('cloud-line');
  line.classList.toggle('warn', !on);
  line.textContent = !on
    ? 'Worlds are saved in this browser only. Turn on Cloud save to keep them safe.'
    : busy
      ? '☁ Syncing with the cloud…'
      : cloud.state === 'error'
        ? `☁ Cloud save: ${cloud.error}`
        : `☁ Cloud save on · synced ${ago(cloud.lastSync)}`;
}
cloud.onChange = () => {
  renderCloud();
  if (!started) {
    renderSlots();
    renderContinue();
  }
};
renderContinue();
$('cloud-create').onclick = () => cloud.create().catch(() => {});
$('cloud-link').onclick = () =>
  cloud
    .link($<HTMLInputElement>('cloud-code-in').value)
    .then(() => ($<HTMLInputElement>('cloud-code-in').value = ''))
    .catch(() => {});
$('cloud-sync').onclick = () => cloud.sync().catch(() => {});
$('cloud-copy').onclick = () => {
  navigator.clipboard?.writeText(cloud.code ?? '').then(
    () => ($('cloud-copy').textContent = 'Copied'),
    () => {},
  );
  setTimeout(() => ($('cloud-copy').textContent = 'Copy'), 2000);
};
{
  const b = $('cloud-unlink');
  let armed = 0;
  b.onclick = () => {
    if (!armed) {
      b.classList.add('armed');
      b.textContent = 'Stop syncing? (worlds stay saved)';
      armed = window.setTimeout(() => {
        armed = 0;
        b.classList.remove('armed');
        b.textContent = 'Stop syncing on this device';
      }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    b.classList.remove('armed');
    b.textContent = 'Stop syncing on this device';
    cloud.unlink();
  };
}
renderCloud();
cloud.sync().catch(() => {}); // pick up anything played on another device
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && started) {
    saveNow();
    void cloud.tick(true);
  }
});
for (const b of document.querySelectorAll<HTMLButtonElement>('.home-panel .back'))
  b.onclick = () => {
    if (firstWorld !== null && b.closest('#home-look')) {
      // Character made: on into the first world.
      const i = firstWorld;
      lookPreview.stop();
      b.textContent = 'Done';
      return startGame(i);
    }
    if (menuKind === 'pause') showPauseMain();
    else showHome('main');
  };

// ---------- in-game menu (Esc) ----------
function showPauseMain() {
  $('home-settings').classList.add('hidden');
  $('pause-main').classList.remove('hidden');
}
$('pause-resume').onclick = () => openMenu(null);
$('pause-settings').onclick = () => {
  // The home screen's Settings panel, borrowed into this menu.
  const panel = $('home-settings');
  $('pause-inner').appendChild(panel);
  panel.classList.remove('hidden');
  $('pause-main').classList.add('hidden');
};
$('pause-home').onclick = () => goHome();

function bindSlider(id: 'music' | 'sfx') {
  const input = $<HTMLInputElement>(`set-${id}`);
  const out = $(`set-${id}-v`);
  input.value = String(Math.round(settings[id] * 100));
  out.textContent = `${input.value}%`;
  input.oninput = () => {
    out.textContent = `${input.value}%`;
    updateSettings({ [id]: Number(input.value) / 100 });
  };
  // Let the player hear the new effects level.
  if (id === 'sfx') input.onchange = () => chimes.bloom();
}
bindSlider('music');
bindSlider('sfx');
const viewButtons = [...$('set-view').querySelectorAll<HTMLButtonElement>('button')];
function renderView() {
  for (const b of viewButtons) b.classList.toggle('on', b.dataset.v === settings.view);
}
for (const b of viewButtons) {
  b.onclick = () => {
    updateSettings({ view: b.dataset.v as ViewDistance });
    renderView();
  };
}
renderView();
const gridButtons = [...$('set-grid').querySelectorAll<HTMLButtonElement>('button')];
function renderGrid() {
  for (const b of gridButtons) b.classList.toggle('on', (b.dataset.v === 'on') === settings.grid);
}
for (const b of gridButtons) {
  b.onclick = () => {
    updateSettings({ grid: b.dataset.v === 'on' });
    renderGrid();
  };
}
renderGrid();
{
  const input = $<HTMLInputElement>('set-look');
  const out = $('set-look-v');
  input.value = String(Math.round(settings.lookSpeed * 100));
  out.textContent = `${input.value}%`;
  input.oninput = () => {
    out.textContent = `${input.value}%`;
    updateSettings({ lookSpeed: Number(input.value) / 100 });
  };
  const invertButtons = [...$('set-invert').querySelectorAll<HTMLButtonElement>('button')];
  const renderInvert = () => {
    for (const b of invertButtons) b.classList.toggle('on', (b.dataset.v === 'on') === settings.invertY);
  };
  for (const b of invertButtons)
    b.onclick = () => {
      updateSettings({ invertY: b.dataset.v === 'on' });
      renderInvert();
    };
  renderInvert();
}
onSettings((s) => (cursorUniforms.uCursorGrid.value = s.grid ? 1 : 0));

function playEnding() {
  if (menuOpen) openMenu(null);
  showBuild(false);
  // Named for whoever she (or he) is playing: a nymph or a sylvan.
  ending.play(() => {
    // Once the white has faded: a thank-you card (with the Ko-fi link), which frees the mouse.
    $('thanks-kind').textContent = BODY_NAMES[look.body].toLowerCase();
    setTimeout(() => {
      if (!ending.active && !menuOpen && started && !bot) openMenu('thanks');
    }, 1800);
  });
}

/** A brand-new player's first world waits here while they make their character. */
let firstWorld: number | null = null;

// ---------- the intro: the story, told at the start of each new world ----------
/** The new world the intro is opening. */
let introFor: number | null = null;
let introTimers: number[] = [];
const introLines = () => [...document.querySelectorAll<HTMLElement>('#intro .intro-text > *')];

function showIntro(i: number) {
  introFor = i;
  renderIntro();
  lookPreview.stop();
  const intro = $('intro');
  intro.classList.remove('hidden', 'shown');
  void intro.offsetWidth; // restart the fade and the slow push-in
  intro.classList.add('shown');
  // One line at a time, then the Begin button.
  const lines = introLines();
  for (const el of lines) el.classList.remove('in');
  introTimers.forEach(clearTimeout);
  introTimers = lines.map((el, k) => window.setTimeout(() => el.classList.add('in'), 900 + k * 2200));
}
/** Show every line at once (a click or key while it's still telling). */
function hurryIntro() {
  introTimers.forEach(clearTimeout);
  introTimers = [];
  for (const el of introLines()) el.classList.add('in');
  $('intro-begin').focus();
}
const beginIntro = () => introFor !== null && startGame(introFor);
$('intro-begin').onclick = (e) => {
  e.stopPropagation();
  beginIntro();
};
$('intro-skip').onclick = (e) => {
  e.stopPropagation();
  beginIntro();
};
$('intro').addEventListener('click', () => {
  if (!$('intro-begin').classList.contains('in')) hurryIntro();
});
addEventListener('keydown', (e) => {
  if (introFor === null || started || $('intro').classList.contains('hidden')) return;
  if (e.code === 'Escape') return beginIntro();
  if (!$('intro-begin').classList.contains('in')) {
    hurryIntro();
    e.preventDefault(); // the same Enter shouldn't press Begin straight away
  }
});

function startGame(i: number) {
  if (started) return;
  // The very first world (no worlds at all yet) starts with making your character; later
  // worlds go straight in (the look can be changed from Customize on the home screen).
  if (firstWorld === null && [...Array(SLOT_COUNT).keys()].every((k) => !slotInfo(k))) {
    firstWorld = i;
    showHome('look');
    $('home-look').querySelector('.back')!.textContent = 'Start playing';
    return;
  }
  firstWorld = null;
  // A new world opens with the story; Begin (or Skip) comes back here to start it.
  if (!slotInfo(i) && introFor !== i) return showIntro(i);
  introFor = null;
  $('intro').classList.add('hidden');
  setLastSlot(i);
  loadSlot(i);
  started = true;
  $('start').classList.add('hidden');
  chimes.resume();
  lock();
  if (TOUCH) {
    document.body.classList.add('playing');
    // Android can go full screen and stay sideways (iPhones keep the browser bars).
    document.documentElement
      .requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  }
}
canvas.addEventListener('click', () => {
  if (started && !menuOpen && document.pointerLockElement !== canvas) lock();
});
async function goHome() {
  saveNow();
  skipSave = true;
  // Give the last upload a moment, but don't hang on a bad connection.
  await Promise.race([cloud.tick(true), new Promise((r) => setTimeout(r, 5000))]);
  location.reload(); // back to the home screen (it shows on every load)
}

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas && !ending.active) player.look(e.movementX, e.movementY);
});
addEventListener('mousedown', (e) => {
  if (e.button === 0 && document.pointerLockElement === canvas && !ending.active) mouseDown = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});
addEventListener('wheel', (e) => {
  if (document.pointerLockElement === canvas && !ending.active) player.scroll(e.deltaY);
});
addEventListener('keydown', (e) => {
  if (!started || e.repeat) return;
  if (ending.active) {
    if (e.code === 'Escape') ending.skip();
    return;
  }
  if (e.code === 'Escape' && menuOpen) {
    // The same Esc that released the mouse can arrive here too; don't let it close the menu it opened.
    if (menuKind === 'pause' && performance.now() - pausedAt < 400) return;
    escClosedAt = performance.now();
    return openMenu(null);
  }
  if (e.code === 'Escape' && !buildOpen) return openMenu('pause');
  if (e.code === 'F3') {
    e.preventDefault();
    return perf.toggleOverlay();
  }
  if (e.code === 'KeyE') return useHere();
  if (e.code === 'KeyG') return openMenu(menuKind === 'rings' ? null : 'rings');
  if (menuOpen) return;
  if (buildOpen) {
    // While the build menu is up, number keys build instead of switching tools.
    if (e.code === 'KeyB' || e.code === 'Escape') return showBuild(false);
    if (e.code.startsWith('Digit')) {
      const opt = BUILDS[Number(e.code.slice(5)) - 1];
      if (opt) {
        showBuild(false);
        opt.build();
      }
      return;
    }
  }
  if (e.code.startsWith('Digit')) selectSlot(Number(e.code.slice(5)) - 1);
  if (e.code === 'KeyB') showBuild(true);
  if (e.code === 'KeyH') buildHive();
  if (e.code === 'KeyR') buildRing();
  if (e.code === 'KeyF') toggleAutoPlant();
  if (e.code === 'KeyM') {
    chimes.setMuted(!chimes.muted);
    toast(chimes.muted ? 'Sound off' : 'Sound on');
  }
});
/** E (or the touch Use button): the obelisk opens the shop, a waystone the travel list. */
function useHere() {
  if (menuKind === 'shop' || menuKind === 'travel') return openMenu(null);
  if (menuOpen) return;
  if (obeliskHere()) return openMenu('shop');
  if (waystones.nearby(player.pos)) return openMenu('travel');
  chimes.deny();
  toast('Nothing to use here. Press E at the Verdant Obelisk to trade, or in a waystone to travel.');
}

function toggleAutoPlant() {
  econ.autoPlant = !econ.autoPlant;
  toast(econ.autoPlant ? 'Mount auto-planting on' : 'Mount auto-planting off');
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-close]')) b.onclick = () => openMenu(null);

const touch = TOUCH
  ? new TouchControls({
      player,
      playing: () => started && !menuOpen && !ending.active,
      setPlanting: (on) => (mouseDown = on && started && !menuOpen && !ending.active),
      useLabel: () => (obeliskHere() ? 'Trade' : waystones.nearby(player.pos) ? 'Travel' : null),
      use: useHere,
      build: () => showBuild(!buildOpen),
      rings: () => openMenu('rings'),
      menu: () => openMenu('pause'),
      riding: () => (econ.riding ? { on: econ.autoPlant } : null),
      toggleAutoPlant,
      skipEnding: () => {
        if (!ending.active) return false;
        ending.skip();
        return true;
      },
    })
  : null;
if (TOUCH) {
  document.querySelector('#ending .skip')!.textContent = 'Double-tap to skip';
  $('portrait-ok').onclick = () => document.body.classList.add('portrait-ok');
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) return;
  mouseDown = false;
  if (!started) return;
  // Esc while the mouse is captured: the browser releases it (and keeps the key press), so
  // this is where Esc opens the menu, or skips the ending.
  if (ending.active) ending.skip();
  // Esc that just closed the shop or rings list: the browser can drop the mouse we re-captured
  // for that same key. Leave it at that (a click recaptures) rather than opening the pause menu.
  else if (!menuOpen && performance.now() - escClosedAt > 700) openMenu('pause');
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
addEventListener('beforeunload', saveNow);

// ---------- pacing bot (dev only: ?bot=1, see bot.ts) ----------
const bot =
  import.meta.env.DEV && botQuery.get('bot') === '1'
    ? new Bot(
        {
          econ,
          world,
          garden,
          player,
          stations,
          waystones,
          apiary,
          fairies,
          obelisks: () => obelisks,
          setMouse: (on) => (mouseDown = on),
          selectSlot,
          openShop: () => {
            if (menuKind !== 'shop') openMenu('shop');
          },
          closeMenu: () => openMenu(null),
          build: (kind, x, z) => {
            garden.aimAt(x, z, player.pos);
            const count = () => econ.cachesBuilt + econ.hivesBuilt + econ.ringsBuilt + econ.stonesBuilt;
            const before = count();
            ({ cache: buildCache, hive: buildHive, ring: buildRing, waystone: buildStone })[kind]();
            return count() > before;
          },
          canPlace: (x, z) =>
            stations.canBuildAt(x, z) ?? apiary.canBuildAt(x, z) ?? fairies.canBuildAt(x, z) ?? stoneNear(x, z),
          planet: () => ({ ...planetProgress(), total: realGlades }),
          playTime: () => playTime,
          ended: () => moonRestored,
          challenges: () => challenges,
          travel,
          removeFinishedRings,
        },
        botQuery,
      )
    : null;
if (bot) {
  // A fresh world that's never saved, started straight away (no home screen, no tips).
  skipSave = true;
  tips.skip();
  dayNight.time = NEW_WORLD_TIME;
  started = true;
  $('start').classList.add('hidden');
  (window as unknown as { dgBot: Bot }).dgBot = bot;
}

// ---------- loop ----------
const clock = new THREE.Clock();
let saveTimer = 0;
let hudTimer = 0;
let shopTimer = 0;
let wasFull = true;
let stationText = ''; // what the station line says (worked out each step, shown each frame)
renderHotbar();

const perf = new Perf(renderer, () => ({
  planetPct: Math.round(planetProgress().pct * 100) / 100,
  glades: planetProgress().done,
  hives: apiary.hives.length,
  bears: apiary.bears.length,
  rings: fairies.rings.length,
  fairies: fairies.rings.reduce((n, r) => n + r.fairies.length, 0),
  wayfarers: econ.wayfarers,
  caches: stations.caches.length,
  stones: waystones.stones.length,
  mount: econ.mount?.id ?? '',
  zoom: Math.round(player.zoom),
  fp: player.firstPerson,
  menu: menuOpen,
  view: settings.view,
}));
let firstFrame = true;
/** Game time: the sum of steps (frames, or the bot's fast-forward steps). */
let simTime = 0;
const BOT_DT = 0.05;
const BOT_BUDGET_MS = 28; // fast-forward steps per frame stop here, so it still draws

let titleFrame = 0;
function frame() {
  // The title's painting covers the world: draw it only now and then (keeps it warmed up).
  if (!started && !firstFrame && titleFrame++ % 20 !== 0) {
    clock.getDelta();
    return requestAnimationFrame(frame);
  }
  perf.begin();
  const realDt = Math.min(clock.getDelta(), 0.05);
  if (bot?.fast && started && !ending.active) {
    const t0 = performance.now();
    for (let k = 0; k < bot.speed && performance.now() - t0 < BOT_BUDGET_MS; k++) step(BOT_DT);
  } else step(realDt);
  present(realDt);
  perf.end();
  if (firstFrame) {
    firstFrame = false;
    perf.load({ script: tScript, world: tWorld, ready: tReady, firstFrame: performance.now() });
  }
  requestAnimationFrame(frame);
}

/** Advance the game by dt: movement, planting, growth and everything that works on its own. */
function step(dt: number) {
  simTime += dt;
  const time = simTime;
  dayNight.update(dt);

  if (ending.active) {
    player.keys.clear(); // she stands and watches
    mouseDown = false;
  }
  bot?.update(dt);
  if (!menuOpen) player.update(dt, time);
  ending.update(dt); // takes the camera while it plays
  perf.mark('player');

  const mount = econ.mount;
  if (bot) bot.aim();
  else garden.updateAim(camera, player.pos);
  if (mount) {
    // Show the mount's planting footprint instead of the hand cursor.
    cursorUniforms.uCursor.value.set(player.pos.x, player.pos.z, mount.radius);
    cursorUniforms.uCursorState.value = !econ.autoPlant ? 0 : econ.activeSeeds >= 1 ? 1 : 2;
    if (econ.autoPlant && !menuOpen) garden.workMount(dt, player.pos.x, player.pos.z, mount);
  } else {
    const st = garden.aimStatus;
    cursorUniforms.uCursorState.value = st === 'none' ? 0 : st === 'ok' || st === 'done' ? 1 : 2;
    cursorUniforms.uCursor.value.set(garden.aim.x, garden.aim.z, econ.tool.radius);
    if (mouseDown && !menuOpen && garden.work(dt)) {
      player.workAnim = 1;
      plantTime += dt;
      if (plantTime > 1.5) tips.flag('planted');
    }
  }

  // Fairy rings' reach on the ground: all of them, while standing in a ring or while the build
  // menu is open (aiming shows where a new one would reach, in green), so rings can be spaced
  // out. Fades in and out.
  {
    const here = fairies.nearby(player.pos);
    const planning = buildOpen && econ.has('hive');
    const aiming = planning && garden.aimStatus !== 'none';
    const u = cursorUniforms;
    if (here || planning) {
      // The nearest rings, if there are ever more than the shader takes.
      const rings =
        fairies.rings.length > MAX_ZONES
          ? [...fairies.rings]
              .sort((a, b) => wdist(a.x, a.z, player.pos.x, player.pos.z) - wdist(b.x, b.z, player.pos.x, player.pos.z))
              .slice(0, MAX_ZONES)
          : fairies.rings;
      rings.forEach((r, k) => u.uZones.value[k].set(r.x, r.z));
      u.uZoneCount.value = rings.length;
      u.uZoneR.value = econ.ringRadius;
      if (aiming) u.uZoneHi.value.set(garden.aim.x, garden.aim.z, 1);
      else if (here) u.uZoneHi.value.set(here.x, here.z, 0.5);
      else u.uZoneHi.value.z = 0; // zoomed out too far to aim: just the rings there are
    }
    u.uZoneShow.value += ((here || planning ? 1 : 0) - u.uZoneShow.value) * Math.min(1, dt * 5);
  }

  // Seed refills
  const seedsBefore = econ.activeSeeds;
  const src = stations.nearby(player.pos);
  stationText = '';
  if (src?.kind === 'hollow') {
    econ.refill(1500 * dt);
    stationText = 'Seed Hollow · refilling';
  } else if (src?.kind === 'cache') {
    const used = econ.refill(Math.min(src.cache.stock, 1000 * dt));
    src.cache.stock -= used;
    stationText = `${src.cache.label} · ${Math.floor(src.cache.stock)} / ${econ.cacheStockCap} seeds · ${econ.squirrelsPerCache} squirrel${econ.squirrelsPerCache > 1 ? 's' : ''} fetching from ${src.cache.hub.replace('Waystone · ', 'the waystone at ')}`;
  }
  if (!src) {
    const ap = apiary.nearby(player.pos);
    const ring = fairies.nearby(player.pos);
    const stone = waystones.nearby(player.pos);
    const ob = obeliskHere();
    if (ob) {
      stationText = `${ob.label} · ${say('press E', 'tap Trade')} to trade`;
    } else if (stone) {
      // Waystones are seed hubs too.
      econ.refill(1500 * dt);
      stationText = `${stone.label} · refilling seeds · ${say('press E', 'tap Travel')} to travel`;
    } else if (ap?.kind === 'den') {
      const n = apiary.bearsAt(ap.den);
      stationText = `${ap.den.label} · ${n} bear${n === 1 ? '' : 's'} here · ${apiary.totalRate.toFixed(1)} honey/s from ${apiary.hives.length} hive${apiary.hives.length === 1 ? '' : 's'}`;
    } else if (ap?.kind === 'hive') {
      const h = ap.hive;
      stationText = `${h.label} · ${Math.floor(h.honey)} / ${fmt(econ.hiveCap)} honey · ${h.flowers} flowers in reach · ${apiary.rateOf(h).toFixed(2)}/s`;
    } else if (ring) {
      stationText = `${ring.label} · ${ring.fairies.length} fairies · ${fmt(ring.left)} tiles left to plant`;
    }
  }
  perf.mark('tools');
  if (econ.activeSeeds > seedsBefore) tips.flag('refilled');
  const full = econ.allSeedsFull;
  if ((src || waystones.nearby(player.pos)) && full && !wasFull) chimes.purchase();
  wasFull = full;

  garden.update(dt, time);
  perf.mark('garden');
  stations.update(dt, time, player.pos);
  perf.mark('stations');
  apiary.update(dt, time, player.pos, (n) => {
    econ.addHoney(n);
    const el = $('honey');
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  });
  perf.mark('apiary');
  fairies.update(dt, time, player.pos);
  perf.mark('fairies');
  hearts.update(time, camera.position);
  waystones.update(time);
  for (const o of obelisks) o.update(time);
  particles.update(dt, time);
  perf.mark('props');

  if (started) playTime += dt;
  if (!bot) void cloud.tick();
  saveTimer += dt;
  if (saveTimer > 10) {
    saveTimer = 0;
    saveNow();
  }
  perf.mark('save');
}

/** Draw: everything that only matters for what's on screen, once per frame. */
function present(dt: number) {
  const time = simTime;
  sharedUniforms.uTime.value = time;
  const mount = econ.mount;
  // Thin the haze as the camera pulls back so the whole land is visible.
  const fogD = THREE.MathUtils.lerp(0.0065, 0.0011, THREE.MathUtils.smoothstep(player.zoom, 5, 250));
  planetUniforms.uFogD.value = fogD;
  sharedUniforms.uFogDensity.value = fogD;
  (scene.fog as THREE.FogExp2).density = fogD;
  sky.position.set(camera.position.x, 0, camera.position.z);
  terrain.update(camera);
  world.flush();
  perf.mark('worldFlush');
  flowers.update(camera, time);
  perf.mark('flowers');
  wildlife.update(dt, time, player.pos, !!econ.riding);
  perf.mark('wildlife');
  brookTimer -= dt;
  if (BROOK_SOUND && brookTimer <= 0) {
    brookTimer = 0.25;
    chimes.setWater(started && !ending.active && !bot ? brookLevel() : 0);
  }

  // HUD (throttled)
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.1;
    $('pollen-n').textContent = fmt(econ.pollen);
    if (pollenPulse) {
      pollenPulse = false;
      const el = $('pollen');
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    }
    $('honey').classList.toggle('hidden', !econ.has('hive'));
    $('honey-n').textContent = fmt(econ.honey);
    $('mult').textContent = `pollen ×${econ.multiplier.toFixed(1)}`;
    $('seeds-n').textContent = fmt(econ.seeds);
    $('seeds-cap').textContent = fmt(econ.seedCap);
    $('seeds-bar').style.width = `${(100 * econ.seeds) / econ.seedCap}%`;
    $('seeds').classList.toggle('low', !mount && econ.seeds < Math.max(3, econ.seedCap * 0.1));
    $('mount-seeds').classList.toggle('hidden', !mount);
    if (mount) {
      $('mount-name').textContent = mount.name;
      $('mount-seeds-n').textContent = `${fmt(econ.mountSeeds[mount.id] ?? 0)} / ${fmt(econ.mountCap(mount))} seeds`;
    }
    $('station').textContent = stationText;
    const g = garden.currentGlade(player.pos.x, player.pos.z);
    if (g) {
      const pct = g.total ? g.bloomed / g.total : 1;
      $('glade-name').textContent = g.name;
      $('glade-soil').textContent = SOIL_NAMES[g.soil] + (econ.canWork(g.soil) ? '' : ' (locked)');
      $('glade-pct').textContent = g.completed
        ? 'Restored ✿'
        : `${Math.floor(pct * 100)}% · restore at ${COMPLETE_AT * 100}%`;
      $('glade-bar').style.width = `${Math.min(100, pct * 100)}%`;
    }
    {
      const p = planetProgress();
      const pctText = p.pct >= 99.95 ? '100' : p.pct < 10 ? p.pct.toFixed(2) : p.pct.toFixed(1);
      $('planet-pct').innerHTML = `Planet <b>${pctText}%</b> restored · ${p.done} / ${realGlades} glades`;
      // Another kind of animal comes back.
      const stage = Wildlife.stageAt(p.pct);
      if (started && stage > wildlife.stage) {
        wildlife.stage = stage;
        news(SPECIES[stage - 1].news);
      }
      if (pctText === '100' && !moonRestored && started && !ending.active) {
        moonRestored = true;
        saveNow();
        playEnding();
      }
    }
    let hint = '';
    if (mount) {
      if (econ.activeSeeds < 1) hint = `The ${mount.name} is out of seeds. Ride to the Hollow, a waystone or a cache.`;
    } else if (mouseDown || ['locked', 'creek', 'empty'].includes(garden.aimStatus)) hint = garden.aimHint();
    $('hint').textContent = hint;
    $('crosshair').style.display = !mount && (player.firstPerson || player.zoom < 12) ? 'block' : 'none';
    if (menuKind === 'rings') updateRings();
    if (buildOpen) renderBuild();
    touch?.update();
    if (player.zoom > 8) tips.flag('zoomed');
    tips.update(menuOpen || ending.active || !started);
    renderCompass();
    if (menuOpen) {
      $('shop-pollen').textContent = fmt(econ.pollen);
      $('shop-honey').textContent = fmt(econ.honey);
    }
    shopTimer -= 0.1;
    if (menuKind === 'shop' && shopTimer <= 0) {
      shopTimer = 1;
      refreshShopButtons();
    }
  }
  perf.mark('hud');
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }

  bot?.drawOverlay();
  planetizeTree(scene); // new objects pick up the planet wrap + curve before they draw
  perf.mark('planetize');
  perf.render(scene, camera);
}
frame();

// Debug handle for poking at things from the console.
(window as unknown as { dg: unknown }).dg = {
  world,
  econ,
  garden,
  player,
  stations,
  flowers,
  Soil,
  selectSlot,
  buildCache,
  buildHive,
  buildRing,
  apiary,
  fairies,
  waystones,
  travel,
  perf,
  dayNight,
  chimes,
  tips,
  get challenges() {
    return challenges;
  },
  wildlife,
  brookLevel,
  terrain,
  scenery,
  buildDen,
  buildStone,
  ending,
  playEnding,
  get mouseDown() {
    return mouseDown;
  },
};
