// Pixel-art façade textures for the trackside city, drawn on canvas in a
// small "texel" grid (one texel ≈ 10 cm) like 32-bit console era art.
// Every façade texture covers 4 bays × 4 floors and tiles in both directions;
// ground-floor textures cover 4 bays × 1 (taller) storey.
// The plaster/panel parts are drawn light so a per-building vertex colour can
// tint them (one texture → many differently coloured buildings).
// Each texture has an emissive twin with the lit windows for the night.
import * as THREE from 'three';
import { RETRO } from '../fx/retro.js';

export const BAY = 3.4; // metres per bay (texture repeats every 4 bays)
export const FLOOR = 3.2; // metres per storey (repeats every 4 storeys)
export const GROUND = 4.4; // ground-floor storey height

const U = 128; // texture units per repeat

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Creates a pair of canvases (diffuse + emissive) drawn in texture units.
export function pair(w, h) {
  const k = RETRO.enabled ? 1 : 3; // texels per unit
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = w * k;
    c.height = h * k;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.scale(k, k);
    return [c, g];
  };
  const [c, g] = mk();
  const [e, ge] = mk();
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, w, h);
  return { c, g, e, ge, w, h };
}

export function toTex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = RETRO.enabled ? 1 : 4;
  if (RETRO.enabled) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return t;
}

export const R = (g, col, x, y, w, h) => {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
};

// per-texel grain (keeps the flat colours from looking vector-drawn)
export function grain(g, w, h, rnd, amount = 0.06, step = 1) {
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const v = rnd();
      if (v < 0.5) continue;
      g.fillStyle = v > 0.75 ? `rgba(255,255,255,${amount})` : `rgba(0,0,0,${amount * 1.4})`;
      g.fillRect(x, y, step, step);
    }
  }
}

const WARM = ['#ffd27a', '#ffc45a', '#ffe0a0', '#ffb860', '#fff0c0'];
const COLD = ['#a8d8ff', '#c8f0ff', '#9fc0ff'];

// A glass pane: sky reflection on top, dark below. Lit panes also go to the emissive map.
function pane(P, rnd, x, y, w, h, litChance = 0.35, palette = null) {
  const { g, ge } = P;
  R(g, '#1d2430', x, y, w, h);
  R(g, '#5a7290', x, y, w, Math.max(1, Math.floor(h * 0.35)));
  R(g, '#8aa4c0', x, y, Math.max(1, Math.floor(w * 0.3)), 1);
  if (rnd() < litChance) {
    const pal = palette || (rnd() < 0.85 ? WARM : COLD);
    const col = pal[Math.floor(rnd() * pal.length)];
    R(ge, col, x, y, w, h);
    // curtains
    if (rnd() < 0.4) {
      R(ge, 'rgba(0,0,0,0.45)', x, y, Math.ceil(w * 0.25), h);
      R(ge, 'rgba(0,0,0,0.45)', x + w - Math.ceil(w * 0.25), y, Math.ceil(w * 0.25), h);
    }
  }
}

