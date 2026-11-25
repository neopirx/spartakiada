// Trackside city in the manner of the 90s arcade street circuits: unbroken
// rows of buildings run along both edges of the track behind a narrow
// pavement, so the road reads as a street through a real city. Tunnels
// become gateway buildings the road passes through, footbridges with slogan
// banners span the road, and lamps / flags / trees line the pavements.
//
// Everything is batched into a handful of meshes (one per material).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { TAG } from '../track/trackData.js';
import { BAY, FLOOR, GROUND, facadeTexture, groundFloorTexture, roofTexture, pavementTexture, stripAtlas } from './facades.js';
import { ASSETS, instanceAsset, placeMatrix } from './assets.js';
import { brutalFacade, brutalGround } from './brutal.js';
import { photoTexture, PHOTO } from './photoTextures.js';

const HW = CONFIG.track.width / 2;
const WH = CONFIG.track.wallHeight;
const GY = CONFIG.track.groundY;
const HULL = HW + 1.2; // outer edge of the track hull
// ?assets=0..1 scales the share of hand-made models in the rows (debugging)
const ASSET_MUL = (() => {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('assets') : null;
  return q == null ? 1 : Math.max(0, +q || 0);
})();
const CLEAR = HULL + 3.0; // building footprints keep this far from the centerline

// Building types: floors range, bays range, depth range, brutalist façade +
// ground-floor styles (brutal.js), tint palette (vertex colours multiplying
// the light concrete textures) and the massing forms they can take:
//   plain    – one slab with a heavy parapet
//   pilotis  – upper floors on columns over a recessed, glazed ground floor
//   inverted – upper floors cantilevered out over a narrower base
//   stepped  – terraces stepping back from the street
//   core     – ribbed stair / lift towers rising past the roof
const CONCRETE = ['#ffffff', '#ece8e0', '#dedad2', '#f2ebe0', '#d2d0cc', '#e6dccb', '#c9c5bd'];
const WARM_CONCRETE = ['#f0e4d0', '#e8d8c0', '#f4ece0', '#dccfbc', '#e8e0d4'];
const TYPES = {
  blok: { floors: [6, 12], bays: [6, 14], depth: [12, 15], facade: 'panel', ground: ['glazed', 'plinth'], tints: CONCRETE, forms: { plain: 2, pilotis: 2, core: 2 } },
  kamienica: { floors: [4, 7], bays: [4, 8], depth: [14, 18], facade: 'ribbon', ground: ['glazed', 'glazed', 'plinth'], tints: WARM_CONCRETE, forms: { plain: 2, inverted: 2, stepped: 1 } },
  socrealizm: { floors: [5, 9], bays: [8, 14], depth: [16, 20], facade: 'waffle', ground: ['glazed'], tints: CONCRETE, forms: { pilotis: 3, inverted: 2, core: 1 } },
  wiezowiec: { floors: [14, 24], bays: [6, 9], depth: [16, 20], facade: 'fins', ground: ['glazed'], tints: CONCRETE, forms: { core: 3, pilotis: 1 }, podium: true },
  hala: { floors: [2, 4], bays: [8, 16], depth: [20, 28], facade: 'hall', ground: ['plinth'], tints: ['#ffffff', '#e8e0d8', '#dcd4cc'], sawtooth: true, forms: { plain: 1 } },
  pawilon: { floors: [1, 2], bays: [6, 12], depth: [14, 20], facade: 'ribbon', ground: ['glazed'], tints: WARM_CONCRETE, sign: 1, forms: { plain: 1, pilotis: 1 } },
  futuro: { floors: [6, 12], bays: [6, 10], depth: [14, 18], facade: 'waffle', ground: ['glazed'], tints: CONCRETE, forms: { inverted: 3, stepped: 2, core: 1 } },
};

// City themes: weighted building mix + street furniture.
// `assets`: share of row slots that use a hand-made model; `kinds`: their mix.
export const CITY_THEMES = {
  centrum: { mix: { kamienica: 4, socrealizm: 2, blok: 2, pawilon: 2, wiezowiec: 1 }, assets: 0.55, kinds: { block: 3, office: 2, shop: 3, tower: 1 }, trees: 0.5, flags: 0.5, neon: 0.3, gap: 0.16 },
  huta: { mix: { hala: 4, blok: 3, socrealizm: 2, pawilon: 1 }, assets: 0.5, kinds: { hall: 4, block: 2, shop: 1, office: 1 }, trees: 0.25, flags: 0.7, neon: 0.2, gap: 0.2, chimneys: true },
  nocna: { mix: { blok: 3, pawilon: 3, kamienica: 2, wiezowiec: 2, futuro: 1 }, assets: 0.55, kinds: { block: 3, tower: 2, shop: 3, office: 1 }, trees: 0.2, flags: 0.3, neon: 0.6, gap: 0.16 },
  futuro: { mix: { futuro: 4, wiezowiec: 3, pawilon: 2, blok: 1 }, assets: 0.5, kinds: { office: 3, tower: 3, block: 1, shop: 2 }, trees: 0.3, flags: 0.4, neon: 0.45, gap: 0.18 },
};

const NEON_TEXTS = [
  ['BAR MLECZNY', '#4de0ff'], ['KINO', '#ff4060'], ['DOM TOWAROWY', '#ffcc40'], ['KAWIARNIA', '#ff60d0'],
  ['HOTEL', '#60ff9a'], ['TELEWIZORY', '#4da6ff'], ['APTEKA', '#5aff6a'], ['AUTOSERWIS', '#ff8030'],
  ['DWORZEC', '#e8f0ff'], ['RESTAURACJA', '#ff4a4a'], ['MLEKO', '#ffffff'], ['DELIKATESY', '#ffd040'],
  ['SAM', '#ff4060'], ['KSIĘGARNIA', '#60c0ff'], ['FOTO', '#ff80ff'], ['ZEGARY', '#80ffd0'],
  ['RADIO · TV', '#4da6ff'], ['MODA', '#ff60a0'], ['CUKIERNIA', '#ffa0d0'], ['POCZTA', '#ffe060'],
  ['KWIACIARNIA', '#80ff80'], ['TEATR', '#ff5050'], ['ODZIEŻ', '#a0c0ff'], ['ANTYGRAWITACJA', '#40ffe0'],
];

export const SLOGANS = [
  ['SZYBCIEJ!', 'WYŻEJ! DALEJ!'],
  ['PLAN 5-LETNI', 'W 3 OKRĄŻENIA'],
  ['PRZODOWNIK', 'PRĘDKOŚCI 2136'],
  ['ANTYGRAWITACJA', 'DLA KAŻDEGO'],
  ['MŁODZIEŻ', 'NA TOR!'],
  ['POLONEZ', 'KRÓL TORU'],
  ['JEDŹ Z GŁOWĄ', 'TOWARZYSZU'],
  ['SPARTAKIADA', 'IGRZYSKA PRZYSZŁOŚCI'],
  ['STAL Z HUTY', 'PRĘDKOŚĆ Z POLSKI'],
  ['ORANŻADA', 'NAPÓJ MISTRZÓW'],
  ['MALUCH', 'MAŁY ALE WARIAT'],
  ['KOSMOS', 'JEST NASZ!'],
];
const POSTER_PAL = [
  ['#e9e1cf', '#b0141c', '#1d1d1d'],
  ['#b0141c', '#f3ead6', '#111111'],
  ['#1e2d4a', '#f0e6d0', '#d23a22'],
  ['#d9a521', '#1a1a1a', '#b0141c'],
];

// --------------------------------------------------------------------------------
// geometry batch: per-material arrays of triangles
class Batch {
  constructor() {
    this.parts = new Map();
  }

