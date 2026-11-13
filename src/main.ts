import * as THREE from 'three';
import { Colliders } from './colliders';
import { Economy, MOUNTS, TOOLS, UPGRADES, UpgradeGroup } from './economy';
import { Chimes, Particles } from './fx';
import { Flowers } from './flowers';
import { COMPLETE_AT, Garden } from './garden';
import { Player } from './player';
import { DeadScenery, HeartTrees } from './props';
import { createSky } from './sky';
import { Stations } from './stations';
import { createTerrain, cursorUniforms, FOG_HEX, sharedUniforms } from './terrain';
import { SOIL_NAMES, Soil, World } from './world';

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

const world = new World();
const colliders = new Colliders();
scene.add(createTerrain(world));
const sky = createSky();
scene.add(sky);
const scenery = new DeadScenery(world, colliders);
scene.add(scenery.group);

const flowers = new Flowers();
scene.add(flowers.group);
const hearts = new HeartTrees(world, colliders);
scene.add(hearts.group);
const particles = new Particles();
scene.add(particles.points);

const econ = new Economy();
const chimes = new Chimes();
const player = new Player(world, camera, colliders);
scene.add(player.model);
const stations = new Stations(world, econ, colliders);
scene.add(stations.group);

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg: string, big = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show' + (big ? ' big' : '');
  toastTimer = big ? 5 : 2.5;
}

const garden = new Garden(world, econ, flowers, hearts, scenery, particles, chimes, {
  toast,
  earned: () => {
    const el = $('pollen');
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  },
});

interface SaveExtra {
  caches: { x: number; z: number; stock: number }[];
}
const loaded = garden.load(player);
if (loaded) {
  const extra = loaded.extra as SaveExtra | undefined;
  for (const c of extra?.caches ?? []) stations.build(c.x, c.z, c.stock);
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
  b.textContent = label;
  b.disabled = !enabled;
  b.onclick = onBuy;
  el.appendChild(b);
  return el;
}

function renderShop() {
  $('shop-pollen').textContent = fmt(econ.pollen);
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

  const groups: UpgradeGroup[] = ['planting', 'seeds', 'squirrels', 'soil'];
  for (const grp of groups) {
    const box = $(`shop-${grp}`);
    box.innerHTML = '';
    for (const u of UPGRADES.filter((x) => x.group === grp)) {
      const lvl = econ.level(u.id);
      const maxed = lvl >= u.max;
      const needs = u.requires && !econ.has(u.requires);
      const cost = econ.upgradeCost(u);
      const name = u.max > 1 ? `${u.name} <span class="desc">Lv ${lvl}/${u.max}</span>` : u.name;
      let label = `✿ ${fmt(cost)}`;
      if (maxed) label = u.max === 1 ? 'Owned' : 'Maxed';
      else if (needs) label = `Requires ${econ.nameOf(u.requires!)}`;
      box.appendChild(
        card(name, u.blurb(lvl), label, !maxed && !needs && econ.pollen >= cost, () => {
          if (econ.buyUpgrade(u)) {
            if (u.id === 'family') stations.syncSquirrels();
            bought(`${u.name}${u.max > 1 ? ` Lv ${econ.level(u.id)}` : ''}`);
          }
        }),
      );
    }
  }
}

function buildCache() {
  const cost = econ.cacheCost;
  let x = player.pos.x;
  let z = player.pos.z;
  if (!econ.riding && garden.aimValid) {
    const d = Math.hypot(garden.aim.x - x, garden.aim.z - z);
    if (d > 8) return toast('Too far away to build there.');
    x = garden.aim.x;
    z = garden.aim.z;
  }
  const t = world.tileAt(x, z);
  if (t < 0 || world.soil[t] === Soil.Creek) return toast("Can't build in a creek bed.");
  const why = stations.canBuildAt(x, z);
  if (why) return toast(why + '.');
  if (econ.pollen < cost) {
    chimes.deny();
    return toast(`A squirrel cache costs ✿ ${fmt(cost)}.`);
  }
  econ.pollen -= cost;
  econ.cachesBuilt++;
  stations.build(x, z);
  chimes.purchase();
  particles.burst(x, world.heightAt(x, z) + 1, z, 0xffd36b, 50, 1.5, 2);
  toast(`Squirrel cache built! Next one costs ✿ ${fmt(econ.cacheCost)}.`);
}

// ---------- input ----------
let shopOpen = false;
let started = false;
let mouseDown = false;
let resetArmed = false;
let skipSave = false;

function lock() {
  canvas.requestPointerLock?.();
}

function openShop(open: boolean) {
  shopOpen = open;
  $('shop').classList.toggle('hidden', !open);
  if (open) {
    renderShop();
    document.exitPointerLock?.();
  } else {
    lock();
  }
}

