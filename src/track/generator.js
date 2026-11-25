// Procedural circuit generator.
//
// 1. Grow a random simple closed loop of cells on a grid ("bump-out" growth
//    starting from a small rectangle).
// 2. Classify each cell as straight / left / right from the walking direction.
// 3. Assign tiles from the library to the cells (loops take two straight cells),
//    add balanced elevation ramps and booster pads.
// The output is a plain spec { name, seed, tiles:[{type, params}] } that
// TrackData can build – the same format hand-made tracks use.

import { CONFIG } from '../config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [
  [0, 1], // 0: +z
  [1, 0], // 1: +x (left of +z)
  [0, -1],
  [-1, 0],
];
const dirIndex = (dx, dz) => DIRS.findIndex(([x, z]) => x === dx && z === dz);
const key = (c) => `${c[0]},${c[1]}`;

function growLoop(rng, targetCells, maxSpan) {
  // initial ring around a 2x1 block -> 4x3 bounding rectangle, 10 cells
  const w = 4;
  const h = 3;
  const cyc = [];
  for (let x = 0; x < w; x++) cyc.push([x, 0]);
  for (let z = 1; z < h; z++) cyc.push([w - 1, z]);
  for (let x = w - 2; x >= 0; x--) cyc.push([x, h - 1]);
  for (let z = h - 2; z > 0; z--) cyc.push([0, z]);

  const occupied = new Set(cyc.map(key));
  let attempts = 0;
  while (cyc.length < targetCells && attempts++ < 4000) {
    const i = Math.floor(rng() * cyc.length);
    const A = cyc[i];
    const B = cyc[(i + 1) % cyc.length];
    const dx = B[0] - A[0];
    const dz = B[1] - A[1];
    const side = rng() < 0.5 ? 1 : -1;
    const n = [dz * side, -dx * side];
    const A2 = [A[0] + n[0], A[1] + n[1]];
    const B2 = [B[0] + n[0], B[1] + n[1]];
    if (occupied.has(key(A2)) || occupied.has(key(B2))) continue;
    // keep the layout compact
    const xs = cyc.map((c) => c[0]).concat([A2[0], B2[0]]);
    const zs = cyc.map((c) => c[1]).concat([A2[1], B2[1]]);
    if (Math.max(...xs) - Math.min(...xs) >= maxSpan || Math.max(...zs) - Math.min(...zs) >= maxSpan) continue;
    cyc.splice(i + 1, 0, A2, B2);
    occupied.add(key(A2));
    occupied.add(key(B2));
  }
  return cyc;
}

// Doubles the loop resolution: every step becomes two steps, so turns are
// always separated by at least one straight cell.
function upscale(cyc) {
  const out = [];
  for (let i = 0; i < cyc.length; i++) {
    const a = cyc[i];
    const b = cyc[(i + 1) % cyc.length];
    out.push([a[0] * 2, a[1] * 2]);
    out.push([a[0] + b[0], a[1] + b[1]]);
  }
  return out;
}

function classify(cyc) {
  const n = cyc.length;
  return cyc.map((c, i) => {
    const p = cyc[(i - 1 + n) % n];
    const q = cyc[(i + 1) % n];
    const din = dirIndex(c[0] - p[0], c[1] - p[1]);
    const dout = dirIndex(q[0] - c[0], q[1] - c[1]);
    let turn = 0;
    if (dout === (din + 1) % 4) turn = 1;
    else if (dout === (din + 3) % 4) turn = -1;
    return { cell: c, din, dout, turn };
  });
}

const PLACES = ['Nowa Huta', 'Żerań', 'Ursus', 'Stalowa Wola', 'Tychy', 'Bełchatów', 'Płock', 'Konin', 'Jastrzębie', 'Mielec', 'Kozienice', 'Polkowice', 'Łódź Kaliska', 'Gdynia Port', 'Katowice Spodek', 'Wrocław Kozanów'];
const KINDS = ['Pętla', 'Obwodnica', 'Tor', 'Magistrala', 'Arena', 'Trasa'];

export function trackName(rng) {
  return `${KINDS[Math.floor(rng() * KINDS.length)]} ${PLACES[Math.floor(rng() * PLACES.length)]}`;
}

function pickWeighted(rng, table) {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of table) {
    if ((r -= w) <= 0) return v;
  }
  return table[0][0];
}

/**
 * @param {number} seed
 * @param {object} opts { cells, loops, features (0..1 density of special tiles), name }
 */
