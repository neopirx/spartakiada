// Brutalist façade textures for the generated city: raw béton brut with
// board-marked formwork, tie holes and rain stains, windows sunk deep into
// the concrete, vertical fins, ribbed (bush-hammered) stair cores and
// precast panels. Same conventions as facades.js: pixel art in a 128-texel
// tile covering 4 bays × 4 floors (ground floors: 4 bays × 1 storey), drawn
// light so per-building vertex colours tint the concrete, with an emissive
// twin holding the lit windows.
import { pair, toTex, rng, R, grain } from './facades.js';

const U = 128;
const C = 32; // texels per bay / per floor
const WARM = ['#ffd27a', '#ffc45a', '#ffe0a0', '#ffb860', '#fff0c0'];
const COLD = ['#a8d8ff', '#c8f0ff', '#d8ffe8'];

// Raw concrete: base, board marks, aggregate, tie holes.
function concrete(g, x, y, w, h, rnd, { tone = 200, boards = 3, ties = true, vertical = false } = {}) {
  // cool grey béton brut
  const t = tone - 14 + Math.floor((rnd() - 0.5) * 10);
  R(g, `rgb(${t},${t},${t - 3})`, x, y, w, h);
  // cloudy pour marks: big soft blotches of lighter / darker concrete
  for (let i = 0; i < (w * h) / 900 + 1; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    g.fillRect(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 4 + Math.floor(rnd() * 14), 3 + Math.floor(rnd() * 8));
  }
  // formwork boards
  if (boards) {
    if (vertical) {
      for (let i = 0; i < w; i += boards) R(g, (i / boards) % 2 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)', x + i, y, 1, h);
    } else {
      for (let j = 0; j < h; j += boards) {
        R(g, (j / boards) % 2 ? 'rgba(0,0,0,0.055)' : 'rgba(255,255,255,0.045)', x, y + j, w, 1);
        // staggered board ends
        if (rnd() < 0.5) R(g, 'rgba(0,0,0,0.08)', x + Math.floor(rnd() * w), y + j, 1, boards);
      }
    }
  }
  // aggregate
  for (let i = 0; i < (w * h) / 9; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
    g.fillRect(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1);
  }
  if (ties) {
    for (let j = 3; j < h - 1; j += 8) for (let i = 4; i < w - 1; i += 10) R(g, 'rgba(0,0,0,0.3)', x + i + ((j >> 3) % 2) * 5, y + j, 1, 1);
  }
}

// Rain streak running down from (x, y).
function stain(g, x, y, len, rnd, width = 1 + Math.floor(rnd() * 3)) {
  for (let k = 0; k < len; k++) {
    const a = 0.34 * (1 - k / len);
    g.fillStyle = `rgba(38,34,28,${a.toFixed(3)})`;
    const wob = rnd() < 0.15 ? (rnd() < 0.5 ? -1 : 1) : 0;
    g.fillRect(x + wob, y + k, width, 1);
  }
}

// Window sunk into the wall: shadowed reveals, dark glass, sill.
// depth: reveal depth in texels. Lit windows also go to the emissive map.
function deepWindow(P, rnd, x, y, w, h, { depth = 3, lit = 0.3, mull = true, palette = WARM } = {}) {
  const { g, ge } = P;
  // reveals: top in deep shadow (light from above), left darker than right
  R(g, '#1c1d22', x, y, w, h);
  const isLit = rnd() < lit;
  const gx = x + 1;
  const gy = y + depth;
  const gw = w - 2;
  const gh = h - depth - 1;
  if (isLit) {
    // by day a lit room only reads as a warmer pane; the glow is emissive
    const col = palette[Math.floor(rnd() * palette.length)];
    R(g, '#3e4046', gx, gy, gw, gh);
    R(g, 'rgba(120,100,70,0.25)', gx, gy + Math.floor(gh * 0.4), gw, gh - Math.floor(gh * 0.4));
    R(ge, col, gx, gy, gw, gh);
    if (rnd() < 0.5) R(ge, 'rgba(0,0,0,0.6)', gx + Math.floor(rnd() * gw * 0.6), gy, Math.max(1, Math.floor(gw * 0.35)), gh); // curtain
  } else {
    // sky reflection fading into the room
    R(g, '#4c5866', gx, gy, gw, Math.max(1, Math.floor(gh * 0.4)));
    R(g, '#323a44', gx, gy + Math.floor(gh * 0.4), gw, gh - Math.floor(gh * 0.4));
    R(g, 'rgba(255,255,255,0.18)', gx, gy, Math.max(1, Math.floor(gw * 0.3)), 1);
  }
  // reveal shading over the glass
  R(g, 'rgba(0,0,0,0.6)', x, y, w, depth);
  R(g, 'rgba(0,0,0,0.35)', x, y + depth, Math.max(1, depth - 1), h - depth);
  R(g, 'rgba(255,255,255,0.10)', x + w - 1, y + depth, 1, h - depth);
  if (mull && w > 10) R(g, 'rgba(20,20,24,0.9)', x + Math.floor(w / 2), gy, 1, gh);
  // sill catches the light
  R(g, 'rgba(255,255,255,0.35)', x - 1, y + h, w + 2, 1);
  R(g, 'rgba(0,0,0,0.25)', x - 1, y + h + 1, w + 2, 1);
}