function saveNow() {
  if (skipSave) return;
  const extra: SaveExtra = { caches: stations.caches.map((c) => ({ x: c.x, z: c.z, stock: c.stock })) };
  garden.save(player, extra);
}

$('play').onclick = () => {
  started = true;
  $('start').classList.add('hidden');
  chimes.resume();
  lock();
  if (!loaded) toast('Hold the mouse to press a seed into the dirt.');
};
canvas.addEventListener('click', () => {
  if (started && !shopOpen && document.pointerLockElement !== canvas) lock();
});
$('reset').onclick = () => {
  if (resetArmed) {
    Garden.wipe();
    skipSave = true;
    location.reload();
  } else {
    resetArmed = true;
    $('reset').textContent = 'Click again to wipe everything';
  }
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
  if (e.code === 'KeyE' || (e.code === 'Escape' && shopOpen)) openShop(!shopOpen);
  if (shopOpen) return;
  if (e.code.startsWith('Digit')) selectSlot(Number(e.code.slice(5)) - 1);
  if (e.code === 'KeyB') buildCache();
  if (e.code === 'KeyF') {
    econ.autoPlant = !econ.autoPlant;
    toast(econ.autoPlant ? 'Mount auto-planting on' : 'Mount auto-planting off');
  }
  if (e.code === 'KeyM') {
    chimes.muted = !chimes.muted;
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

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  sharedUniforms.uTime.value = time;

  if (!shopOpen) player.update(dt, time);
  // Thin the haze as the camera pulls back so the whole land is visible.
  const fogD = THREE.MathUtils.lerp(0.0065, 0.0011, THREE.MathUtils.smoothstep(player.zoom, 5, 250));
  sharedUniforms.uFogDensity.value = fogD;
  (scene.fog as THREE.FogExp2).density = fogD;
  sky.position.set(camera.position.x, 0, camera.position.z);

  const mount = econ.mount;
  garden.updateAim(camera, player.pos);
  if (mount) {
    // Show the mount's planting footprint instead of the hand cursor.
    cursorUniforms.uCursor.value.set(player.pos.x, player.pos.z, mount.radius);
    cursorUniforms.uCursorState.value = !econ.autoPlant ? 0 : econ.activeSeeds >= 1 ? 1 : 2;
    if (econ.autoPlant && !shopOpen) garden.workMount(dt, player.pos.x, player.pos.z, mount);
  } else {
    const st = garden.aimStatus;
    cursorUniforms.uCursorState.value = st === 'none' ? 0 : st === 'ok' || st === 'done' ? 1 : 2;
    cursorUniforms.uCursor.value.set(garden.aim.x, garden.aim.z, econ.tool.radius);
    if (mouseDown && !shopOpen && garden.work(dt)) player.workAnim = 1;
  }

  // Seed refills
  const src = stations.nearby(player.pos);
  let stationText = '';
  if (src?.kind === 'hollow') {
    econ.refill(400 * dt);
    stationText = 'Seed Hollow · refilling';
  } else if (src?.kind === 'cache') {
    const used = econ.refill(Math.min(src.cache.stock, 120 * dt));
    src.cache.stock -= used;
    stationText = `${src.cache.label} · ${Math.floor(src.cache.stock)} / ${econ.cacheStockCap} seeds · ${econ.squirrelsPerCache} squirrel${econ.squirrelsPerCache > 1 ? 's' : ''}`;
  }
  const full = econ.seeds >= econ.seedCap && (!mount || (econ.mountSeeds[mount.id] ?? 0) >= econ.mountCap(mount));
  if (src && full && !wasFull) chimes.purchase();
  wasFull = full;

  garden.update(dt, time);
  stations.update(dt, time, player.pos);
  hearts.update(time);
  particles.update(dt, time);
  world.flush();
  flowers.update(camera);

  // HUD (throttled)
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.1;
    $('pollen-n').textContent = fmt(econ.pollen);
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
    let hint = '';
    if (mount) {
      if (econ.activeSeeds < 1) hint = `The ${mount.name} is out of seeds. Ride back to the Hollow or a cache.`;
    } else if (mouseDown || ['locked', 'creek', 'empty'].includes(garden.aimStatus)) hint = garden.aimHint();
    $('hint').textContent = hint;
    $('crosshair').style.display = !mount && (player.firstPerson || player.zoom < 12) ? 'block' : 'none';
    if (shopOpen) $('shop-pollen').textContent = fmt(econ.pollen);
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }

  saveTimer += dt;
  if (saveTimer > 10) {
    saveTimer = 0;
    saveNow();
  }

  renderer.render(scene, camera);
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
  get mouseDown() {
    return mouseDown;
  },
};
