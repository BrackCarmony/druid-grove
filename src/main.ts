import * as THREE from 'three';
import { Apiary } from './apiary';
import { Colliders } from './colliders';
import { Economy, HIVE, MOUNTS, RING, TOOLS, UPGRADES, UpgradeGroup } from './economy';
import { Perf } from './perf';
import { onSettings, settings, updateSettings, VIEW_SCALE, ViewDistance } from './settings';
import { deleteSlot, lastSlot, setLastSlot, SLOT_COUNT, slotInfo, slotKey } from './slots';
import { planetizeTree, planetUniforms } from './planet';
import { Waystone, Waystones } from './waystones';
import { FairyRings, Ring } from './fairies';
import { Chimes, Particles, Song } from './fx';
import { Flowers } from './flowers';
import { COMPLETE_AT, Garden } from './garden';
import { Player } from './player';
import { DeadScenery, HeartTrees } from './props';
import { createSky } from './sky';
import { Stations } from './stations';
import { createTerrain, cursorUniforms, FOG_HEX, sharedUniforms } from './terrain';
import { HALF, SOIL_NAMES, Soil, wdist, World, wrap } from './world';

/** Inline icons (drawn in style.css). */
const HONEY = '<i class="i-honey"></i>';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- scene ----------
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_HEX, sharedUniforms.uFogDensity.value);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);
scene.add(camera);

const sunDir = sharedUniforms.uSunDir.value;
const sun = new THREE.DirectionalLight(0xffdcb8, 2.2);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun, new THREE.HemisphereLight(0xc7a6d6, 0x5a4636, 1.1));

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
});

const apiary = new Apiary(world, econ, colliders);
scene.add(apiary.group);
const fairies = new FairyRings(world, econ, garden, stations, particles);
scene.add(fairies.group);
const waystones = new Waystones(world, colliders);
scene.add(waystones.group);
stations.extraHubs = () => waystones.stones.map((w) => ({ x: w.x, z: w.z, label: w.label }));

interface SaveExtra {
  caches: { x: number; z: number; stock: number }[];
  hives?: { x: number; z: number; honey: number }[];
  rings?: { x: number; z: number }[];
  dens?: { x: number; z: number }[]; // beyond the home den
  bearHomes?: number[];
  stones?: { x: number; z: number }[]; // beyond the home waystone
  trampled?: number[]; // tiles whose boulder the stag smashed
  playTime?: number; // seconds played in this world
}

// The world is generated up front (it's the same planet for every slot); the save
// for the chosen slot is applied on top when the player picks one on the home screen.
let activeSlot = -1;
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
    for (const t of extra.trampled ?? []) scenery.smash(t);
    playTime = extra.playTime ?? 0;
  }
  apiary.syncBears(extra?.bearHomes);
  fairies.syncFairies(); // wayfarers
  flowers.reset(); // chunks streamed in behind the home screen predate the save
  player.setTool(econ.current);
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
      if (econ.autoPlant) toast(`Riding the ${s.def.name}. It plants as it walks (F to toggle).`);
    }
  }
  renderHotbar();
}