// --- upper-floor façades ---------------------------------------------------------
const FACADES = {
  // "wielka płyta" panel block: panel seams, loggia bands in a pastel accent
  blok(P, rnd) {
    const { g } = P;
    R(g, '#d6d2c8', 0, 0, U, U);
    grain(g, U, U, rnd, 0.05);
    const accent = ['#c86a4a', '#5f93a8', '#d8b048', '#7fa060', '#b85a7a'][Math.floor(rnd() * 5)];
    for (let f = 0; f < 4; f++) {
      for (let b = 0; b < 4; b++) {
        const x = b * 32;
        const y = f * 32;
        R(g, '#a9a49a', x, y, 32, 1); // horizontal seam
        R(g, '#a9a49a', x, y, 1, 32); // vertical seam
        if (b % 2 === 1) {
          // loggia: dark recess, coloured balustrade
          R(g, '#4a4640', x + 2, y + 4, 28, 26);
          pane(P, rnd, x + 6, y + 7, 9, 16);
          pane(P, rnd, x + 18, y + 7, 9, 16);
          R(g, accent, x + 2, y + 20, 28, 10);
          R(g, 'rgba(255,255,255,0.25)', x + 2, y + 20, 28, 1);
        } else {
          pane(P, rnd, x + 7, y + 9, 18, 14);
          R(g, '#f0ece4', x + 7, y + 23, 18, 1); // sill
        }
      }
    }
  },
  // pre-war tenement: cornice per floor, tall framed windows, lintels
  kamienica(P, rnd) {
    const { g } = P;
    R(g, '#ece4d4', 0, 0, U, U);
    grain(g, U, U, rnd, 0.06);
    for (let f = 0; f < 4; f++) {
      const y = f * 32;
      R(g, '#c8bea8', 0, y + 30, U, 2); // floor cornice
      R(g, '#fffaf0', 0, y + 29, U, 1);
      for (let b = 0; b < 4; b++) {
        const x = b * 32;
        R(g, '#fff8ea', x + 9, y + 5, 14, 22); // frame
        pane(P, rnd, x + 10, y + 7, 12, 19);
        R(g, '#fff8ea', x + 15, y + 7, 2, 19); // mullion
        R(g, '#fff8ea', x + 10, y + 14, 12, 1);
        if (f % 2 === 0) {
          R(g, '#d8ccb4', x + 7, y + 2, 18, 3); // lintel
          R(g, '#d8ccb4', x + 12, y + 0, 8, 2); // pediment
        } else R(g, '#d8ccb4', x + 8, y + 3, 16, 2);
        R(g, '#bfb39c', x + 8, y + 27, 16, 2); // sill
        if (f === 1 && b % 2 === 0) {
          // wrought-iron balcony
          R(g, '#3a3530', x + 6, y + 21, 20, 1);
          for (let k = 0; k < 20; k += 2) R(g, '#3a3530', x + 6 + k, y + 22, 1, 5);
          R(g, '#8a8070', x + 5, y + 27, 22, 2);
        }
      }
    }
  },
  // socialist-realist (MDM): pilasters, rusticated rhythm, ornament roundels
  socrealizm(P, rnd) {
    const { g } = P;
    R(g, '#eadcbc', 0, 0, U, U);
    grain(g, U, U, rnd, 0.07);
    for (let b = 0; b < 4; b++) {
      R(g, '#f6ecd4', b * 32, 0, 4, U); // pilaster
      R(g, '#c4b490', b * 32 + 4, 0, 1, U);
    }
    for (let f = 0; f < 4; f++) {
      const y = f * 32;
      R(g, '#d0c09c', 0, y + 31, U, 1);
      for (let b = 0; b < 4; b++) {
        const x = b * 32;
        R(g, '#c8b894', x + 9, y + 4, 16, 24);
        pane(P, rnd, x + 10, y + 5, 14, 22);
        R(g, '#efe4c8', x + 16, y + 5, 2, 22);
        R(g, '#efe4c8', x + 10, y + 12, 14, 1);
        if (f === 3) {
          R(g, '#c4a868', x + 14, y + 0, 6, 3); // ornament
          R(g, '#e8d090', x + 15, y + 1, 4, 1);
        }
      }
    }
  },
  // modernist curtain wall tower
  wiezowiec(P, rnd) {
    const { g } = P;
    R(g, '#c8ccd0', 0, 0, U, U);
    for (let f = 0; f < 4; f++) {
      const y = f * 32;
      for (let b = 0; b < 16; b++) {
        const x = b * 8;
        pane(P, rnd, x + 1, y + 1, 7, 22, 0.28, COLD.concat(WARM));
      }
      R(g, '#9aa2aa', 0, y + 23, U, 9); // spandrel band
      R(g, '#e0e4e8', 0, y + 23, U, 1);
      grain(g, U, 8, rnd, 0.05);
    }
  },
  // brick factory hall: big multi-pane windows
  hala(P, rnd) {
    const { g } = P;
    R(g, '#b4604a', 0, 0, U, U);
    for (let y = 0; y < U; y += 3) {
      R(g, '#8c4636', 0, y + 2, U, 1);
      for (let x = (y / 3) % 2 ? 0 : 3; x < U; x += 6) R(g, '#8c4636', x, y, 1, 2);
    }
    grain(g, U, U, rnd, 0.06);
    for (let f = 0; f < 4; f += 2) {
      for (let b = 0; b < 4; b++) {
        const x = b * 32;
        const y = f * 32;
        R(g, '#5a5a58', x + 4, y + 6, 24, 52);
        const lit = rnd() < 0.5;
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 8; j++) {
            pane(P, rnd, x + 5 + i * 6, y + 7 + j * 6.4, 5, 5, lit ? 0.9 : 0.05, ['#d8f0c8', '#e8f8e0', '#c8e0ff']);
          }
        }
        R(g, '#d8c8b0', x + 3, y + 58, 26, 2);
      }
    }
  },
  // retro-futurist block: white panels, porthole windows, red stripe
  futuro(P, rnd) {
    const { g, ge } = P;
    R(g, '#eef0f0', 0, 0, U, U);
    grain(g, U, U, rnd, 0.04);
    for (let f = 0; f < 4; f++) {
      const y = f * 32;
      R(g, '#c9cfd2', 0, y, U, 1);
      R(g, f % 2 ? '#d23a2a' : '#2a6ad2', 0, y + 26, U, 3);
      for (let b = 0; b < 4; b++) {
        const x = b * 32;
        // octagonal porthole
        R(g, '#9aa4aa', x + 8, y + 5, 16, 18);
        R(g, '#9aa4aa', x + 6, y + 8, 20, 12);
        pane(P, rnd, x + 9, y + 6, 14, 16, 0.4, ['#a0ffe8', '#ffd0f0', '#ffe9a0']);
        R(g, '#eef0f0', x + 9, y + 6, 2, 2);
        R(g, '#eef0f0', x + 21, y + 6, 2, 2);
        R(g, '#eef0f0', x + 9, y + 20, 2, 2);
        R(g, '#eef0f0', x + 21, y + 20, 2, 2);
        R(ge, '#000', x + 9, y + 6, 2, 2);
        R(ge, '#000', x + 21, y + 6, 2, 2);
        R(ge, '#000', x + 9, y + 20, 2, 2);
        R(ge, '#000', x + 21, y + 20, 2, 2);
      }
    }
  },
  // shopping pavilion upper band: glazing under a fascia
  pawilon(P, rnd) {
    const { g } = P;
    R(g, '#e6e2d8', 0, 0, U, U);
    for (let f = 0; f < 4; f++) {
      const y = f * 32;
      R(g, '#f0ece0', 0, y, U, 8);
      R(g, '#b8b4a8', 0, y + 7, U, 1);
      for (let b = 0; b < 16; b++) pane(P, rnd, b * 8 + 1, y + 9, 7, 22, 0.6);
    }
  },
};