// --- façades ---------------------------------------------------------------------------

const FACADES = {
  // deep concrete grid ("egg crate"): civic buildings, offices
  waffle(P, rnd) {
    const { g } = P;
    concrete(g, 0, 0, U, U, rnd, { tone: 204 });
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const x = i * C;
        const y = j * C;
        deepWindow(P, rnd, x + 6, y + 7, 20, 18, { depth: 6, lit: 0.32 });
        R(g, 'rgba(0,0,0,0.22)', x + 4, y + 6, 2, 20); // frame side in shade
        if (rnd() < 0.75) stain(g, x + 7 + Math.floor(rnd() * 16), y + 26, 5 + Math.floor(rnd() * 14), rnd);
      }
      // horizontal beam: lit top edge, shadow below, grime on the ledge
      R(g, 'rgba(255,255,255,0.22)', 0, j * C, U, 1);
      R(g, 'rgba(30,28,24,0.18)', 0, j * C + 1, U, 2);
      R(g, 'rgba(0,0,0,0.18)', 0, j * C + 6, U, 1);
    }
    for (let i = 0; i < 4; i++) {
      R(g, 'rgba(255,255,255,0.12)', i * C, 0, 1, U);
      R(g, 'rgba(0,0,0,0.12)', i * C + 5, 0, 1, U);
    }
  },

  // continuous ribbon windows under heavy board-marked spandrels
  ribbon(P, rnd) {
    const { g, ge } = P;
    for (let j = 0; j < 4; j++) {
      const y = j * C;
      // window band
      const wy = y + 15;
      R(g, '#2a3038', 0, wy, U, 17);
      R(g, '#46525e', 0, wy, U, 6);
      for (let x = 0; x < U; x += 8) {
        if (rnd() < 0.28) {
          const col = WARM[Math.floor(rnd() * WARM.length)];
          R(g, 'rgba(120,100,70,0.3)', x + 1, wy + 3, 7, 13);
          R(ge, col, x + 1, wy + 3, 7, 13);
        }
        R(g, '#5a5a5c', x, wy, 1, 17); // mullion
      }
      // overhanging spandrel and its shadow on the glass
      concrete(g, 0, y, U, 15, rnd, { tone: 208, ties: false });
      R(g, 'rgba(255,255,255,0.25)', 0, y, U, 1);
      R(g, 'rgba(0,0,0,0.55)', 0, wy, U, 4);
      for (let k = 0; k < 6; k++) stain(g, Math.floor(rnd() * U), y + 2, 6 + Math.floor(rnd() * 8), rnd);
    }
  },

  // vertical concrete fins with recessed bays between them
  fins(P, rnd) {
    const { g } = P;
    concrete(g, 0, 0, U, U, rnd, { tone: 168, boards: 2 });
    for (let i = 0; i < 4; i++) {
      const x = i * C;
      for (let j = 0; j < 4; j++) {
        const y = j * C;
        deepWindow(P, rnd, x + 11, y + 4, 16, 22, { depth: 3, lit: 0.3, mull: false });
        // dark spandrel panel
        R(g, 'rgba(0,0,0,0.18)', x + 10, y + 27, 18, 5);
      }
      // fin: light face, hard shadow cast to the right
      concrete(g, x, 0, 8, U, rnd, { tone: 214, boards: 0, ties: false });
      R(g, 'rgba(255,255,255,0.3)', x, 0, 1, U);
      R(g, 'rgba(0,0,0,0.45)', x + 8, 0, 2, U);
      R(g, 'rgba(0,0,0,0.2)', x + 10, 0, 1, U);
      if (rnd() < 0.7) stain(g, x + 2 + Math.floor(rnd() * 4), Math.floor(rnd() * 40), 30 + Math.floor(rnd() * 50), rnd, 2);
    }
  },

  // large precast panels with exposed aggregate, punched windows, loggias
  panel(P, rnd) {
    const { g, ge } = P;
    concrete(g, 0, 0, U, U, rnd, { tone: 196, boards: 0, ties: false });
    grain(g, U, U, rnd, 0.06);
    for (let j = 0; j < 4; j++) {
      const loggiaCol = rnd() < 0.5 ? 1 : 2;
      for (let i = 0; i < 4; i++) {
        const x = i * C;
        const y = j * C;
        if (i === loggiaCol) {
          // recessed loggia with a ribbed concrete balustrade
          R(g, '#3a3a3e', x + 3, y + 4, 26, 26);
          deepWindow(P, rnd, x + 6, y + 6, 12, 14, { depth: 2, lit: 0.3 });
          R(g, '#2a2a2e', x + 20, y + 6, 6, 20); // balcony door
          if (rnd() < 0.2) R(ge, '#ffc860', x + 21, y + 8, 4, 16);
          concrete(g, x + 3, y + 20, 26, 10, rnd, { tone: 212, boards: 0, ties: false });
          for (let k = 0; k < 26; k += 2) R(g, 'rgba(0,0,0,0.16)', x + 3 + k, y + 20, 1, 10);
          R(g, 'rgba(255,255,255,0.3)', x + 3, y + 20, 26, 1);
          R(g, 'rgba(0,0,0,0.6)', x + 3, y + 4, 26, 3);
        } else {
          deepWindow(P, rnd, x + 9, y + 8, 14, 16, { depth: 3, lit: 0.33 });
          if (rnd() < 0.5) stain(g, x + 10 + Math.floor(rnd() * 10), y + 26, 3 + Math.floor(rnd() * 6), rnd);
        }
        // panel joints with lighter sealant
        R(g, 'rgba(0,0,0,0.45)', x, y, C, 1);
        R(g, 'rgba(0,0,0,0.45)', x, y, 1, C);
        R(g, 'rgba(255,255,255,0.18)', x + 1, y + 1, C - 1, 1);
      }
    }
  },

  // windowless ribbed concrete: stair / lift cores, plinths, parapets
  blank(P, rnd) {
    const { g, ge } = P;
    concrete(g, 0, 0, U, U, rnd, { tone: 192, boards: 3, vertical: true });
    for (let x = 0; x < U; x += 4) {
      R(g, 'rgba(255,255,255,0.10)', x, 0, 1, U);
      R(g, 'rgba(0,0,0,0.12)', x + 2, 0, 1, U);
    }
    // stair-light slits in one column
    for (let j = 0; j < 4; j++) {
      R(g, '#1c1d22', 61, j * C + 8, 4, 16);
      R(g, 'rgba(0,0,0,0.5)', 61, j * C + 8, 4, 2);
      if (rnd() < 0.5) {
        R(g, '#5a5244', 62, j * C + 10, 2, 13);
        R(ge, '#ffe0a0', 62, j * C + 10, 2, 13);
      }
    }
    for (let k = 0; k < 10; k++) stain(g, Math.floor(rnd() * U), Math.floor(rnd() * U * 0.6), 12 + Math.floor(rnd() * 40), rnd, 2);
  },

  // industrial hall: ribbed concrete with a high clerestory band
  hall(P, rnd) {
    const { g, ge } = P;
    FACADES.blank(P, rnd);
    for (let j = 0; j < 4; j += 2) {
      const y = j * C + 4;
      R(g, '#3a4450', 0, y, U, 12);
      R(g, '#56626e', 0, y, U, 4);
      for (let x = 0; x < U; x += 6) {
        R(g, '#6a6a6a', x, y, 1, 12);
        if (rnd() < 0.18) {
          R(g, '#6a7a84', x + 1, y + 2, 5, 9);
          R(ge, '#a8d8ff', x + 1, y + 2, 5, 9);
        }
      }
      R(g, 'rgba(0,0,0,0.5)', 0, y, U, 2);
    }
  },
};

