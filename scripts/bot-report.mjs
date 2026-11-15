#!/usr/bin/env node
// Summarise a pacing-bot run (bot-runs/*.json, written when a ?bot=1 run finishes).
//   node scripts/bot-report.mjs            the newest run
//   node scripts/bot-report.mjs <file>     a particular one
import { readdirSync, readFileSync } from 'node:fs';

const file =
  process.argv[2] ??
  'bot-runs/' +
    readdirSync('bot-runs')
      .filter((f) => f.endsWith('.json'))
      .sort()
      .pop();
const r = JSON.parse(readFileSync(file, 'utf8'));

const hm = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
const n = (v) =>
  v >= 1e9
    ? (v / 1e9).toFixed(1) + 'B'
    : v >= 1e6
      ? (v / 1e6).toFixed(1) + 'M'
      : v >= 1e4
        ? (v / 1e3).toFixed(1) + 'K'
        : String(v);

console.log(`${file}`);
console.log(
  `options ${JSON.stringify(r.options)} · ${hm(r.gameSeconds)} game time in ${r.realSeconds}s · ${r.finished ? 'PLANET RESTORED' : 'not finished'} · stuck ${r.stuck}×`,
);
if (r.challenges) {
  const c = r.challenges;
  const ok = (broken) => (broken ? 'broken' : 'kept');
  console.log(
    `challenges: Home Sweet Home ${ok(c.waystone)} · Lonely Bears ${ok(c.bear)} · Fairies are Forever ${ok(c.ringRemoved)}`,
  );
}
const recalls = r.events.filter((e) => e.type === 'recall');
console.log(
  `waystone trips ${r.travels ?? 0} · rings recalled ${recalls.reduce((n, e) => n + parseInt(e.name), 0)} (in ${recalls.length} sweeps) · waystones built ${r.events.filter((e) => e.name === 'Waystone').length}`,
);
const total = Object.values(r.modes).reduce((a, b) => a + b, 0);
console.log(
  'time spent: ' +
    Object.entries(r.modes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${((100 * v) / total).toFixed(1)}%`)
      .join(' · '),
);

// Milestones: the first time each kind of thing happened.
console.log('\nmilestones');
const seen = new Set();
const key = (e) => (e.type === 'glade' ? null : `${e.type}:${e.name}`);
const firsts = r.events.filter((e) => {
  const k = key(e);
  if (!k || e.type === 'note' || seen.has(k)) return false;
  seen.add(k);
  return true;
});
for (const e of firsts)
  console.log(
    `  ${hm(e.t).padStart(5)}  ${e.type.padEnd(5)} ${e.name.padEnd(24)} ${e.cost !== undefined ? (e.currency === 'honey' ? 'honey ' : '✿ ') + n(e.cost) : ''}`.padEnd(
      60,
    ) + `planet ${e.pct}%`,
  );

// Planet progress every 10 minutes of game time.
console.log('\nevery 10 min   planet   glades  lifetime ✿   ✿/min   honey/min  ×mult  riding');
let prev = null;
for (const s of r.snapshots) {
  if (s.t % 600 > 60 && s !== r.snapshots[r.snapshots.length - 1]) continue;
  const rate = prev ? (s.lifetimePollen - prev.lifetimePollen) / ((s.t - prev.t) / 60) : 0;
  const hr = prev ? (s.lifetimeHoney - prev.lifetimeHoney) / ((s.t - prev.t) / 60) : 0;
  console.log(
    `  ${hm(s.t).padStart(5)}  ${(s.pct.toFixed(2) + '%').padStart(7)}  ${String(s.glades).padStart(6)}  ${n(s.lifetimePollen).padStart(10)}  ${n(Math.round(rate)).padStart(6)}  ${n(Math.round(hr)).padStart(9)}  ${s.mult.toFixed(1).padStart(5)}  ${s.mount || s.tool}`,
  );
  prev = s;
}

// Dry spells: long stretches with nothing bought or built.
const buys = r.events.filter((e) => e.type === 'buy' || e.type === 'build').map((e) => e.t);
const gaps = [];
for (let i = 1; i < buys.length; i++) gaps.push([buys[i] - buys[i - 1], buys[i - 1]]);
gaps.sort((a, b) => b[0] - a[0]);
console.log('\nlongest gaps between purchases');
for (const [g, t] of gaps.slice(0, 5)) console.log(`  ${(g / 60).toFixed(1)} min after ${hm(t)}`);
const notes = r.events.filter((e) => e.type === 'note');
if (notes.length) {
  const c = {};
  for (const e of notes) c[e.name] = (c[e.name] ?? 0) + 1;
  console.log(
    '\nbot notes: ' +
      Object.entries(c)
        .map(([k, v]) => `${k} ×${v}`)
        .join(', '),
  );
}