// --- ground-floor shop fronts ------------------------------------------------------
const AWNINGS = [['#c8202a', '#f0e8dc'], ['#2a7a4a', '#f0e8dc'], ['#2a4a9a', '#f0e8dc'], ['#d8a020', '#3a2a1a']];
const SIGN_COLS = ['#c8202a', '#1a4a8a', '#1a6a3a', '#d8a020', '#7a2a7a', '#202020'];

const GROUNDS = {
  shops(P, rnd) {
    const { g, ge } = P;
    R(g, '#d8d0c0', 0, 0, U, 32);
    grain(g, U, 32, rnd, 0.06);
    for (let b = 0; b < 4; b++) {
      const x = b * 32;
      const [a1, a2] = AWNINGS[Math.floor(rnd() * AWNINGS.length)];
      const sign = SIGN_COLS[Math.floor(rnd() * SIGN_COLS.length)];
      R(g, sign, x + 2, 1, 28, 5); // shop sign board
      for (let k = 0; k < 6; k++) R(g, '#f8f0d8', x + 5 + k * 4, 3, 3, 1); // "lettering"
      R(ge, sign === '#202020' ? '#ff4060' : '#000', x + 2, 1, 28, 5);
      for (let k = 0; k < 7; k++) R(g, k % 2 ? a2 : a1, x + 2 + k * 4, 6, 4, 4); // awning
      R(g, 'rgba(0,0,0,0.35)', x + 2, 10, 28, 1);
      if (b % 3 === 2) {
        // entrance door
        R(g, '#3a2c24', x + 11, 13, 10, 19);
        pane(P, rnd, x + 13, 15, 6, 10, 0.7);
      } else {
        R(g, '#4a4640', x + 2, 12, 28, 18);
        pane(P, rnd, x + 3, 13, 26, 16, 0.9, WARM);
        // goods silhouettes
        for (let k = 0; k < 5; k++) R(g, ['#c84030', '#e8c060', '#4070a0', '#e0e0e0'][k % 4], x + 5 + k * 5, 24 + (k % 2), 3, 4);
        for (let k = 0; k < 5; k++) R(ge, 'rgba(0,0,0,0.5)', x + 5 + k * 5, 24 + (k % 2), 3, 4);
      }
      R(g, '#8a8478', x, 30, 32, 2); // plinth
    }
  },
  arcade(P, rnd) {
    const { g, ge } = P;
    R(g, '#e2d4b4', 0, 0, U, 32);
    grain(g, U, 32, rnd, 0.06);
    for (let b = 0; b < 4; b++) {
      const x = b * 32;
      R(g, '#2a2420', x + 6, 6, 20, 26); // arch opening
      R(g, '#2a2420', x + 8, 4, 16, 2);
      R(g, '#2a2420', x + 11, 3, 10, 1);
      R(g, '#5a4a38', x + 9, 14, 14, 14); // shop inside
      pane(P, rnd, x + 10, 15, 12, 12, 0.85, WARM);
      R(ge, 'rgba(255,200,120,0.25)', x + 6, 6, 20, 26);
      R(g, '#f2e8d0', x, 0, 6, 32);
      R(g, '#c8b898', x + 5, 0, 1, 32);
    }
  },
  gate(P, rnd) {
    const { g, ge } = P;
    R(g, '#a05442', 0, 0, U, 32);
    grain(g, U, 32, rnd, 0.08);
    for (let b = 0; b < 4; b++) {
      const x = b * 32;
      if (b % 2 === 0) {
        R(g, '#4a5a64', x + 3, 6, 26, 26); // steel gate
        for (let k = 0; k < 26; k += 3) R(g, '#3a4850', x + 3, 6 + k, 26, 1);
        for (let k = 0; k < 6; k++) R(g, k % 2 ? '#e8c020' : '#202020', x + 3 + k * 4.4, 4, 4.4, 2);
      } else {
        for (let k = 0; k < 3; k++) pane(P, rnd, x + 4 + k * 9, 10, 7, 8, 0.6, ['#d8f0c8']);
      }
      R(ge, '#000', x, 0, 1, 1);
    }
  },
  glass(P, rnd) {
    const { g } = P;
    R(g, '#d0ccc4', 0, 0, U, 32);
    R(g, '#3a3a3a', 0, 0, U, 6);
    for (let k = 0; k < 10; k++) R(g, SIGN_COLS[k % SIGN_COLS.length], 4 + k * 12, 2, 8, 2);
    for (let b = 0; b < 16; b++) pane(P, rnd, b * 8 + 1, 7, 7, 25, 0.95, WARM.concat(COLD));
  },
  plain(P, rnd) {
    const { g } = P;
    R(g, '#d2cabc', 0, 0, U, 32);
    grain(g, U, 32, rnd, 0.07);
    for (let y = 0; y < 32; y += 4) R(g, '#bcb4a4', 0, y, U, 1); // rustication
    for (let b = 0; b < 4; b++) {
      const x = b * 32;
      R(g, '#f4ecdc', x + 9, 9, 14, 16);
      pane(P, rnd, x + 10, 10, 12, 14, 0.4);
    }
  },
};