// --- ground floors (128 × 32 texels = 4 bays × one tall storey) -------------------------------

const GROUNDS = {
  // dark glazing between massive concrete columns
  glazed(P, rnd) {
    const { g, ge } = P;
    R(g, '#22262c', 0, 0, U, 32);
    for (let i = 0; i < 4; i++) {
      const x = i * C;
      const lit = rnd() < 0.55;
      const col = (rnd() < 0.7 ? WARM : COLD)[Math.floor(rnd() * 3)];
      R(g, lit ? '#4e4c48' : '#3a4652', x + 7, 6, 22, 22);
      if (lit) {
        R(ge, col, x + 7, 6, 22, 22);
        R(g, 'rgba(0,0,0,0.3)', x + 7, 18, 22, 10);
      }
      R(g, '#18181c', x + 17, 6, 1, 22);
      concrete(g, x, 0, 7, 32, rnd, { tone: 196, boards: 0, ties: false });
      R(g, 'rgba(0,0,0,0.4)', x + 7, 0, 2, 32);
    }
    concrete(g, 0, 0, U, 5, rnd, { tone: 205, boards: 0, ties: false });
    R(g, 'rgba(0,0,0,0.6)', 0, 5, U, 2);
  },
  // solid plinth with doors and high slot windows
  plinth(P, rnd) {
    const { g, ge } = P;
    concrete(g, 0, 0, U, 32, rnd, { tone: 186, boards: 3 });
    for (let i = 0; i < 4; i++) {
      const x = i * C;
      if (i === 1) {
        R(g, '#2a2420', x + 10, 8, 12, 24);
        R(g, 'rgba(0,0,0,0.5)', x + 10, 8, 12, 2);
        R(ge, '#ffd890', x + 11, 4, 10, 2);
        R(g, '#a89a80', x + 11, 4, 10, 2);
      } else {
        deepWindow(P, rnd, x + 4, 4, 24, 6, { depth: 2, lit: 0.4, mull: false });
      }
    }
  },
};