  _part(key) {
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { pos: [], nrm: [], uv: [], col: [] }));
    return p;
  }

  tri(key, a, b, c, uva, uvb, uvc, col) {
    const p = this._part(key);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [v, uv] of [[a, uva], [b, uvb], [c, uvc]]) {
      p.pos.push(v.x, v.y, v.z);
      p.nrm.push(n.x, n.y, n.z);
      p.uv.push(uv[0], uv[1]);
      p.col.push(col.r, col.g, col.b);
    }
  }

  // a,b,c,d counter-clockwise seen from the front
  quad(key, a, b, c, d, [u0, v0, u1, v1], col) {
    this.tri(key, a, b, c, [u0, v0], [u1, v0], [u1, v1], col);
    this.tri(key, a, c, d, [u0, v0], [u1, v1], [u0, v1], col);
  }

  // vertical wall: bottom-centre (cx, cz), outward normal (nx, nz), width w, from y0 to y1.
  // u runs in metres / uRep from uStart, v in metres / vRep from vBase.
  wall(key, cx, cz, nx, nz, w, y0, y1, { uRep = 4 * BAY, vRep = 4 * FLOOR, vBase = y0, uStart = 0 } = {}, col = WHITE) {
    const rx = nz;
    const rz = -nx; // right as seen from outside = up × n
    const a = new THREE.Vector3(cx - (rx * w) / 2, y0, cz - (rz * w) / 2);
    const b = new THREE.Vector3(cx + (rx * w) / 2, y0, cz + (rz * w) / 2);
    const c = new THREE.Vector3(b.x, y1, b.z);
    const d = new THREE.Vector3(a.x, y1, a.z);
    this.quad(key, a, b, c, d, [uStart, (y0 - vBase) / vRep, uStart + w / uRep, (y1 - vBase) / vRep], col);
  }

  // horizontal rectangle (roof), centre, axis A (along w), size w × d, facing up
  roof(key, cx, cz, ax, az, w, d, y, col = WHITE, scale = 8) {
    const nx = -az;
    const nz = ax; // perpendicular
    const P = (sa, sn) => new THREE.Vector3(cx + ax * sa * w / 2 + nx * sn * d / 2, y, cz + az * sa * w / 2 + nz * sn * d / 2);
    const a = P(-1, -1);
    const b = P(1, -1);
    const c = P(1, 1);
    const e = P(-1, 1);
    // make sure it faces up
    const up = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y > 0;
    const uv = (v) => [v.x / scale, v.z / scale];
    if (up) {
      this.tri(key, a, b, c, uv(a), uv(b), uv(c), col);
      this.tri(key, a, c, e, uv(a), uv(c), uv(e), col);
    } else {
      this.tri(key, a, c, b, uv(a), uv(c), uv(b), col);
      this.tri(key, a, e, c, uv(a), uv(e), uv(c), col);
    }
  }

  // horizontal rectangle facing down (soffits under cantilevers / pilotis)
  ceiling(key, cx, cz, ax, az, w, d, y, col = WHITE, scale = 8) {
    const nx = -az;
    const nz = ax;
    const P = (sa, sn) => new THREE.Vector3(cx + ax * sa * w / 2 + nx * sn * d / 2, y, cz + az * sa * w / 2 + nz * sn * d / 2);
    const a = P(-1, -1);
    const b = P(1, -1);
    const c = P(1, 1);
    const e = P(-1, 1);
    const up = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y > 0;
    const uv = (v) => [v.x / scale, v.z / scale];
    if (up) {
      this.tri(key, a, c, b, uv(a), uv(c), uv(b), col);
      this.tri(key, a, e, c, uv(a), uv(e), uv(c), col);
    } else {
      this.tri(key, a, b, c, uv(a), uv(b), uv(c), col);
      this.tri(key, a, c, e, uv(a), uv(c), uv(e), col);
    }
  }

  // box with every face textured with `key` (props, trims)
  box(key, cx, cz, ax, az, w, d, y0, y1, col = WHITE, opts) {
    const nx = -az;
    const nz = ax;
    this.wall(key, cx + nx * d / 2, cz + nz * d / 2, nx, nz, w, y0, y1, opts, col);
    this.wall(key, cx - nx * d / 2, cz - nz * d / 2, -nx, -nz, w, y0, y1, opts, col);
    this.wall(key, cx + ax * w / 2, cz + az * w / 2, ax, az, d, y0, y1, opts, col);
    this.wall(key, cx - ax * w / 2, cz - az * w / 2, -ax, -az, d, y0, y1, opts, col);
    this.roof(key, cx, cz, ax, az, w, d, y1, col);
  }

  build(materials) {
    const meshes = [];
    for (const [key, p] of this.parts) {
      if (!p.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials(key));
      m.name = `city_${key}`;
      meshes.push(m);
    }
    return meshes;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// --------------------------------------------------------------------------------
// spatial lookup of track centerline points (XZ), for clearance tests
class TrackHash {
  constructor(track, step = 2, cell = 16) {
    this.cell = cell;
    this.map = new Map();
    const n = Math.max(1, Math.round(step / track.ds));
    for (let i = 0; i < track.count; i += n) {
      const x = track.pos[i * 3];
      const z = track.pos[i * 3 + 2];
      const k = this.key(Math.floor(x / cell), Math.floor(z / cell));
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(x, z, track.pos[i * 3 + 1], i);
    }
  }

  key(i, j) {
    return i * 73856093 + j * 19349663;
  }

  // distance to the nearest centerline point, capped at r
  dist(x, z, r) {
    const c = this.cell;
    const n = Math.ceil(r / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    let best = r * r;
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const a = this.map.get(this.key(cx + i, cz + j));
        if (!a) continue;
        for (let k = 0; k < a.length; k += 4) {
          const dx = a[k] - x;
          const dz = a[k + 1] - z;
          const d = dx * dx + dz * dz;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }

  // highest road point within r (for buildings next to elevated sections)
  maxY(x, z, r, track) {
    const c = this.cell;
    const n = Math.ceil(r / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    let best = 0;
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const a = this.map.get(this.key(cx + i, cz + j));
        if (!a) continue;
        for (let k = 0; k < a.length; k += 4) {
          if (track.tags[a[k + 3]] & TAG.MAGNET) continue;
          const dx = a[k] - x;
          const dz = a[k + 1] - z;
          if (dx * dx + dz * dz < r * r && a[k + 2] > best) best = a[k + 2];
        }
      }
    }
    return best;
  }
}

// occupancy grid (2 m cells) so buildings never overlap each other
class Occupancy {
  constructor(cell = 2) {
    this.cell = cell;
    this.set = new Set();
  }

  _cells(cx, cz, ax, az, w, d, fn) {
    const nx = -az;
    const nz = ax;
    const st = this.cell * 0.7;
    for (let a = -w / 2; a <= w / 2 + 1e-6; a += Math.min(st, w)) {
      for (let b = -d / 2; b <= d / 2 + 1e-6; b += Math.min(st, d)) {
        const x = cx + ax * a + nx * b;
        const z = cz + az * a + nz * b;
        if (fn(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`, x, z) === false) return false;
      }
    }
    return true;
  }

  free(cx, cz, ax, az, w, d) {
    return this._cells(cx, cz, ax, az, w, d, (k) => !this.set.has(k));
  }

  mark(cx, cz, ax, az, w, d) {
    this._cells(cx, cz, ax, az, w, d, (k) => {
      this.set.add(k);
    });
  }
}

const tint = (hex, rnd, amt = 0.06) => {
  const c = new THREE.Color(hex);
  const k = 1 - amt + rnd() * amt * 2;
  return c.multiplyScalar(k);
};

function weighted(mix, rnd) {
  const entries = Object.entries(mix);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rnd() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[0][0];
}

const ri = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1));
const rf = (rnd, a, b) => a + rnd() * (b - a);

// ================================================================================
export class City {
  /**
   * @param {TrackData} track
   * @param {{rng: () => number, theme: string, time: object}} opts
   */
  constructor(track, { rng, theme = 'centrum', time }) {
    this.track = track;
    this.rng = rng;
    this.theme = CITY_THEMES[theme] || CITY_THEMES.centrum;
    this.time = time;
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.batch = new Batch();
    this.hash = new TrackHash(track);
    this.occ = new Occupancy();
    this.footprints = []; // {x, z, r} for the background filler
    this.signs = []; // neon sign quads
    this.posters = []; // mural / banner quads
    this.lamps = [];
    this.trees = [];
    this.flags = [];
    this.assetPlacements = []; // {id, x, z, yaw}
    this.kiosks = 0;
    this.grass = [];
    this.variant = Math.floor(rng() * 1000);

    this._reserveSpecials();
    this._tunnels();
    this._footbridges();
    for (const side of [-1, 1]) this._row(side);
    this._pavements();
    this._furniture();
    this._buildMeshes();
  }

  // ------------------------------------------------------------------------------
  // flat frame at s: position, forward (XZ), right (XZ)
  flat(s) {
    const t = this.track;
    const fr = t.frameAt(s, this._fr || (this._fr = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3() }));
    const f = new THREE.Vector2(fr.fwd.x, fr.fwd.z);
    if (f.lengthSq() < 1e-6) f.set(0, 1);
    f.normalize();
    // track right = cross(fwd, up) -> (-fz, fx) in (x, z)
    const r = new THREE.Vector2(-f.y, f.x);
    return { x: fr.pos.x, y: fr.pos.y, z: fr.pos.z, fx: f.x, fz: f.y, rx: r.x, rz: r.y, upY: fr.up.y };
  }

  _badAt(s) {
    const tags = this.track.tagsAt(s);
    return (tags & (TAG.MAGNET | TAG.LOOP | TAG.STANDS | TAG.BRIDGE | TAG.TUNNEL)) !== 0;
  }

  // sections where no row buildings go (tunnels are handled separately)
  _reserveSpecials() {
    this.blocked = [];
  }

  _isBlocked(s0, s1) {
    for (const [a, b] of this.blocked) if (s1 > a && s0 < b) return true;
    return false;
  }

  // footprint test against the track and other buildings
  _fits(cx, cz, ax, az, w, d) {
    const nx = -az;
    const nz = ax;
    const st = 3;
    for (let a = -w / 2; a <= w / 2 + 1e-6; a += Math.min(st, w)) {
      for (let b = -d / 2; b <= d / 2 + 1e-6; b += Math.min(st, d)) {
        if (this.hash.dist(cx + ax * a + nx * b, cz + az * a + nz * b, CLEAR + 1) < CLEAR) return false;
      }
    }
    return this.occ.free(cx, cz, ax, az, w, d);
  }

  // ------------------------------------------------------------------------------
  // one row of buildings along one side of the track
  _row(side) {
    const t = this.track;
    const rnd = this.rng;
    const L = t.length;
    let s = rnd() * 20;
    const end = L - 2;
    let sidewalk = rf(rnd, 3.5, 5.5);
    while (s < end) {
      if (this._badAt(s)) {
        s += 4;
        continue;
      }
      let placed = false;
      if (ASSETS && rnd() < (this.theme.assets ?? 0) * ASSET_MUL) {
        const w = this._assetBuilding(side, s, end, sidewalk);
        if (w > 0) {
          s += w;
          placed = true;
        }
      }
      if (placed) {
        if (rnd() < this.theme.gap) {
          const g = rf(rnd, 10, 20);
          this._gap(side, s, s + g);
          s += g; // side street
          sidewalk = rf(rnd, 3.5, 5.5);
        }
        continue;
      }
      const typeName = weighted(this.theme.mix, rnd);
      const T = TYPES[typeName];
      let bays = ri(rnd, T.bays);
      for (let attempt = 0; attempt < 4 && !placed; attempt++) {
        const w = bays * BAY;
        const d = rf(rnd, T.depth[0], T.depth[1]);
        const sm = s + w / 2;
        if (sm + w / 2 > end || this._badAt(sm) || this._badAt(s + w) || this._isBlocked(s, s + w)) break;
        const F = this.flat(sm);
        if (F.upY < 0.7) break;
        const setback = HULL + sidewalk + attempt * 3;
        const off = setback + d / 2;
        const cx = F.x + F.rx * side * off;
        const cz = F.z + F.rz * side * off;
        if (this._fits(cx, cz, F.fx, F.fz, w, d)) {
          this._building(T, typeName, cx, cz, F.fx, F.fz, -F.rx * side, -F.rz * side, w, d, setback);
          this.occ.mark(cx, cz, F.fx, F.fz, w + 0.5, d + 0.5);
          this.footprints.push({ x: cx, z: cz, r: Math.hypot(w, d) / 2 });
          s += w;
          placed = true;
        } else if (attempt === 1) bays = Math.max(2, Math.floor(bays / 2));
      }
      if (!placed) s += 5;
      else if (rnd() < this.theme.gap) {
        const g = rf(rnd, 10, 20);
        this._gap(side, s, s + g);
        s += g; // side street
        sidewalk = rf(rnd, 3.5, 5.5);
      }
    }
  }

  // A hand-made building (assets.js) in the row at s. Returns the street
  // length it used, or 0 if none fitted.
  _assetBuilding(side, s, end, sidewalk) {
    const rnd = this.rng;
    const kinds = this.theme.kinds || { block: 1 };
    for (let attempt = 0; attempt < 3; attempt++) {
      const kind = weighted(kinds, rnd);
      const ids = Object.keys(ASSETS.buildings).filter((id) => ASSETS.buildings[id].def.kind === kind);
      if (!ids.length) continue;
      const a = ASSETS.buildings[ids[Math.floor(rnd() * ids.length)]];
      const w = a.size.x;
      const d = a.size.z;
      const sm = s + w / 2;
      if (sm + w / 2 > end || this._badAt(sm) || this._badAt(s + w) || this._isBlocked(s, s + w)) continue;
      const F = this.flat(sm);
      if (F.upY < 0.7) continue;
      for (let back = 0; back < 3; back++) {
        const setback = HULL + sidewalk + back * 3;
        const off = setback + d / 2;
        const cx = F.x + F.rx * side * off;
        const cz = F.z + F.rz * side * off;
        // next to elevated road the canyon walls must stay above it
        const ty = this.hash.maxY(cx, cz, Math.max(w, d) / 2 + setback + 6, this.track);
        if (a.size.y < ty - GY + 9) break;
        if (!this._fits(cx, cz, F.fx, F.fz, w, d)) continue;
        const nx = -F.rx * side;
        const nz = -F.rz * side;
        this.assetPlacements.push({ id: a.id, x: cx, z: cz, yaw: Math.atan2(nx, nz) });
        this.occ.mark(cx, cz, F.fx, F.fz, w + 0.5, d + 0.5);
        this.footprints.push({ x: cx, z: cz, r: Math.hypot(w, d) / 2 });
        // shops get a neon sign on the roof edge
        if ((kind === 'shop' && rnd() < 0.7) || (kind === 'office' && rnd() < this.theme.neon)) {
          this._sign(cx + nx * (d / 2 - 0.8), cz + nz * (d / 2 - 0.8), nx, nz, Math.min(w * 0.6, 8 + rnd() * 10), GY + a.size.y);
        }
        return w;
      }
    }
    return 0;
  }

  // Side street between s0 and s1: a RUCH kiosk on the corner, trees, grass.
  _gap(side, s0, s1) {
    if (!ASSETS) return;
    const rnd = this.rng;
    const t = this.track;
    if (s1 > t.length - 2 || this._badAt(s0) || this._badAt(s1)) return;
    const kiosk = ASSETS.buildings.kiosk;
    if (kiosk && rnd() < 0.55 && s1 - s0 > kiosk.size.x + 2) {
      const sm = s0 + 1 + kiosk.size.x / 2 + rnd() * (s1 - s0 - kiosk.size.x - 2);
      const F = this.flat(sm);
      const off = HULL + 2.2 + kiosk.size.z / 2;
      const x = F.x + F.rx * side * off;
      const z = F.z + F.rz * side * off;
      if (F.upY > 0.9 && F.y < 3 && this.hash.dist(x, z, off) > off - 0.6 && this.occ.free(x, z, F.fx, F.fz, kiosk.size.x, kiosk.size.z)) {
        this.assetPlacements.push({ id: 'kiosk', x, z, yaw: Math.atan2(-F.rx * side, -F.rz * side) });
        this.occ.mark(x, z, F.fx, F.fz, kiosk.size.x + 0.5, kiosk.size.z + 0.5);
        this.kiosks++;
      }
    }
    this._fence(side, s0, s1);
    // a tree or two further back in the side street
    const n = rnd() < this.theme.trees + 0.3 ? 1 + Math.floor(rnd() * 2) : 0;
    for (let i = 0; i < n; i++) {
      const F = this.flat(s0 + (s1 - s0) * (0.3 + rnd() * 0.4));
      if (F.y > 3) continue;
      const off = HULL + 9 + rnd() * 10;
      const x = F.x + F.rx * side * off;
      const z = F.z + F.rz * side * off;
      if (this.hash.dist(x, z, off) > off - 1 && this.occ.free(x, z, 1, 0, 3, 3)) {
        this.trees.push({ x, z, s: 0.85 + rnd() * 0.3, big: true });
        this.occ.mark(x, z, 1, 0, 3, 3);
      }
    }
  }

  // A precast concrete fence ("jumbo" panels, sometimes covered in graffiti
  // or pasted-up posters) closing off a side street / vacant lot at the back
  // edge of the pavement. Follows the track, skipped where the road isn't at
  // street level.
  _fence(side, s0, s1) {
    const rnd = this.rng;
    if (rnd() > (this.theme.chimneys ? 0.7 : 0.45)) return;
    const r = rnd();
    const kind = r < 0.6 ? 'fence' : r < 0.8 ? 'graffiti' : 'posters';
    if (!photoTexture(kind)) return;
    const [uRep, H] = PHOTO[kind].size;
    const off = HULL + 6.4;
    const y0 = GY + 0.3;
    const n = Math.max(1, Math.round((s1 - s0) / 3));
    const col = new THREE.Color().setScalar(0.9 + rnd() * 0.1);
    let prev = null;
    let u = rnd() * 4;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const F = this.flat(s);
      const p = new THREE.Vector3(F.x + F.rx * side * off, y0, F.z + F.rz * side * off);
      const ok = F.y < 3 && F.upY > 0.9 && this.hash.dist(p.x, p.z, off) > off - 0.8;
      if (prev && ok) {
        const len = prev.distanceTo(p);
        const a = side > 0 ? prev : p;
        const b = side > 0 ? p : prev;
        // u runs with s on the left, against it on the right, so the posters
        // and graffiti read left-to-right from the road
        const sg = side > 0 ? -1 : 1;
        const uPrev = sg * u;
        const uCur = sg * (u + len / uRep);
        const ua = side > 0 ? uPrev : uCur;
        const ub = side > 0 ? uCur : uPrev;
        // faces the road; DoubleSide material shows the back too
        this.batch.quad(`fence_${kind}`, b, a, new THREE.Vector3(a.x, y0 + H, a.z), new THREE.Vector3(b.x, y0 + H, b.z), [0, 0, 1, 1], col);
        // quad() maps u0..u1 from b to a: patch the last six uvs with the running u
        const part = this.batch._part(`fence_${kind}`);
        const uvs = part.uv;
        const k = uvs.length - 12;
        const U = [ub, ua, ua, ub, ua, ub]; // b, a, a', b, a', b'
        const V = [0, 0, 1, 0, 1, 1];
        for (let j = 0; j < 6; j++) {
          uvs[k + j * 2] = U[j];
          uvs[k + j * 2 + 1] = V[j];
        }
        u += len / uRep;
      }
      prev = ok ? p : null;
    }
  }

  // ------------------------------------------------------------------------------
  // a single brutalist building. (cx, cz) centre, A = along the street,
  // N = facing the street. The footprint (w × d) is the outermost extent;
  // forms only ever pull parts of the mass back inside it.
  _building(T, typeName, cx, cz, ax, az, nx, nz, w, d, setback) {
    const rnd = this.rng;
    const B = this.batch;
    const v = (this.variant + Math.floor(rnd() * 3)) % 3;
    const fKey = `bfac_${T.facade}_${v}`;
    const gKey = `bgnd_${T.ground[Math.floor(rnd() * T.ground.length)]}_${v}`;
    const cKey = `bfac_blank_${v}`;
    const col = tint(T.tints[Math.floor(rnd() * T.tints.length)], rnd, 0.03);
    const dark = col.clone().multiplyScalar(0.88);
    // road height next to this building -> keep the canyon walls above it
    const ty = this.hash.maxY(cx, cz, Math.max(w, d) / 2 + setback + 6, this.track);
    const roadLow = ty - GY < 4;
    let floors = ri(rnd, T.floors);
    const need = ty - GY + 9;
    const minFloors = Math.ceil((need - GROUND) / FLOOR);
    if (floors < minFloors) floors = minFloors + Math.floor(rnd() * 3);
    let form = weighted(T.forms || { plain: 1 }, rnd);
    if (floors < 3 && form !== 'pilotis') form = 'plain';
    const y0 = GY;
    const yG = y0 + GROUND;
    let top = yG + floors * FLOOR;
    const fOpts = { vBase: yG };
    const gOpts = { vRep: GROUND, vBase: y0 };

    // rectangle inside the footprint: insets from the left / right ends,
    // the back and the front (street side)
    const rect = (l = 0, r = 0, b = 0, f = 0) => {
      const a0 = -w / 2 + l;
      const a1 = w / 2 - r;
      const n0 = -d / 2 + b;
      const n1 = d / 2 - f;
      const ca = (a0 + a1) / 2;
      const cn = (n0 + n1) / 2;
      return { x: cx + ax * ca + nx * cn, z: cz + az * ca + nz * cn, w: a1 - a0, d: n1 - n0 };
    };
    const walls = (key, R, ya, yb, opts) => {
      B.wall(key, R.x + nx * R.d / 2, R.z + nz * R.d / 2, nx, nz, R.w, ya, yb, opts, col);
      B.wall(key, R.x - nx * R.d / 2, R.z - nz * R.d / 2, -nx, -nz, R.w, ya, yb, opts, col);
      B.wall(key, R.x + ax * R.w / 2, R.z + az * R.w / 2, ax, az, R.d, ya, yb, opts, col);
      B.wall(key, R.x - ax * R.w / 2, R.z - az * R.w / 2, -ax, -az, R.d, ya, yb, opts, col);
    };
    // heavy parapet / slab edge band (solid box, its top doubles as the roof)
    const band = (R, ya, yb, grow = 0.3) => B.box(cKey, R.x, R.z, ax, az, R.w + grow, R.d + grow, ya, yb, dark);
    const soffit = (R, y) => B.ceiling('trim', R.x, R.z, ax, az, R.w, R.d, y - 0.01, dark.clone().multiplyScalar(0.55));
    const full = rect();

    if (T.podium && floors > 8) {
      // waffle podium over the whole footprint, finned tower set back, core
      const pf = 2;
      const pTop = yG + pf * FLOOR;
      walls(gKey, full, y0, yG, gOpts);
      walls(`bfac_waffle_${v}`, full, yG, pTop, fOpts);
      band(full, pTop, pTop + 0.9);
      const tw = Math.max(3, Math.round((w * 0.62) / BAY)) * BAY;
      const tR = rect((w - tw) / 2, (w - tw) / 2, d * 0.08, d * 0.3);
      const tTop = pTop + (floors - pf) * FLOOR;
      walls(fKey, tR, pTop + 0.9, tTop, { vBase: pTop });
      band(tR, tTop, tTop + 1.2);
      // ribbed core on one flank, taller than the tower
      const side = rnd() < 0.5 ? -1 : 1;
      const cw = 5.5;
      const coreA = side * (tR.w / 2 + cw / 2 - 1.2);
      const cTop = tTop + 4 + rnd() * 5;
      const ccx = tR.x + ax * coreA;
      const ccz = tR.z + az * coreA;
      B.box(cKey, ccx, ccz, ax, az, cw, tR.d * 0.55, pTop + 0.9, cTop, col);
      this._roofProps(tR.x, tR.z, ax, az, nx, nz, tR.w, tR.d, tTop + 1.2, col, true);
      if (rnd() < 0.7) this._sign(cx + nx * (d / 2 + 0.2), cz + nz * (d / 2 + 0.2), nx, nz, Math.min(w * 0.8, 22), pTop + 0.9);
      return;
    }

    if (form === 'pilotis') {
      // recessed glazed ground floor, columns carrying the slab above
      const fIn = roadLow ? 2.6 : 1.6;
      const inner = rect(1.8, 1.8, 0, fIn);
      walls(gKey, inner, y0, yG, gOpts);
      soffit(full, yG);
      const n = Math.max(2, Math.round(w / (2 * BAY)));
      for (let k = 0; k <= n; k++) {
        const a = -w / 2 + 0.6 + (k / n) * (w - 1.2);
        for (const nn of [d / 2 - 0.6, -d / 2 + 0.6]) {
          if (nn < 0 && Math.abs(a) < w / 2 - 1) continue; // back row only at the corners
          B.box(cKey, cx + ax * a + nx * nn, cz + az * a + nz * nn, ax, az, 0.9, 0.9, y0, yG, col);
        }
      }
      walls(fKey, full, yG, top, fOpts);
      band(full, yG - 0.6, yG + 0.15, 0.12);
    } else if (form === 'inverted' && floors >= 3) {
      // narrow base, wide upper floors cantilevered over it
      const k = Math.max(1, Math.floor(floors * 0.45));
      const yT = yG + k * FLOOR;
      const base = rect(2.2, 2.2, 0.8, roadLow ? 3.0 : 0.8);
      walls(gKey, base, y0, yG, gOpts);
      walls(fKey, base, yG, yT, fOpts);
      soffit(full, yT - 1.1);
      band(full, yT - 1.1, yT, 0.2);
      walls(fKey, full, yT, top, { vBase: yT });
    } else if (form === 'stepped' && floors >= 4) {
      // terraces stepping back from the street, each with a low parapet
      const tiers = floors >= 8 ? 3 : 2;
      const per = Math.ceil(floors / tiers);
      walls(gKey, full, y0, yG, gOpts);
      let ya = yG;
      for (let i = 0; i < tiers; i++) {
        const fl = i === tiers - 1 ? floors - per * i : per;
        if (fl <= 0) break;
        const R = rect(0, 0, 0, Math.min(d * 0.55, i * 3.6));
        const yb = ya + fl * FLOOR;
        walls(fKey, R, ya, yb, { vBase: yG });
        if (i < tiers - 1) {
          B.roof('roof', R.x, R.z, ax, az, R.w, R.d, yb + 0.02);
          // parapet along the terrace's street edge
          const ea = R.x + nx * (R.d / 2 - 0.15);
          const ez = R.z + nz * (R.d / 2 - 0.15);
          B.box(cKey, ea, ez, ax, az, R.w, 0.3, yb, yb + 1.1, dark);
        }
        ya = yb;
      }
      top = ya;
      const R = rect(0, 0, 0, Math.min(d * 0.55, (tiers - 1) * 3.6));
      band(R, top, top + 1.0);
      this._roofProps(R.x, R.z, ax, az, nx, nz, R.w, R.d, top + 1.0, col, false);
      this._signsAndMurals(T, cx, cz, nx, nz, w, d, floors, top + 1.0, yG);
      return;
    } else {
      walls(gKey, full, y0, yG, gOpts);
      walls(fKey, full, yG, top, fOpts);
      band(full, yG - 0.3, yG + 0.15, 0.16);
    }

    if (form === 'core') {
      // one or two ribbed concrete stair towers breaking the roofline
      const cw = 4.4 + rnd() * 1.6;
      const twin = w > 30 && rnd() < 0.5;
      for (const side of twin ? [-1, 1] : [rnd() < 0.5 ? -1 : 1]) {
        const a = side * (w / 2 - cw / 2 + 0.3);
        const cTop = top + 3.5 + rnd() * 5;
        B.box(cKey, cx + ax * a, cz + az * a, ax, az, cw, d + 0.6, y0, cTop, col);
        B.box(cKey, cx + ax * a, cz + az * a, ax, az, cw + 0.5, d + 1.1, cTop, cTop + 0.6, dark);
      }
    }

    if (T.sawtooth) {
      band(full, top, top + 0.6, 0.4);
      this._sawtooth(cx, cz, ax, az, nx, nz, w, d, top + 0.6);
    } else {
      band(full, top, top + 1.1, 0.4);
      this._roofProps(cx, cz, ax, az, nx, nz, w, d, top + 1.1, col, floors >= 12);
    }
    this._signsAndMurals(T, cx, cz, nx, nz, w, d, floors, top + (T.sawtooth ? 0.6 : 1.1), yG);
  }

  _signsAndMurals(T, cx, cz, nx, nz, w, d, floors, roofY, yG) {
    const rnd = this.rng;
    // neon sign on the roof edge facing the street
    const signChance = T.sign ? 0.9 : this.theme.neon * (floors <= 9 ? 1 : 0.5);
    if (rnd() < signChance) {
      const sw = Math.min(w * 0.85, 8 + rnd() * 14);
      this._sign(cx + nx * (d / 2 - 0.6), cz + nz * (d / 2 - 0.6), nx, nz, sw, roofY);
    }
    // painted mural on tall fronts
    if (floors >= 7 && rnd() < 0.3 && w > 14) {
      const pw = Math.min(w * 0.6, 18);
      this._poster(cx + nx * (d / 2 + 0.06), cz + nz * (d / 2 + 0.06), nx, nz, pw, yG + FLOOR * 2, yG + FLOOR * 2 + pw * 0.5);
    }
  }

  _sawtooth(cx, cz, ax, az, nx, nz, w, d, y) {
    const B = this.batch;
    const teeth = Math.max(2, Math.round(w / 7));
    const tw = w / teeth;
    const h = 3.2;
    const glass = new THREE.Color(0.55, 0.62, 0.7);
    for (let i = 0; i < teeth; i++) {
      const a0 = -w / 2 + i * tw;
      const a1 = a0 + tw;
      const P = (a, n, yy) => new THREE.Vector3(cx + ax * a + nx * n, yy, cz + az * a + nz * n);
      // sloped roof from (a0, y + h) down to (a1, y)
      const p0 = P(a0, d / 2, y + h);
      const p1 = P(a0, -d / 2, y + h);
      const p2 = P(a1, -d / 2, y);
      const p3 = P(a1, d / 2, y);
      const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      if (n.y > 0) B.quad('roof', p0, p1, p2, p3, [0, 0, d / 8, tw / 8], WHITE);
      else B.quad('roof', p0, p3, p2, p1, [0, 0, tw / 8, d / 8], WHITE);
      // vertical glazed face at a0
      const q0 = P(a0, d / 2, y);
      const q1 = P(a0, -d / 2, y);
      const q2 = P(a0, -d / 2, y + h);
      const q3 = P(a0, d / 2, y + h);
      const m = new THREE.Vector3().subVectors(q1, q0).cross(new THREE.Vector3().subVectors(q2, q0));
      const out = m.x * -ax + m.z * -az > 0;
      if (out) B.quad('glass', q0, q1, q2, q3, [0, 0, 1, 1], glass);
      else B.quad('glass', q1, q0, q3, q2, [0, 0, 1, 1], glass);
      // triangle gables front/back
      for (const sn of [1, -1]) {
        const g0 = P(a0, (sn * d) / 2, y);
        const g1 = P(a1, (sn * d) / 2, y);
        const g2 = P(a0, (sn * d) / 2, y + h);
        const tn = new THREE.Vector3().subVectors(g1, g0).cross(new THREE.Vector3().subVectors(g2, g0));
        if (tn.x * nx * sn + tn.z * nz * sn > 0) B.tri('trim', g0, g1, g2, [0, 0], [1, 0], [0, 1], WHITE);
        else B.tri('trim', g0, g2, g1, [0, 0], [0, 1], [1, 0], WHITE);
      }
    }
    if (this.theme.chimneys && this.rng() < 0.35) {
      const ch = new THREE.Color(0.75, 0.3, 0.25);
      const hgt = 18 + this.rng() * 22;
      B.box('trim', cx - nx * d * 0.3, cz - nz * d * 0.3, ax, az, 2.6, 2.6, y, y + hgt, ch);
      B.box('trim', cx - nx * d * 0.3, cz - nz * d * 0.3, ax, az, 3.0, 3.0, y + hgt - 2, y + hgt - 1.2, new THREE.Color(0.9, 0.88, 0.82));
    }
  }

  _roofProps(cx, cz, ax, az, nx, nz, w, d, y, col, tall) {
    const B = this.batch;
    const rnd = this.rng;
    const grey = new THREE.Color(0.62, 0.6, 0.58);
    // lift-machine room
    if (rnd() < 0.8) {
      const bw = 3 + rnd() * 3;
      const bd = 3 + rnd() * 2;
      const a = (rnd() - 0.5) * (w - bw - 2);
      const b = -(rnd() * 0.4) * (d - bd);
      B.box('trim', cx + ax * a + nx * b, cz + az * a + nz * b, ax, az, bw, bd, y, y + 2.6, grey);
    }
    // TV antennas
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = (rnd() - 0.5) * (w - 2);
      const b = (rnd() - 0.5) * (d - 2);
      const px = cx + ax * a + nx * b;
      const pz = cz + az * a + nz * b;
      const h = 2.5 + rnd() * 2.5;
      B.box('trim', px, pz, ax, az, 0.12, 0.12, y, y + h, new THREE.Color(0.25, 0.25, 0.25));
      B.box('trim', px, pz, ax, az, 1.6, 0.08, y + h - 0.6, y + h - 0.5, new THREE.Color(0.25, 0.25, 0.25));
    }
    // red aircraft-warning box on towers
    if (tall) B.box('beacon', cx, cz, ax, az, 0.6, 0.6, y + 0.1, y + 0.7, WHITE);
  }

  // neon sign on posts, its back to the building, facing the street
  _sign(px, pz, nx, nz, w, y) {
    const k = Math.floor(this.rng() * NEON_TEXTS.length);
    const h = Math.min(3.2, w * 0.2);
    this.signs.push({ x: px, z: pz, nx, nz, w, y0: y + 0.8, y1: y + 0.8 + h, k });
    const ax = -nz;
    const az = nx;
    const dark = new THREE.Color(0.2, 0.2, 0.22);
    for (const sa of [-0.4, 0.4]) this.batch.box('trim', px + ax * w * sa - nx * 0.25, pz + az * w * sa - nz * 0.25, ax, az, 0.15, 0.15, y, y + 0.8 + h, dark);
  }

  _poster(px, pz, nx, nz, w, y0, y1) {
    this.posters.push({ x: px, z: pz, nx, nz, w, y0, y1, k: Math.floor(this.rng() * SLOGANS.length) });
  }

  // ------------------------------------------------------------------------------
  // Tunnels: a building block the road dives through, with arched portals.
  _tunnels() {
    const t = this.track;
    const B = this.batch;
    const rnd = this.rng;
    const N = t.count;
    const ranges = [];
    let start = -1;
    for (let i = 0; i < N; i++) {
      const on = (t.tags[i] & TAG.TUNNEL) !== 0;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        ranges.push([start, i - 1]);
        start = -1;
      }
    }
    if (start >= 0) ranges.push([start, N - 1]);
    const R = HW + 1.2;
    const archTop = WH + R * 0.7;
    for (const [a, b] of ranges) {
      if ((b - a) * t.ds < 12) continue;
      const style = ['waffle', 'panel', 'ribbon', 'fins'][Math.floor(rnd() * 4)];
      const v = this.variant % 3;
      const P = null; // brutalist concrete, not a photo
      const fKey = `bfac_${style}_${v}`;
      const uRep = P ? P.w : 4 * BAY;
      const vRep = P ? P.h : 4 * FLOOR;
      const vb = P ? GY : GY + GROUND;
      const col = tint(CONCRETE[Math.floor(rnd() * CONCRETE.length)], rnd, 0.03);
      const X = HULL + 4 + 14; // half width of the block
      const floors = 3 + Math.floor(rnd() * 4);
      const step = 4;
      // walk the range, building segments: roof slab + outer side walls + underside
      const pts = [];
      for (let i = a; i <= b; i += step) pts.push(i);
      if (pts[pts.length - 1] !== b) pts.push(b);
      const frames = pts.map((i) => this.flat(i * t.ds));
      const topOf = (F) => F.y + archTop + 1.2 + floors * FLOOR;
      let uAcc = 0;
      for (let k = 0; k < frames.length - 1; k++) {
        const F0 = frames[k];
        const F1 = frames[k + 1];
        const segLen = Math.hypot(F1.x - F0.x, F1.z - F0.z);
        const P = (F, x, y) => new THREE.Vector3(F.x + F.rx * x, y, F.z + F.rz * x);
        const t0 = topOf(F0);
        const t1 = topOf(F1);
        const u0 = uAcc / uRep;
        const u1 = (uAcc + segLen) / uRep;
        for (const sd of [1, -1]) {
          // outer side wall from the ground to the roof
          const p0 = P(F0, sd * X, GY);
          const p1 = P(F1, sd * X, GY);
          const p2 = P(F1, sd * X, t1);
          const p3 = P(F0, sd * X, t0);
          if (sd > 0) B.quad(fKey, p0, p1, p2, p3, [u0, (GY - vb) / vRep, u1, (t1 - vb) / vRep], col);
          else B.quad(fKey, p1, p0, p3, p2, [u1, (GY - vb) / vRep, u0, (t1 - vb) / vRep], col);
          // inner wall between the hull and the outer edge, under the slab (dark passage side)
          const q0 = P(F0, sd * R, F0.y + archTop + 1.2);
          const q1 = P(F1, sd * R, F1.y + archTop + 1.2);
          const q2 = P(F1, sd * R, GY);
          const q3 = P(F0, sd * R, GY);
          if (sd > 0) B.quad('trim', q0, q1, q2, q3, [0, 0, 1, 1], new THREE.Color(0.45, 0.43, 0.42));
          else B.quad('trim', q1, q0, q3, q2, [0, 0, 1, 1], new THREE.Color(0.45, 0.43, 0.42));
        }
        // roof
        const r0 = P(F0, -X, t0);
        const r1 = P(F1, -X, t1);
        const r2 = P(F1, X, t1);
        const r3 = P(F0, X, t0);
        const nrm = new THREE.Vector3().subVectors(r1, r0).cross(new THREE.Vector3().subVectors(r2, r0));
        if (nrm.y > 0) B.quad('roof', r0, r1, r2, r3, [0, u0 * 3, 4, u1 * 3], WHITE);
        else B.quad('roof', r0, r3, r2, r1, [0, u0 * 3, 4, u1 * 3], WHITE);
        // fill between the outer walls and the inner walls at the top (solid mass sides)
        uAcc += segLen;
      }
      // portal façades at both ends (arched hole for the road)
      for (const [F, dir] of [[frames[0], 1], [frames[frames.length - 1], -1]]) {
        const top = topOf(F) - F.y;
        const shape = new THREE.Shape();
        const gyRel = GY - F.y;
        shape.moveTo(-X, gyRel);
        shape.lineTo(X, gyRel);
        shape.lineTo(X, top);
        shape.lineTo(-X, top);
        shape.lineTo(-X, gyRel);
        const hole = new THREE.Path();
        hole.moveTo(-R, gyRel);
        hole.lineTo(-R, WH);
        for (let k = 0; k <= 16; k++) {
          const ang = Math.PI - (k / 16) * Math.PI;
          hole.lineTo(Math.cos(ang) * R, WH + Math.sin(ang) * R * 0.7);
        }
        hole.lineTo(R, gyRel);
        hole.lineTo(-R, gyRel);
        shape.holes.push(hole);
        const geo = new THREE.ShapeGeometry(shape, 4);
        const pos = geo.attributes.position;
        const idx = geo.index.array;
        // shape lies in (x = lateral, y = height); face outward along -dir * fwd
        const outX = -dir * F.fx;
        const outZ = -dir * F.fz;
        const P3 = (i) => {
          const lx = pos.getX(i) * (dir > 0 ? -1 : 1);
          const ly = pos.getY(i);
          return new THREE.Vector3(F.x + F.rx * lx, F.y + ly, F.z + F.rz * lx);
        };
        for (let k = 0; k < idx.length; k += 3) {
          const A = P3(idx[k]);
          const Bv = P3(idx[k + 1]);
          const C = P3(idx[k + 2]);
          const uvOf = (p, i) => [pos.getX(i) / uRep, (p.y - vb) / vRep];
          const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(C, A));
          const ua = uvOf(A, idx[k]);
          const ub = uvOf(Bv, idx[k + 1]);
          const uc = uvOf(C, idx[k + 2]);
          if (n.x * outX + n.z * outZ > 0) B.tri(fKey, A, Bv, C, ua, ub, uc, col);
          else B.tri(fKey, A, C, Bv, ua, uc, ub, col);
        }
        // a slogan banner over the arch
        const bw = Math.min(26, 2 * R + 4);
        const ox = F.x + outX * 0.08;
        const oz = F.z + outZ * 0.08;
        this._poster(ox, oz, outX, outZ, bw, F.y + archTop + 1.5, F.y + archTop + 1.5 + bw * 0.22);
        // neon on the roof of the gateway
        if (rnd() < 0.8) this._sign(F.x - outX * 3, F.z - outZ * 3, outX, outZ, 16, topOf(F));
        geo.dispose();
      }
      // reserve the footprint
      for (const F of frames) this.occ.mark(F.x, F.z, F.fx, F.fz, 6, 2 * X + 2);
      this.blocked.push([a * t.ds - 6, b * t.ds + 6]);
    }
  }

  // ------------------------------------------------------------------------------
  // footbridges spanning the road, with a slogan banner on each face
  _footbridges() {
    const t = this.track;
    const rnd = this.rng;
    const B = this.batch;
    const L = t.length;
    const deckY = WH + 6.2;
    const span = HULL + 5.5;
    let s = 260 + rnd() * 200;
    while (s < L - 120) {
      let ok = true;
      for (let q = -24; q <= 24; q += 4) {
        const tags = t.tagsAt(s + q);
        if (tags & (TAG.TUNNEL | TAG.MAGNET | TAG.GAP | TAG.BRIDGE | TAG.STANDS | TAG.START | TAG.RINGS)) ok = false;
        if (Math.abs(t.kappaAt(s + q)) > 0.004) ok = false;
      }
      const F = this.flat(s);
      if (!ok || F.upY < 0.985 || this._isBlocked(s - 10, s + 10)) {
        s += 30;
        continue;
      }
      const grey = new THREE.Color(0.78, 0.76, 0.72);
      const red = new THREE.Color(0.8, 0.16, 0.14);
      const y = F.y;
      // deck
      B.box('trim', F.x, F.z, F.rx, F.rz, 2 * span + 3, 3, y + deckY, y + deckY + 1.0, grey);
      // railings
      for (const sn of [-1, 1]) B.box('trim', F.x + F.fx * sn * 1.4, F.z + F.fz * sn * 1.4, F.rx, F.rz, 2 * span + 3, 0.12, y + deckY + 1.0, y + deckY + 2.1, red);
      // stair towers
      for (const sd of [-1, 1]) {
        const px = F.x + F.rx * sd * span;
        const pz = F.z + F.rz * sd * span;
        B.box('trim', px, pz, F.rx, F.rz, 3.2, 4.2, GY, y + deckY + 1.0, grey);
        this.occ.mark(px, pz, F.rx, F.rz, 4, 6);
      }
      // banners both faces
      const bw = 2 * HW - 2;
      for (const sn of [-1, 1]) {
        this._poster(F.x + F.fx * sn * 1.56, F.z + F.fz * sn * 1.56, F.fx * sn, F.fz * sn, bw, y + deckY - 2.6, y + deckY + 0.9);
      }
      this.blocked.push([s - 6, s + 6]);
      s += 380 + rnd() * 320;
    }
  }

  // ------------------------------------------------------------------------------
  // pavements on both sides of the track at ground level
  _pavements() {
    const t = this.track;
    const B = this.batch;
    const step = 3;
    const w = 6.5;
    const y = GY + 0.3;
    const green = this.theme.trees;
    const hasVerge = !!photoTexture('grassWalk');
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = 0; s <= t.length + 0.01; s += step) {
        const F = this.flat(Math.min(s, t.length - 0.001));
        const ok = F.upY > 0.7 && !(t.tagsAt(s) & (TAG.MAGNET | TAG.LOOP));
        const cur = ok ? {
          a: new THREE.Vector3(F.x + F.rx * side * HULL, y, F.z + F.rz * side * HULL),
          b: new THREE.Vector3(F.x + F.rx * side * (HULL + w), y, F.z + F.rz * side * (HULL + w)),
          v: s / 4,
        } : null;
        if (prev && cur) {
          const quadPts = side > 0 ? [prev.a, prev.b, cur.b, cur.a] : [prev.b, prev.a, cur.a, cur.b];
          const n = new THREE.Vector3().subVectors(quadPts[1], quadPts[0]).cross(new THREE.Vector3().subVectors(quadPts[2], quadPts[0]));
          const [p0, p1, p2, p3] = n.y > 0 ? quadPts : [quadPts[1], quadPts[0], quadPts[3], quadPts[2]];
          // stretches of pavement with a grass verge on the building side
          // (smooth in s so they come in runs of a few tens of metres)
          const gv = Math.sin(s * 0.021 + side * 1.7) * 0.6 + Math.sin(s * 0.0063 + side * 4.1) * 0.4;
          const roadFirst = p0 === prev.a || p0 === cur.a;
          if (hasVerge && gv > 0.75 - green && F.y < 3) {
            const [vs, ve] = [(s - step) / PHOTO.grassWalk.size[1], s / PHOTO.grassWalk.size[1]];
            B.quad('paveg', p0, p1, p2, p3, roadFirst ? [0, vs, 1, ve] : [1, vs, 0, ve], WHITE);
          } else {
            const S = PHOTO.sidewalk.size[0];
            B.quad('pave', p0, p1, p2, p3, [0, (s - step) / S, w / S, s / S], WHITE);
          }
          // kerb face at the outer edge
        }
        prev = cur;
      }
    }
  }

  // lamps, flags, trees along the pavement edge
  _furniture() {
    const t = this.track;
    const rnd = this.rng;
    for (const side of [-1, 1]) {
      let k = 0;
      for (let s = rnd() * 10; s < t.length; s += 26) {
        const tags = t.tagsAt(s);
        if (tags & (TAG.MAGNET | TAG.LOOP | TAG.TUNNEL | TAG.STANDS)) continue;
        const F = this.flat(s);
        if (F.upY < 0.9) continue;
        const x = F.x + F.rx * side * (HULL + 1.0);
        const z = F.z + F.rz * side * (HULL + 1.0);
        if (this.hash.dist(x, z, HULL + 0.5) < HULL + 0.4) continue;
        const top = Math.max(GY + 9, F.y + WH + 6);
        this.lamps.push({ x, z, dx: -F.rx * side, dz: -F.rz * side, h: top - GY, fx: F.fx, fz: F.fz });
        if (k % 2 === 1 && rnd() < this.theme.flags) this.flags.push({ x, z, fx: F.fx, fz: F.fz, y: top - 4.2, red: (k >> 1) % 2 });
        // trees halfway between lamps
        if (rnd() < this.theme.trees && F.y < 2) {
          const s2 = s + 13;
          const G = this.flat(s2);
          const tx = G.x + G.rx * side * (HULL + 4.2);
          const tz = G.z + G.rz * side * (HULL + 4.2);
          if (this.hash.dist(tx, tz, HULL + 3.6) > HULL + 3.2 && this.occ.free(tx, tz, 1, 0, 2.5, 2.5)) this.trees.push({ x: tx, z: tz, s: 0.85 + rnd() * 0.3 });
        }
        k++;
      }
    }
  }

  // ------------------------------------------------------------------------------
  _buildMeshes() {
    const T = this.time;
    const cache = new Map();
    const roof = roofTexture();
    const pave = pavementTexture();
    const material = (key) => {
      if (cache.has(key)) return cache.get(key);
      let m;
      const [kind, style, v] = key.split('_');
      if (kind === 'bfac' || kind === 'bgnd') {
        const tx = kind === 'bfac' ? brutalFacade(style, +v + 1) : brutalGround(style, +v + 1);
        m = new THREE.MeshLambertMaterial({ map: tx.map, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: T.windows * (kind === 'bgnd' ? 1.25 : 1), vertexColors: true });
      } else if (kind === 'fac' || kind === 'gnd') {
        const tx = kind === 'fac' ? facadeTexture(style, +v + 1) : groundFloorTexture(style, +v + 1);
        m = new THREE.MeshLambertMaterial({ map: tx.map, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: T.windows * (kind === 'gnd' ? 1.25 : 1), vertexColors: true });
      } else if (key === 'roof') m = new THREE.MeshLambertMaterial({ map: roof, vertexColors: true });
      else if (key === 'pave') m = new THREE.MeshLambertMaterial({ map: photoTexture('sidewalk') || pave, vertexColors: true, color: photoTexture('sidewalk') ? 0xd8d8d8 : 0xffffff });
      else if (key === 'paveg') m = new THREE.MeshLambertMaterial({ map: photoTexture('grassWalk'), vertexColors: true });
      else if (kind === 'fence') m = new THREE.MeshLambertMaterial({ map: photoTexture(style), vertexColors: true, side: THREE.DoubleSide });
      else if (key === 'glass') m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: new THREE.Color(0.9, 1.0, 0.85), emissiveIntensity: T.windows * 0.25 });
      else if (key === 'beacon') m = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1), toneMapped: false });
      else m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      cache.set(key, m);
      return m;
    };
    for (const m of this.batch.build(material)) {
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.beaconMat = cache.get('beacon') || null;
    this._signMeshes();
    this._posterMeshes();
    this._lampMeshes();
    this._treeMeshes();
    this._flagMeshes();
    this._assetMeshes();
  }

  // hand-made buildings, instanced per model part
  _assetMeshes() {
    if (!ASSETS || !this.assetPlacements.length) return;
    const by = new Map();
    for (const p of this.assetPlacements) {
      if (!by.has(p.id)) by.set(p.id, []);
      by.get(p.id).push(placeMatrix(p.x, GY, p.z, p.yaw));
    }
    for (const [id, list] of by) {
      for (const m of instanceAsset(ASSETS.buildings[id], list)) {
        if (m.material.userData.windows) m.material.emissiveIntensity = this.time.windows * (id === 'kiosk' ? 1.4 : 0.9);
        this.group.add(m);
      }
    }
  }

  // camera-facing quads batched with a texture atlas
  _atlasQuads(list, atlas, mat) {
    if (!list.length) return null;
    const pos = [];
    const uv = [];
    const nrm = [];
    for (const q of list) {
      const rx = q.nz;
      const rz = -q.nx;
      const [u0, v0, u1, v1] = atlas.rect(q.k % atlas.count);
      const a = [q.x - rx * q.w / 2, q.y0, q.z - rz * q.w / 2];
      const b = [q.x + rx * q.w / 2, q.y0, q.z + rz * q.w / 2];
      const c = [b[0], q.y1, b[2]];
      const d = [a[0], q.y1, a[2]];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      for (let i = 0; i < 6; i++) nrm.push(q.nx, 0, q.nz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const mesh = new THREE.Mesh(g, mat);
    this.group.add(mesh);
    return mesh;
  }

  _signMeshes() {
    const atlas = stripAtlas(NEON_TEXTS, {
      w: 256,
      h: 48,
      draw: (g, [text, col], w, h) => {
        g.fillStyle = 'rgba(10,8,12,0.9)';
        g.fillRect(2, 4, w - 4, h - 8);
        g.strokeStyle = col;
        g.lineWidth = 2;
        g.strokeRect(5, 7, w - 10, h - 14);
        let size = 30;
        g.font = `bold ${size}px "Arial Narrow", "Roboto Condensed", sans-serif`;
        while (g.measureText(text).width > w - 24 && size > 10) {
          size -= 2;
          g.font = `bold ${size}px "Arial Narrow", "Roboto Condensed", sans-serif`;
        }
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = col;
        g.shadowBlur = 6;
        g.fillStyle = col;
        g.fillText(text, w / 2, h / 2 + 1);
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.fillText(text, w / 2, h / 2 + 1);
      },
    });
    const k = this.time.neon;
    this.signMat = new THREE.MeshBasicMaterial({ map: atlas.texture, toneMapped: false, color: new THREE.Color(k * 1.6, k * 1.6, k * 1.6), side: THREE.DoubleSide });
    this._atlasQuads(this.signs, atlas, this.signMat);
    this.signBase = k * 1.6;
  }

  _posterMeshes() {
    const atlas = stripAtlas(SLOGANS, {
      w: 256,
      h: 64,
      draw: (g, lines, w, h) => {
        const i = SLOGANS.indexOf(lines);
        const [bg, fg, acc] = POSTER_PAL[i % POSTER_PAL.length];
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.fillStyle = acc;
        g.beginPath();
        g.moveTo(0, h); g.lineTo(90, 0); g.lineTo(130, 0); g.lineTo(40, h);
        g.fill();
        g.beginPath();
        g.arc(222, 18, 12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = fg;
        g.textBaseline = 'alphabetic';
        lines.forEach((line, j) => {
          let size = j === 0 ? 26 : 15;
          g.font = `bold ${size}px "Arial Narrow", Impact, sans-serif`;
          while (g.measureText(line).width > w - 30 && size > 8) {
            size -= 1;
            g.font = `bold ${size}px "Arial Narrow", Impact, sans-serif`;
          }
          g.fillText(line, 14, 30 + j * 22);
        });
        g.strokeStyle = fg;
        g.lineWidth = 3;
        g.strokeRect(3, 3, w - 6, h - 6);
      },
    });
    this.posterMat = new THREE.MeshLambertMaterial({ map: atlas.texture, emissiveMap: atlas.texture, emissive: 0xffffff, emissiveIntensity: 0.15 + this.time.lamps * 0.35, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    this._atlasQuads(this.posters, atlas, this.posterMat);
  }

  _lampMeshes() {
    if (!this.lamps.length) return;
    const T = this.time;
    // pole + arm (unit height pole scaled per instance would also scale the arm, so build per-height buckets)
    const pole = new THREE.BoxGeometry(0.22, 1, 0.22);
    pole.translate(0, 0.5, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x5a5c60 });
    const poles = new THREE.InstancedMesh(pole, poleMat, this.lamps.length);
    const arm = new THREE.BoxGeometry(0.14, 0.14, 2.6);
    arm.translate(0, 0, 1.3);
    const head = new THREE.BoxGeometry(0.5, 0.22, 1.0);
    head.translate(0, -0.15, 2.5);
    const armGeo = mergeGeometries([arm]);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, this.lamps.length);
    const lit = T.lamps > 0.1;
    const headMat = new THREE.MeshBasicMaterial({ color: lit ? new THREE.Color(3.2, 1.9, 0.8).multiplyScalar(T.lamps) : new THREE.Color(0.75, 0.74, 0.7), toneMapped: !lit });
    const heads = new THREE.InstancedMesh(head, headMat, this.lamps.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const glowPos = [];
    this.lamps.forEach((l, i) => {
      q.setFromAxisAngle(yAxis, Math.atan2(l.dx, l.dz));
      m.compose(new THREE.Vector3(l.x, GY, l.z), q, new THREE.Vector3(1, l.h, 1));
      poles.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(l.x, GY + l.h, l.z), q, new THREE.Vector3(1, 1, 1));
      arms.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      glowPos.push(l.x + l.dx * 2.5, GY + l.h - 0.4, l.z + l.dz * 2.5);
    });
    this.group.add(poles, arms, heads);
    if (lit) {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 32, 32);
      const tex = new THREE.CanvasTexture(c);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size: 7, sizeAttenuation: true, color: new THREE.Color(1.6, 0.9, 0.4).multiplyScalar(T.lamps * 0.7), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
      this.group.add(pts);
      // light pools on the pavement
      const pool = new THREE.PlaneGeometry(9, 9);
      pool.rotateX(-Math.PI / 2);
      const poolMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.5, 0.3, 0.12).multiplyScalar(T.lamps), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 });
      const pools = new THREE.InstancedMesh(pool, poolMat, this.lamps.length);
      this.lamps.forEach((l, i) => pools.setMatrixAt(i, m.makeTranslation(l.x + l.dx * 1.5, GY + 0.34, l.z + l.dz * 1.5)));
      this.group.add(pools);
    }
  }

  _treeMeshes() {
    if (!this.trees.length) return;
    if (ASSETS && Object.keys(ASSETS.trees).length) {
      // pavement trees: the slimmer species; side streets: any
      const slim = ['tree02', 'tree03', 'tree05', 'tree06', 'tree07'].filter((id) => ASSETS.trees[id]);
      const all = Object.keys(ASSETS.trees);
      const by = new Map();
      const grassIds = Object.keys(ASSETS.grass);
      const gBy = new Map();
      const add = (map, id, m) => {
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(m);
      };
      this.trees.forEach((t, i) => {
        const pool = t.big ? all : slim.length ? slim : all;
        const h = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233)) * 43758.5453;
        const id = pool[Math.floor((h - Math.floor(h)) * pool.length)];
        add(by, id, placeMatrix(t.x, GY + (t.big ? 0 : 0.3), t.z, (t.x * 0.37) % (Math.PI * 2), t.s));
        // grass tufts around the trunk
        for (let k = 0; k < 3 && grassIds.length; k++) {
          const a = i * 2.4 + k * 2.1;
          const r = 0.6 + (k % 2) * 0.7;
          add(gBy, grassIds[(i + k) % grassIds.length], placeMatrix(t.x + Math.cos(a) * r, GY + (t.big ? 0 : 0.3), t.z + Math.sin(a) * r, a, 0.8 + (k % 3) * 0.25));
        }
      });
      for (const [id, list] of by) for (const m of instanceAsset(ASSETS.trees[id], list)) this.group.add(m);
      for (const [id, list] of gBy) for (const m of instanceAsset(ASSETS.grass[id], list)) this.group.add(m);
      return;
    }
    const trunk = new THREE.CylinderGeometry(0.18, 0.25, 3, 5);
    trunk.translate(0, 1.5, 0);
    const crown = new THREE.IcosahedronGeometry(2.4, 0);
    crown.translate(0, 4.6, 0);
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5a4030 }), this.trees.length);
    const crowns = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0x4e8a3a, flatShading: true }), this.trees.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    this.trees.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.x * 0.37);
      m.compose(new THREE.Vector3(t.x, GY, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, c.setHSL(0.24 + (i % 5) * 0.015, 0.45, 0.32 + (i % 3) * 0.04));
    });
    this.group.add(trunks, crowns);
  }

  _flagMeshes() {
    if (!this.flags.length) return;
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#f2eee6';
    g.fillRect(0, 0, 8, 8);
    g.fillStyle = '#d0202a';
    g.fillRect(0, 8, 8, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const c2 = document.createElement('canvas');
    c2.width = 8;
    c2.height = 16;
    const g2 = c2.getContext('2d');
    g2.fillStyle = '#d0202a';
    g2.fillRect(0, 0, 8, 16);
    g2.fillStyle = '#ffd23a';
    g2.fillRect(2, 2, 4, 3);
    const tex2 = new THREE.CanvasTexture(c2);
    tex2.colorSpace = THREE.SRGBColorSpace;
    tex2.magFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(1.1, 2.6);
    geo.translate(0.65, 0, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const [red, t] of [[0, tex], [1, tex2]]) {
      const list = this.flags.filter((f) => f.red === red);
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }), list.length);
      list.forEach((f, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.fx, f.fz) - Math.PI / 2);
        m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(i, m);
      });
      this.group.add(inst);
    }
  }

  update(time) {
    if (this.beaconMat) this.beaconMat.color.setRGB(Math.sin(time * 3) > 0.2 ? 3 : 0.2, 0.05, 0.03);
    if (this.signMat) {
      // the odd failing tube
      const f = Math.sin(time * 17) + Math.sin(time * 5.3) > 1.6 ? 0.6 : 1;
      this.signMat.color.setScalar(this.signBase * f);
    }
  }
}