const cache = new Map();

/**
 * @returns {{map: THREE.Texture, emissive: THREE.Texture}}
 */
export function facadeTexture(style, seed = 1) {
  const key = `f_${style}_${seed}_${RETRO.enabled}`;
  if (cache.has(key)) return cache.get(key);
  const P = pair(U, U);
  (FACADES[style] || FACADES.blok)(P, rng(seed * 7919 + 17));
  const out = { map: toTex(P.c), emissive: toTex(P.e) };
  cache.set(key, out);
  return out;
}

export function groundFloorTexture(style, seed = 1) {
  const key = `g_${style}_${seed}_${RETRO.enabled}`;
  if (cache.has(key)) return cache.get(key);
  const P = pair(U, 32);
  (GROUNDS[style] || GROUNDS.plain)(P, rng(seed * 104729 + 3));
  const out = { map: toTex(P.c), emissive: toTex(P.e) };
  cache.set(key, out);
  return out;
}

export function roofTexture() {
  if (cache.has('roof')) return cache.get('roof');
  const P = pair(64, 64);
  const r = rng(99);
  R(P.g, '#6a6662', 0, 0, 64, 64);
  grain(P.g, 64, 64, r, 0.12);
  R(P.g, '#55514c', 0, 31, 64, 1);
  R(P.g, '#55514c', 31, 0, 1, 64);
  const out = toTex(P.c);
  cache.set('roof', out);
  return out;
}