export function generateTrack(seed, opts = {}) {
  const rng = mulberry32(seed);
  const targetCells = opts.cells ?? 20 + Math.floor(rng() * 10);
  const cyc = upscale(growLoop(rng, Math.round(targetCells / 2), opts.maxSpan ?? 5));
  let cells = classify(cyc);

  // rotate so the start cell is a straight followed by a straight
  let startIdx = cells.findIndex((c, i) => c.turn === 0 && cells[(i + 1) % cells.length].turn === 0 && cells[(i - 1 + cells.length) % cells.length].turn === 0);
  if (startIdx < 0) startIdx = cells.findIndex((c) => c.turn === 0);
  if (startIdx < 0) startIdx = 0;
  cells = cells.slice(startIdx).concat(cells.slice(0, startIdx));
  const n = cells.length;

  const slots = cells.map((c) => ({ ...c, type: null, params: {}, skip: false }));
  slots[0].type = 'start';

  // --- loops (two consecutive straights) ------------------------------------
  const wantLoops = opts.loops ?? (rng() < 0.75 ? 1 : 0) + (n > 22 && rng() < 0.4 ? 1 : 0);
  let placedLoops = 0;
  const loopCandidates = [];
  for (let i = 2; i < n - 1; i++) {
    if (slots[i].turn === 0 && slots[i + 1].turn === 0) loopCandidates.push(i);
  }
  while (placedLoops < wantLoops && loopCandidates.length) {
    const k = Math.floor(rng() * loopCandidates.length);
    const i = loopCandidates.splice(k, 1)[0];
    if (slots[i].type || slots[i + 1].type) continue;
    slots[i].type = 'loop';
    slots[i].params = { dir: rng() < 0.5 ? 1 : -1 };
    slots[i + 1].type = 'loop-tail';
    slots[i + 1].skip = true;
    placedLoops++;
  }

  // --- straights --------------------------------------------------------------
  const density = opts.features ?? 0.6;
  const straightTable = [
    ['straight', 1.6 * (1 - density) + 0.5],
    ['boost', 1.5],
    ['hill', 0.8 * density],
    ['wave', 0.8 * density],
    ['chicane', 0.8 * density],
    ['doubleChicane', 0.5 * density],
    ['tunnel', 0.8 * density],
    ['barrelRoll', 0.45 * density],
    ['wallRide', 0.55 * density],
    ['twist', 0.35 * density],
    ['jump', 1.0 * density],
    ['neonRings', 0.6 * density],
    ['stadium', 0.4 * density],
  ];
  const repeatable = new Set(['straight', 'boost', 'tunnel', 'neonRings']);
  let lastSpecial = null;
  const dir = () => (rng() < 0.5 ? 1 : -1);
  for (let i = 1; i < n; i++) {
    const s = slots[i];
    if (s.type || s.turn !== 0) continue;
    let t = pickWeighted(rng, straightTable);
    if (t === lastSpecial && !repeatable.has(t)) t = 'straight';
    // never put a jump right after a turn exit or right before one – needs run-up
    if (t === 'jump' && (slots[i - 1].turn !== 0 || slots[(i + 1) % n].turn !== 0)) t = 'boost';
    s.type = t;
    lastSpecial = t;
    if (t === 'chicane' || t === 'doubleChicane') s.params = { dir: dir(), amp: 7 + rng() * 5 };
    if (t === 'barrelRoll' || t === 'twist') s.params = { dir: dir() };
    if (t === 'wallRide') s.params = { dir: dir(), angle: 0.9 + rng() * 0.45 };
    if (t === 'hill') s.params = { height: 7 + rng() * 7 };
    if (t === 'wave') s.params = rng() < 0.4 ? { amp: 8 + rng() * 4, bumps: 2 } : { amp: 2.5 + rng() * 1.5, bumps: 3 };
    if (t === 'jump') s.params = { height: 9 + rng() * 5 };
    if (t === 'boost') {
      const layout = Math.floor(rng() * 3);
      s.params = {
        boosts:
          layout === 0 ? [{ f: 0.35, x: -6 }, { f: 0.35, x: 6 }] :
          layout === 1 ? [{ f: 0.3, x: 0 }, { f: 0.65, x: 0 }] :
          [{ f: 0.3, x: -8 }, { f: 0.5, x: 0 }, { f: 0.7, x: 8 }],
      };
    }
    if (t === 'chicane' && rng() < 0.5) s.params.boosts = [{ f: 0.5, x: 0 }];
  }

  // --- curves ------------------------------------------------------------------
  for (let i = 0; i < n; i++) {
    const s = slots[i];
    if (s.turn === 0) continue;
    s.type = s.turn > 0 ? 'curveL' : 'curveR';
    s.params = { bank: rng() < 0.6 ? 0.3 + rng() * 0.15 : 0, tunnel: rng() < 0.15 * density };
    // pads on the inside of the apex now and then
    if (rng() < 0.25) s.params.boosts = [{ f: 0.5, x: -s.turn * 7 }];
  }

  // --- balanced elevation ramps --------------------------------------------------
  const rampable = [];
  for (let i = 2; i < n; i++) {
    const t = slots[i].type;
    if (['straight', 'boost', 'curveL', 'curveR'].includes(t)) rampable.push(i);
  }
  const pairs = Math.min(Math.floor(rampable.length / 2), opts.ramps ?? 1 + Math.floor(rng() * 3));
  const chosen = [];
  while (chosen.length < pairs * 2 && rampable.length) {
    chosen.push(rampable.splice(Math.floor(rng() * rampable.length), 1)[0]);
  }
  chosen.sort((a, b) => a - b);
  let level = 0;
  const H = CONFIG.track.rampHeight;
  chosen.forEach((i, j) => {
    const remaining = chosen.length - j;
    let up;
    if (level >= remaining) up = false;
    else if (level === 0) up = true;
    else if (level >= 2) up = false;
    else up = rng() < 0.5;
    level += up ? 1 : -1;
    const s = slots[i];
    if (s.type === 'straight' || s.type === 'boost') {
      s.params = { ...s.params, dy: up ? H : -H };
    } else {
      s.params.dy = up ? H : -H;
    }
  });

  // --- elevated sections: valleys and bridges -------------------------------------
  {
    let lvl = 0;
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const dy = s.params.dy || 0;
      if (!dy && s.type === 'straight' && lvl >= 1) {
        const r = rng();
        if (r < 0.35) s.type = 'bridge';
        else if (r < 0.6) {
          s.type = 'valley';
          s.params = { depth: 6 + rng() * 6 };
        }
      }
      lvl += Math.sign(dy);
    }
  }

  const tiles = slots.filter((s) => !s.skip).map((s) => ({ type: s.type, params: s.params }));
  return {
    name: opts.name || trackName(rng),
    seed,
    theme: opts.theme ?? seed % 3,
    tiles,
    grid: cells.map((c) => c.cell),
  };
}

