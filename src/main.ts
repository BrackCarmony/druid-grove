import * as THREE from 'three';
import { Economy, TOOLS, UPGRADES } from './economy';
import { Chimes, Particles } from './fx';
import { Flowers } from './flowers';
import { COMPLETE_AT, Garden } from './garden';
import { Player } from './player';
import { DeadScenery, HeartTrees } from './props';
import { createSky } from './sky';
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
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2000);
scene.add(camera);

const sunDir = sharedUniforms.uSunDir.value;
const sun = new THREE.DirectionalLight(0xffdcb8, 2.2);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun, new THREE.HemisphereLight(0xc7a6d6, 0x5a4636, 1.1));

const world = new World();
scene.add(createTerrain(world));
const sky = createSky();
scene.add(sky);
const scenery = new DeadScenery(world);
scene.add(scenery.group);

let plantable = 0;
for (const g of world.glades) plantable += g.total;
const flowers = new Flowers(plantable * 3);
scene.add(flowers.group);
const hearts = new HeartTrees(world);
scene.add(hearts.group);
const particles = new Particles();
scene.add(particles.points);

const econ = new Economy();
const chimes = new Chimes();
const player = new Player(world, camera);
scene.add(player.model);

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

const loaded = garden.load(player);
player.setTool(econ.current);

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

function renderHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  TOOLS.forEach((t, i) => {
    const owned = econ.tools.has(t.id);
    const d = document.createElement('div');
    d.className = 'slot' + (econ.current === t.id ? ' active' : '') + (owned ? '' : ' locked');
    d.innerHTML = `<div class="k">${i + 1}</div><div>${t.name}</div>${owned ? '' : `<div class="k">✿ ${fmt(t.cost)}</div>`}`;
    bar.appendChild(d);
  });
}

function selectTool(i: number) {
  const t = TOOLS[i];
  if (!t || !econ.tools.has(t.id)) return;
  econ.current = t.id;
  player.setTool(t.id);
  renderHotbar();
}

function renderShop() {
  $('shop-pollen').textContent = fmt(econ.pollen);
  const tools = $('shop-tools');
  tools.innerHTML = '';
  for (const t of TOOLS) {
    if (t.cost === 0) continue;
    const owned = econ.tools.has(t.id);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="name">${t.name}</div><div class="desc">${t.blurb}</div>`;
    const b = document.createElement('button');
    b.textContent = owned ? 'Owned' : `✿ ${fmt(t.cost)}`;
    b.disabled = owned || econ.pollen < t.cost;
    b.onclick = () => {
      if (econ.buyTool(t)) {
        chimes.purchase();
        player.setTool(t.id);
        toast(`${t.name} acquired!`);
        renderShop();
        renderHotbar();
      }
    };
    card.appendChild(b);
    tools.appendChild(card);
  }
  const ups = $('shop-upgrades');
  ups.innerHTML = '';
  for (const u of UPGRADES) {
    const lvl = econ.level(u.id);
    const maxed = lvl >= u.max;
    const needs = u.requiresTool && !econ.tools.has(u.requiresTool);
    const cost = econ.upgradeCost(u);
    const card = document.createElement('div');
    card.className = 'card';
    const lvlText = u.max > 1 ? ` <span class="desc">Lv ${lvl}/${u.max}</span>` : '';
    card.innerHTML = `<div class="name">${u.name}${lvlText}</div><div class="desc">${u.blurb(lvl)}</div>`;
    const b = document.createElement('button');
    if (maxed) b.textContent = u.max === 1 ? 'Owned' : 'Maxed';
    else if (needs) b.textContent = `Requires ${TOOLS.find((t) => t.id === u.requiresTool)!.name}`;
    else b.textContent = `✿ ${fmt(cost)}`;
    b.disabled = maxed || !!needs || econ.pollen < cost;
    b.onclick = () => {
      if (econ.buyUpgrade(u)) {
        chimes.purchase();
        toast(`${u.name}${u.max > 1 ? ` Lv ${econ.level(u.id)}` : ''}`);
        renderShop();
      }
    };
    card.appendChild(b);
    ups.appendChild(card);
  }
}

// ---------- input ----------
let shopOpen = false;
let started = false;
let mouseDown = false;

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
let resetArmed = false;
let skipSave = false;

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
  if (!started) return;
  if (e.code === 'KeyE' || (e.code === 'Escape' && shopOpen)) openShop(!shopOpen);
  if (e.code.startsWith('Digit')) selectTool(Number(e.code.slice(5)) - 1);
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
addEventListener('beforeunload', () => {
  if (!skipSave) garden.save(player);
});

// ---------- loop ----------
const clock = new THREE.Clock();
let saveTimer = 0;
let hudTimer = 0;
renderHotbar();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  sharedUniforms.uTime.value = time;

  if (!shopOpen) player.update(dt, time);
  // Thin the haze as the camera pulls back so the whole land is visible.
  const fogD = THREE.MathUtils.lerp(0.0065, 0.0016, THREE.MathUtils.smoothstep(player.zoom, 5, 120));
  sharedUniforms.uFogDensity.value = fogD;
  (scene.fog as THREE.FogExp2).density = fogD;
  sky.position.set(camera.position.x, 0, camera.position.z);

  garden.updateAim(camera, player.pos);
  const st = garden.aimStatus;
  cursorUniforms.uCursorState.value = st === 'none' ? 0 : st === 'ok' || st === 'done' ? 1 : 2;
  cursorUniforms.uCursor.value.set(garden.aim.x, garden.aim.z, econ.tool.radius);

  if (mouseDown && !shopOpen) {
    if (garden.work(dt)) player.workAnim = 1;
  }
  garden.update(dt, time);
  hearts.update(time);
  particles.update(dt, time);
  world.flush();
  flowers.flush();

  // HUD (throttled)
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.1;
    $('pollen-n').textContent = fmt(econ.pollen);
    $('mult').textContent = `pollen ×${econ.multiplier.toFixed(1)}`;
    const g = garden.currentGlade(player.pos.x, player.pos.z);
    if (g) {
      const pct = g.bloomed / g.total;
      $('glade-name').textContent = g.name;
      $('glade-soil').textContent = SOIL_NAMES[g.soil] + (econ.canWork(g.soil) ? '' : ' (locked)');
      $('glade-pct').textContent = g.completed
        ? 'Restored ✿'
        : `${Math.floor(pct * 100)}% · restore at ${COMPLETE_AT * 100}%`;
      $('glade-bar').style.width = `${Math.min(100, pct * 100)}%`;
    }
    $('hint').textContent =
      mouseDown || garden.aimStatus === 'locked' || garden.aimStatus === 'creek' ? garden.aimHint() : '';
    $('crosshair').style.display = player.firstPerson || player.zoom < 12 ? 'block' : 'none';
    if (shopOpen) $('shop-pollen').textContent = fmt(econ.pollen);
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }

  saveTimer += dt;
  if (saveTimer > 10) {
    saveTimer = 0;
    garden.save(player);
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
  Soil,
  get mouseDown() {
    return mouseDown;
  },
};
