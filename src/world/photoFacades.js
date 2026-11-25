// Photo façades (assets/textures/buildings) for the generated buildings, so
// the procedural city matches the hand-made Blockbench models: each photo
// covers a whole façade (ground floor to roof) and tiles only horizontally.
// Every photo gets a lit-window emissive twin for dusk / night, derived from
// the photo itself (dark window panes, random warm cells).
import * as THREE from 'three';
import { RETRO } from '../fx/retro.js';

const URLS = import.meta.glob('../../assets/textures/buildings/*.{jpeg,jpg}', { eager: true, query: '?url', import: 'default' });
const urlOf = (name) => {
  for (const [k, v] of Object.entries(URLS)) if (k.split('/').pop().replace(/\.[^.]+$/, '') === name) return v;
  return null;
};

// h: real height (m) of the façade the photo shows; crop: [top, bottom]
// fractions of sky / pavement to cut; floors: storeys (for the window grid).
export const PHOTOS = {
  building01: { h: 31, floors: 11 },
  building02: { h: 31, floors: 11 },
  building03: { h: 30, floors: 11, crop: [0.06, 0] },
  building04: { h: 26, floors: 8 },
  building04_01: { h: 26, floors: 8 },
  building05: { h: 46, floors: 16 },
  building_06: { h: 42, floors: 15, crop: [0.03, 0] },
  building_07: { h: 12.5, floors: 4 },
  factory: { h: 20, floors: 5 },
  office: { h: 27, floors: 8 },
  office_02: { h: 13, floors: 4 },
  stores: { h: 11, floors: 3 },
  stores_02: { h: 9, floors: 2, crop: [0.08, 0.04] },
  store_03: { h: 8, floors: 2, crop: [0.14, 0.1] },
};

// generated building styles -> photos
export const STYLE_PHOTOS = {
  blok: ['building01', 'building02', 'building03', 'building_07'],
  wiezowiec: ['building05', 'building_06'],
  socrealizm: ['office', 'building04', 'building04_01'],
  hala: ['factory'],
  pawilon: ['stores', 'stores_02', 'store_03'],
  futuro: ['office_02', 'building04_01', 'office'],
  kamienica: ['building_07', 'stores', 'office_02'],
};

const loaded = new Map(); // name -> {map, emissive, w, h}
let pending = null;

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function filter(t) {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  if (RETRO.enabled) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  } else t.anisotropy = 4;
  return t;
}

export function preloadPhotoFacades() {
  if (pending) return pending;
  pending = Promise.all(Object.entries(PHOTOS).map(async ([name, def]) => {
    try {
      const img = await loadImage(urlOf(name));
      const [ct, cb] = def.crop || [0, 0];
      const sy = img.height * ct;
      const sh = img.height * (1 - ct - cb);
      // PSX look: modest texture size, point sampled
      const H = RETRO.enabled ? 256 : 512;
      const W = Math.round((H * img.width) / sh);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, sy, img.width, sh, 0, 0, W, H);
      const map = filter(new THREE.CanvasTexture(c));
      const emissive = filter(windowsFromCanvas(c, { rows: def.floors, cols: Math.round(((W / H) * def.h) / 3.2) }));
      loaded.set(name, { map, emissive, h: def.h, w: (def.h * W) / H, name });
    } catch (e) {
      console.warn('[facade] missing photo', name, e);
    }
  }));
  return pending;
}

/** Photo façade for a generated style; `variant` picks among the style's photos. */
export function photoFacade(style, variant = 0) {
  const list = STYLE_PHOTOS[style] || STYLE_PHOTOS.blok;
  for (let i = 0; i < list.length; i++) {
    const p = loaded.get(list[(variant + i) % list.length]);
    if (p) return p;
  }
  return null;
}

// Emissive "lit windows" map from a façade image: window panes are the dark,
// low-saturation pixels; a random subset of window cells glows warm.
function windowsFromCanvas(src, { rows = 0, cols = 0, cell = 8 } = {}) {
  const W = Math.min(256, src.width);
  const H = Math.max(1, Math.round((src.height * W) / src.width));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  // mean luminance -> relative darkness threshold
  let mean = 0;
  for (let i = 0; i < d.length; i += 4) mean += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  mean /= d.length / 4;
  const cw = cols ? W / cols : cell;
  const ch = rows ? H / rows : cell;
  let seed = W * 7 + H * 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lit = new Map();
  const warm = [[255, 200, 110], [255, 220, 150], [255, 180, 90], [200, 220, 255], [255, 235, 190]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      const key = Math.floor(x / cw) * 1000 + Math.floor(y / ch);
      if (!lit.has(key)) lit.set(key, rnd() < 0.32 ? warm[Math.floor(rnd() * warm.length)] : null);
      const col = lit.get(key);
      const m = col ? Math.min(1, Math.max(0, (mean * 0.85 - l) / (mean * 0.35))) : 0;
      d[i] = col ? col[0] * m : 0;
      d[i + 1] = col ? col[1] * m : 0;
      d[i + 2] = col ? col[2] * m : 0;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Lit-window map for an already loaded texture (glTF building atlases). */
export function nightWindows(tex) {
  const img = tex.image;
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = Math.min(256, img.width);
  c.height = Math.max(1, Math.round((img.height * c.width) / img.width));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const t = windowsFromCanvas(c, { cell: Math.max(3, c.width / 64) });
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = tex.flipY;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