// ----------------------------------------------------------------------------
// Preset circuits. Seeds were picked by hand; the last one is fully hand-built
// to show how to author a circuit from tiles directly.
// ----------------------------------------------------------------------------

export const PRESETS = [
  { id: 'huta', name: 'Pętla Nowa Huta', seed: 1981, opts: { cells: 18, features: 0.5, loops: 1, theme: 1 }, time: 'day', city: 'huta', weather: 'clouds', blurb: 'Kombinat stali. Szybka, prosta – dobra na początek.' },
  { id: 'zeran', name: 'Magistrala Żerań', seed: 7702, opts: { cells: 24, features: 0.7, loops: 1, theme: 0 }, time: 'night', city: 'nocna', weather: 'rain', blurb: 'Fabryka samochodów nocą. Beczki i tunele.' },
  { id: 'spodek', name: 'Arena Spodek', seed: 4242, opts: { cells: 28, features: 0.85, loops: 2, theme: 2 }, time: 'dusk', city: 'futuro', weather: 'clear', blurb: 'Dwie pętle, długie rampy. Dla przodowników.' },
  {
    id: 'trening',
    name: 'Tor Treningowy OSP',
    blurb: 'Ręcznie złożony z kafli – wzorzec dla twórców torów.',
    spec: {
      name: 'Tor Treningowy OSP',
      theme: 0,
      time: 'day',
      city: 'centrum',
      weather: 'clear',
      tiles: [
        { type: 'start' },
        { type: 'jump' },
        { type: 'boost' },
        { type: 'curveR', params: { bank: 0.35 } },
        { type: 'loop', params: { dir: 1 } },
        { type: 'curveR', params: { bank: 0.35, boosts: [{ f: 0.5, x: 7 }] } },
        { type: 'rampUp' },
        { type: 'twist', params: { dir: -1 } },
        { type: 'bridge' },
        { type: 'curveR', params: { bank: 0.4, tunnel: true } },
        { type: 'wallRide', params: { dir: 1 } },
        { type: 'rampDown' },
        { type: 'curveR' },
      ],
    },
  },
];

export function presetSpec(preset) {
  if (preset.spec) return preset.spec;
  return { ...generateTrack(preset.seed, { ...preset.opts, name: preset.name }), time: preset.time, city: preset.city, weather: preset.weather };
}
