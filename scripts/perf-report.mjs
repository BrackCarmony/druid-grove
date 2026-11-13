#!/usr/bin/env node
// Summarise perf reports pulled from the server (npm run perf pulls first, then runs this).
//   node scripts/perf-report.mjs [--file perf-data/perf.jsonl] [--since 2026-11-01] [--build abc1234]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const file = opt('file', 'perf-data/perf.jsonl');
const since = opt('since');
const build = opt('build');

const rows = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try {
    const outer = JSON.parse(line);
    const r = JSON.parse(outer.body);
    r.ua = outer.ua;
    if (since && new Date(r.t) < new Date(since)) continue;
    if (build && r.build !== build) continue;
    rows.push(r);
  } catch {
    // ignore junk lines
  }
}
const loads = rows.filter((r) => r.kind === 'load');
const wins = rows.filter((r) => r.kind === 'window' && r.frames > 0);
if (!wins.length) {
  console.log(`No frame reports in ${file}${since ? ` since ${since}` : ''}${build ? ` for build ${build}` : ''}.`);
  process.exit(0);
}

const med = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const q = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const f = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
function table(head, body) {
  const all = [head, ...body].map((r) => r.map(String));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  console.log(line(all[0]));
  console.log(w.map((n) => '─'.repeat(n)).join('  '));
  for (const r of all.slice(1)) console.log(line(r));
  console.log();
}
const totalFrames = wins.reduce((n, w) => n + w.frames, 0);
const sessions = new Set(rows.map((r) => r.sid));
const minutes = wins.reduce((n, w) => n + w.dur, 0) / 60;

console.log(
  `\n${rows.length} reports · ${sessions.size} sessions · ${f(minutes, 0)} min played · ${totalFrames} frames`,
);
console.log(`builds: ${[...new Set(rows.map((r) => r.build))].join(', ')}\n`);

console.log('FRAME PACING (per 30 s window)');
table(
  ['', 'median', 'worst 10%'],
  [
    [
      'fps',
      f(med(wins.map((w) => w.fps))),
      f(
        q(
          wins.map((w) => w.fps),
          0.1,
        ),
      ),
    ],
    [
      'p90 frame ms',
      f(med(wins.map((w) => w.interval[1]))),
      f(
        q(
          wins.map((w) => w.interval[1]),
          0.9,
        ),
      ),
    ],
    [
      'p99 frame ms',
      f(med(wins.map((w) => w.interval[2]))),
      f(
        q(
          wins.map((w) => w.interval[2]),
          0.9,
        ),
      ),
    ],
    [
      'js ms (p50)',
      f(med(wins.map((w) => w.cpu[0])), 2),
      f(
        q(
          wins.map((w) => w.cpu[0]),
          0.9,
        ),
        2,
      ),
    ],
    [
      'js ms (p99)',
      f(med(wins.map((w) => w.cpu[2])), 2),
      f(
        q(
          wins.map((w) => w.cpu[2]),
          0.9,
        ),
        2,
      ),
    ],
    [
      'gpu ms (p50)',
      f(med(wins.filter((w) => w.gpu).map((w) => w.gpu[0])), 2),
      f(
        q(
          wins.filter((w) => w.gpu).map((w) => w.gpu[0]),
          0.9,
        ),
        2,
      ),
    ],
    [
      'frames >34ms',
      f(med(wins.map((w) => w.long[1])), 0),
      f(
        q(
          wins.map((w) => w.long[1]),
          0.9,
        ),
        0,
      ),
    ],
    [
      'draw calls',
      f(med(wins.map((w) => w.draw.calls)), 0),
      f(
        q(
          wins.map((w) => w.draw.calls),
          0.9,
        ),
        0,
      ),
    ],
    [
      'triangles (k)',
      f(med(wins.map((w) => w.draw.tris / 1000)), 0),
      f(
        q(
          wins.map((w) => w.draw.tris / 1000),
          0.9,
        ),
        0,
      ),
    ],
  ],
);