// Pavement slabs with a kerb stone row (U runs across, V along the street).
export function pavementTexture() {
  if (cache.has('pave')) return cache.get('pave');
  const P = pair(64, 64);
  const r = rng(5);
  R(P.g, '#a8a49c', 0, 0, 64, 64);
  grain(P.g, 64, 64, r, 0.08);
  for (let y = 0; y < 64; y += 16) R(P.g, '#8a867e', 0, y, 64, 1);
  for (let x = 0; x < 64; x += 16) R(P.g, '#8a867e', x, 0, 1, 64);
  const out = toTex(P.c);
  cache.set('pave', out);
  return out;
}

// City ground: asphalt streets with faded lane paint, cobble squares.
export function streetTexture(base = '#4a4a4c') {
  const key = `street_${base}`;
  if (cache.has(key)) return cache.get(key);
  const P = pair(128, 128);
  const r = rng(11);
  R(P.g, base, 0, 0, 128, 128);
  grain(P.g, 128, 128, r, 0.07);
  R(P.g, 'rgba(255,255,255,0.10)', 0, 0, 128, 2);
  R(P.g, 'rgba(255,255,255,0.10)', 0, 0, 2, 128);
  for (let y = 8; y < 128; y += 24) R(P.g, 'rgba(240,230,200,0.25)', 63, y, 2, 12);
  for (let x = 8; x < 128; x += 24) R(P.g, 'rgba(240,230,200,0.25)', x, 63, 12, 2);
  const out = toTex(P.c);
  cache.set(key, out);
  return out;
}

// Texture atlas of horizontal strips (signs / posters): one material, one draw call.
export function stripAtlas(items, { w = 256, h = 48, draw }) {
  const k = RETRO.enabled ? 1 : 2;
  const c = document.createElement('canvas');
  c.width = w * k;
  c.height = h * items.length * k;
  const g = c.getContext('2d');
  g.scale(k, k);
  items.forEach((it, i) => {
    g.save();
    g.translate(0, i * h);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    draw(g, it, w, h);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (RETRO.enabled) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  } else t.anisotropy = 4;
  // UV rect (v from bottom) for item i
  const rect = (i) => [0, 1 - (i + 1) / items.length, 1, 1 - i / items.length];
  return { texture: t, rect, count: items.length };
}