const cache = new Map();

export const BRUTAL_FACADES = Object.keys(FACADES);

/** @returns {{map: THREE.Texture, emissive: THREE.Texture}} */
export function brutalFacade(style, seed = 1) {
  const key = `bf_${style}_${seed}`;
  if (cache.has(key)) return cache.get(key);
  const P = pair(U, U);
  (FACADES[style] || FACADES.panel)(P, rng(seed * 7919 + 31));
  const out = { map: toTex(P.c), emissive: toTex(P.e) };
  cache.set(key, out);
  return out;
}

/** @returns {{map: THREE.Texture, emissive: THREE.Texture}} */
export function brutalGround(style, seed = 1) {
  const key = `bg_${style}_${seed}`;
  if (cache.has(key)) return cache.get(key);
  const P = pair(U, 32);
  (GROUNDS[style] || GROUNDS.glazed)(P, rng(seed * 104729 + 7));
  const out = { map: toTex(P.c), emissive: toTex(P.e) };
  cache.set(key, out);
  return out;
}

// Plain board-marked concrete (no windows) for showroom walls, props etc.
export function concreteCanvas(w = 256, h = 256, seed = 3, tone = 150) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const rnd = rng(seed);
  concrete(g, 0, 0, w, h, rnd, { tone, boards: 4 });
  for (let k = 0; k < w / 10; k++) stain(g, Math.floor(rnd() * w), Math.floor(rnd() * h * 0.5), 20 + Math.floor(rnd() * h * 0.4), rnd, 2);
  return c;
}