console.log('WHERE THE JS TIME GOES (mean ms per frame, weighted by frames)');
const secs = new Map();
for (const w of wins) {
  for (const [k, [mean, max]] of Object.entries(w.sections)) {
    const s = secs.get(k) ?? { sum: 0, maxes: [] };
    s.sum += mean * w.frames;
    s.maxes.push(max);
    secs.set(k, s);
  }
}
const jsTotal = [...secs.values()].reduce((n, s) => n + s.sum, 0);
table(
  ['section', 'ms/frame', 'share', 'spike p50', 'spike p90', 'worst'],
  [...secs.entries()]
    .sort((a, b) => b[1].sum - a[1].sum)
    .map(([k, s]) => [
      k,
      f(s.sum / totalFrames, 3),
      `${f((100 * s.sum) / jsTotal, 0)}%`,
      f(med(s.maxes), 1),
      f(q(s.maxes, 0.9), 1),
      f(Math.max(...s.maxes), 1),
    ]),
);

console.log('BY DEVICE');
const byGpu = new Map();
for (const w of wins) {
  const key = `${w.device ?? '?'} @${w.w}x${w.h}x${w.dpr}`;
  byGpu.set(key, [...(byGpu.get(key) ?? []), w]);
}
table(
  ['gpu / viewport', 'sessions', 'min', 'fps', 'p99 ms', 'js ms', 'render ms'],
  [...byGpu.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, ws]) => [
      k.length > 60 ? k.slice(0, 57) + '…' : k,
      new Set(ws.map((w) => w.sid)).size,
      f(ws.reduce((n, w) => n + w.dur, 0) / 60, 0),
      f(med(ws.map((w) => w.fps))),
      f(med(ws.map((w) => w.interval[2]))),
      f(med(ws.map((w) => w.cpu[0])), 2),
      f(med(ws.map((w) => w.sections.render?.[0] ?? NaN)), 2),
    ]),
);

function bucketed(title, key, edges) {
  console.log(title);
  const label = (v) => {
    for (let i = edges.length - 1; i >= 0; i--) if (v >= edges[i]) return i;
    return 0;
  };
  const groups = new Map();
  for (const w of wins) {
    const v = key(w);
    if (!Number.isFinite(v)) continue;
    const b = label(v);
    groups.set(b, [...(groups.get(b) ?? []), w]);
  }
  table(
    ['range', 'windows', 'fps', 'js ms', 'fairies', 'apiary', 'flowers', 'render'],
    [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, ws]) => [
        `${edges[b]}${edges[b + 1] !== undefined ? `–${edges[b + 1]}` : '+'}`,
        ws.length,
        f(med(ws.map((w) => w.fps))),
        f(med(ws.map((w) => w.cpu[0])), 2),
        ...['fairies', 'apiary', 'flowers', 'render'].map((s) => f(med(ws.map((w) => w.sections[s]?.[0] ?? NaN)), 2)),
      ]),
  );
}
bucketed(
  'SCALING WITH HELPERS (fairies + bears)',
  (w) => (w.game?.fairies ?? 0) + (w.game?.bears ?? 0),
  [0, 10, 50, 100, 250, 500],
);
bucketed('SCALING WITH PROGRESS (planet %)', (w) => w.game?.planetPct, [0, 1, 5, 20, 50, 80]);
bucketed('BY CAMERA ZOOM (m)', (w) => w.game?.zoom, [0, 12, 40, 100, 200]);

if (loads.length) {
  console.log('STARTUP (ms since navigation)');
  table(
    ['mark', 'median', 'p90'],
    ['script', 'world', 'ready', 'firstFrame'].map((m) => [
      m,
      f(med(loads.map((l) => l.marks[m])), 0),
      f(
        q(
          loads.map((l) => l.marks[m]),
          0.9,
        ),
        0,
      ),
    ]),
  );
}

console.log('SLOWEST WINDOWS');
table(
  ['when', 'session', 'fps', 'p99 ms', 'top sections (ms/frame)'],
  [...wins]
    .sort((a, b) => a.fps - b.fps)
    .slice(0, 8)
    .map((w) => [
      new Date(w.t).toISOString().slice(0, 16).replace('T', ' '),
      w.sid,
      f(w.fps),
      f(w.interval[2]),
      Object.entries(w.sections)
        .sort((a, b) => b[1][0] - a[1][0])
        .slice(0, 3)
        .map(([k, [m]]) => `${k} ${f(m, 2)}`)
        .join(', '),
    ]),
);