function card(name: string, desc: string, label: string, enabled: boolean, onBuy: () => void) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<div class="name">${name}</div><div class="desc">${desc}</div>`;
  const b = document.createElement('button');
  b.innerHTML = label;
  b.disabled = !enabled;
  b.onclick = onBuy;
  el.appendChild(b);
  return el;
}

function renderShop() {
  $('shop-pollen').textContent = fmt(econ.pollen);
  $('shop-honey').textContent = fmt(econ.honey);
  const bought = (msg: string) => {
    chimes.purchase();
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
      card(t.name, t.blurb, owned ? 'Owned' : `✿ ${fmt(t.cost)}`, !owned && econ.pollen >= t.cost, () => {
        if (econ.buyTool(t)) {
          econ.riding = null;
          player.ride(null);
          player.setTool(t.id);
          bought(`${t.name} acquired!`);
        }
      }),
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
      card(m.name, desc, label, !owned && !needs && econ.pollen >= m.cost, () => {
        if (econ.buyMount(m)) bought(`${m.name} joined you! Press ${TOOLS.length + i + 1} to ride.`);
      }),
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
        needs ? 'Build a Beehive first (H)' : `✿ ${fmt(cost)}`,
        !needs && econ.pollen >= cost,
        () => {
          if (econ.pollen < econ.bearCost) return;
          econ.pollen -= econ.bearCost;
          econ.bears++;
          apiary.syncBears();
          const den = apiary.bears[apiary.bears.length - 1].den;
          bought(
            `A bear lumbers out of the ${den === apiary.home ? 'home den' : den.label.replace('Bear Den · ', 'den at ')}.`,
          );
        },
      ),
    );
  }

  const groups: UpgradeGroup[] = ['planting', 'seeds', 'squirrels', 'soil', 'hives', 'fairies'];
  for (const grp of groups) {
    const box = $(`shop-${grp}`);
    if (grp !== 'hives') box.innerHTML = '';
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
        card(name, u.blurb(lvl), label, !maxed && !needs && econ.wallet(u.currency) >= cost, () => {
          if (econ.buyUpgrade(u)) {
            if (u.id === 'family') stations.syncSquirrels();
            if (u.id === 'flock') fairies.syncFairies();
            bought(`${u.name}${u.max > 1 ? ` Lv ${econ.level(u.id)}` : ''}`);
          }
        }),
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
      !needs && econ.honey >= cost,
      () => {
        if (econ.honey < econ.wayfarerCost) return;
        econ.honey -= econ.wayfarerCost;
        econ.wayfarers++;
        fairies.syncFairies();
        bought('A wayfarer fairy sets out from the Seed Hollow.');
      },
    ),
  );
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
  if (!econ.has('hive')) return toast('Fairy rings cost honey. Build a Beehive (H) first.');
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
  return null;
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
  const st = waystones.build(p[0], p[1]);
  built(p[0], p[1], 0x8fe8ff, `${st.label} raised! Stand in any waystone and press T to travel.`);
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
];
let buildOpen = false;

function showBuild(open: boolean) {
  buildOpen = open;
  $('build').classList.toggle('hidden', !open);
  if (open) renderBuild();
}

function renderBuild() {
  $('build-list').innerHTML = BUILDS.map(
    (b, i) =>
      `<div class="build-opt${b.ok() ? '' : ' no'}"><span class="k">${i + 1}</span>${b.name}<span class="cost">${b.cost()}</span></div>`,
  ).join('');
}

// ---------- waystone travel (T) ----------
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
  for (const d of near(apiary.dens.slice(1), 3)) mark(d.x, d.z, 'den', '●');
  const hd = Math.round(wdist(player.pos.x, player.pos.z, stations.hollow.x, stations.hollow.z));
  mark(stations.hollow.x, stations.hollow.z, 'home', '⌂', `${fmt(hd)}m`, true);
  $('compass-strip').innerHTML = html;
}

// ---------- input ----------
/** Any full-screen menu is open (the game pauses input while one is). */
let menuOpen = false;
type MenuKind = 'shop' | 'rings' | 'travel';
let menuKind: MenuKind | null = null;
let started = false;
let mouseDown = false;
let skipSave = false;

function lock() {
  canvas.requestPointerLock?.();
}

function openMenu(kind: MenuKind | null) {
  menuKind = kind;
  menuOpen = kind !== null;
  showBuild(false);
  $('shop').classList.toggle('hidden', kind !== 'shop');
  $('rings').classList.toggle('hidden', kind !== 'rings');
  $('travel').classList.toggle('hidden', kind !== 'travel');
  if (kind === 'shop') renderShop();
  if (kind === 'rings') renderRings();
  if (kind === 'travel') renderTravel(waystones.nearby(player.pos)!);
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
    fairies.refreshCounts();
    const now = finishedRings();
    const refund = ringRefund(now.length);
    for (const r of now) fairies.remove(r);
    econ.ringsBuilt -= now.length;
    econ.honey += refund;
    chimes.purchase();
    toast(
      `${now.length} finished ring${now.length === 1 ? '' : 's'} removed. ${HONEY} ${fmt(refund)} returned. Build them somewhere new with R.`,
    );
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
    list.innerHTML = '<p class="dim">No fairy rings yet. Press <b>R</b> to build one (costs honey).</p>';
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
  if (skipSave || activeSlot < 0) return;
  const extra: SaveExtra = {
    caches: stations.caches.map((c) => ({ x: c.x, z: c.z, stock: c.stock })),
    hives: apiary.hives.map((h) => ({ x: h.x, z: h.z, honey: h.honey })),
    rings: fairies.rings.map((r) => ({ x: r.x, z: r.z })),
    dens: apiary.dens.slice(1).map((d) => ({ x: d.x, z: d.z })),
    bearHomes: apiary.bearHomes(),
    stones: waystones.stones.slice(1).map((w) => ({ x: w.x, z: w.z })),
    trampled: [...scenery.trampled],
    playTime,
  };
  garden.save(player, extra);
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
  // "forest" loops seamlessly end to end.
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

function showHome(panel: 'main' | 'settings' | 'credits') {
  $('home-main').classList.toggle('hidden', panel !== 'main');
  $('home-settings').classList.toggle('hidden', panel !== 'settings');
  $('home-credits').classList.toggle('hidden', panel !== 'credits');
}
$('open-settings').onclick = () => showHome('settings');
$('open-credits').onclick = () => showHome('credits');
for (const b of document.querySelectorAll<HTMLButtonElement>('.home-panel .back')) b.onclick = () => showHome('main');

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

function startGame(i: number) {
  if (started) return;
  setLastSlot(i);
  loadSlot(i);
  started = true;
  $('start').classList.add('hidden');
  chimes.resume();
  lock();
  if (!loaded) toast('Hold the mouse to press a seed into the dirt.');
}
canvas.addEventListener('click', () => {
  if (started && !menuOpen && document.pointerLockElement !== canvas) lock();
});
$('home').onclick = () => {
  saveNow();
  skipSave = true;
  location.reload(); // back to the home screen (it shows on every load)
};

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) player.look(e.movementX, e.movementY);
});
addEventListener('mousedown', (e) => {
  if (e.button === 0 && document.pointerLockElement === canvas) mouseDown = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});
addEventListener('wheel', (e) => {
  if (document.pointerLockElement === canvas) player.scroll(e.deltaY);
});
addEventListener('keydown', (e) => {
  if (!started || e.repeat) return;
  if (e.code === 'Escape' && menuOpen) return openMenu(null);
  if (e.code === 'F3') {
    e.preventDefault();
    return perf.toggleOverlay();
  }
  if (e.code === 'KeyE') return openMenu(menuKind === 'shop' ? null : 'shop');
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
  if (e.code === 'KeyT') {
    if (waystones.nearby(player.pos)) openMenu('travel');
    else toast('Stand in a waystone to travel. Build them from the B menu.');
  }
  if (e.code === 'KeyH') buildHive();
  if (e.code === 'KeyR') buildRing();
  if (e.code === 'KeyF') {
    econ.autoPlant = !econ.autoPlant;
    toast(econ.autoPlant ? 'Mount auto-planting on' : 'Mount auto-planting off');
  }
  if (e.code === 'KeyM') {
    chimes.setMuted(!chimes.muted);
    toast(chimes.muted ? 'Sound off' : 'Sound on');
  }
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) mouseDown = false;
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
addEventListener('beforeunload', saveNow);

// ---------- loop ----------
const clock = new THREE.Clock();
let saveTimer = 0;
let hudTimer = 0;
let wasFull = true;
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

function frame() {
  perf.begin();
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  sharedUniforms.uTime.value = time;

  if (!menuOpen) player.update(dt, time);
  perf.mark('player');
  // Thin the haze as the camera pulls back so the whole land is visible.
  const fogD = THREE.MathUtils.lerp(0.0065, 0.0011, THREE.MathUtils.smoothstep(player.zoom, 5, 250));
  planetUniforms.uFogD.value = fogD;
  sharedUniforms.uFogDensity.value = fogD;
  (scene.fog as THREE.FogExp2).density = fogD;
  sky.position.set(camera.position.x, 0, camera.position.z);
  terrain.update(camera);

  const mount = econ.mount;
  garden.updateAim(camera, player.pos);
  if (mount) {
    // Show the mount's planting footprint instead of the hand cursor.
    cursorUniforms.uCursor.value.set(player.pos.x, player.pos.z, mount.radius);
    cursorUniforms.uCursorState.value = !econ.autoPlant ? 0 : econ.activeSeeds >= 1 ? 1 : 2;
    if (econ.autoPlant && !menuOpen) garden.workMount(dt, player.pos.x, player.pos.z, mount);
  } else {
    const st = garden.aimStatus;
    cursorUniforms.uCursorState.value = st === 'none' ? 0 : st === 'ok' || st === 'done' ? 1 : 2;
    cursorUniforms.uCursor.value.set(garden.aim.x, garden.aim.z, econ.tool.radius);
    if (mouseDown && !menuOpen && garden.work(dt)) player.workAnim = 1;
  }

  // Seed refills
  const src = stations.nearby(player.pos);
  let stationText = '';
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
    if (stone) {
      // Waystones are seed hubs too.
      econ.refill(1500 * dt);
      stationText = `${stone.label} · refilling seeds · press T to travel`;
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
  particles.update(dt, time);
  perf.mark('props');
  world.flush();
  perf.mark('worldFlush');
  flowers.update(camera, time);
  perf.mark('flowers');

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
    }
    let hint = '';
    if (mount) {
      if (econ.activeSeeds < 1) hint = `The ${mount.name} is out of seeds. Ride to the Hollow, a waystone or a cache.`;
    } else if (mouseDown || ['locked', 'creek', 'empty'].includes(garden.aimStatus)) hint = garden.aimHint();
    $('hint').textContent = hint;
    $('crosshair').style.display = !mount && (player.firstPerson || player.zoom < 12) ? 'block' : 'none';
    if (menuKind === 'rings') updateRings();
    if (buildOpen) renderBuild();
    renderCompass();
    if (menuOpen) {
      $('shop-pollen').textContent = fmt(econ.pollen);
      $('shop-honey').textContent = fmt(econ.honey);
    }
  }
  perf.mark('hud');
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }

  if (started) playTime += dt;
  saveTimer += dt;
  if (saveTimer > 10) {
    saveTimer = 0;
    saveNow();
  }
  perf.mark('save');

  planetizeTree(scene); // new objects pick up the planet wrap + curve before they draw
  perf.mark('planetize');
  perf.render(scene, camera);
  perf.end();
  if (firstFrame) {
    firstFrame = false;
    perf.load({ script: tScript, world: tWorld, ready: tReady, firstFrame: performance.now() });
  }
  requestAnimationFrame(frame);
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
  chimes,
  terrain,
  scenery,
  buildDen,
  buildStone,
  get mouseDown() {
    return mouseDown;
  },
};
