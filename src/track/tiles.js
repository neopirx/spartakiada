// Track tile library.
//
// Every tile is described in its own local frame:
//   origin = entry point on the track centerline
//   +Z     = entry direction (forward)
//   +X     = left, +Y = up
// A tile occupies 1 or 2 grid cells of size CELL and always exits on a cell
// edge, heading straight on (+Z) or turned 90° left/right. Because of that
// any sequence of tiles that walks a closed loop on the grid forms a closed
// circuit – that is what the generator relies on.
//
// A tile instance exposes:
//   pos(u, out)   centerline position for u in [0,1]
//   up(u, out)    optional "base up" override (loops). Returns false if unused.
//   roll(u)       roll around the forward axis in radians (banking / barrel roll)
//   tags(u)       bitmask of TAG flags at u
//   boosts        [{ f, x }] booster pads, f = fraction of tile length, x = lateral (+ = right)
//   cells, turn   footprint information (turn: 0 straight, +1 left, -1 right)
//   dy            elevation change entry->exit

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const C = CONFIG.track.cell;

export const TAG = {
  TUNNEL: 1,
  MAGNET: 2,    // magnetic strip: gravity ignored (loops, rolls, wall rides)
  LOOP: 4,
  START: 8,
  BANK: 16,
  GAP: 32,      // no road surface – the craft flies over (jump)
  BRIDGE: 64,   // decorative suspension arches
  RINGS: 128,   // decorative neon rings around the track
  STANDS: 256,  // grandstands along both sides
  AIR: 512,     // airborne section of a jump (extra float)
};

const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const seg = (u, a, b) => clamp01((u - a) / (b - a));

function base(id, extra) {
  return {
    id,
    cells: 1,
    turn: 0,
    dy: 0,
    boosts: [],
    props: [],
    up: () => false,
    roll: () => 0,
    tags: () => 0,
    ...extra,
  };
}

// Vertical profile helper: elevation change that eases in and out.
function rampProfile(dy) {
  return (u) => dy * smoother(u);
}

// Track that rolls around an axis `radius` above the road; phi(u) = roll angle.
// Used by barrel rolls, wall rides and inverted twists.
function rolling(id, phi, radius, tagFn, extra = {}) {
  return base(id, {
    pos: (u, o) => {
      const p = phi(u);
      return o.set(radius * Math.sin(p), radius * (1 - Math.cos(p)), u * C);
    },
    roll: (u) => phi(u),
    tags: tagFn,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Straight family
// ---------------------------------------------------------------------------

export function straight({ dy = 0, boosts = [], tunnel = false, start = false, deco = 0 } = {}) {
  const yOf = rampProfile(dy);
  const id = start ? 'start' : tunnel ? 'tunnel' : dy ? (dy > 0 ? 'rampUp' : 'rampDown') : 'straight';
  return base(id, {
    dy,
    boosts,
    pos: (u, o) => o.set(0, yOf(u), u * C),
    tags: () => (tunnel ? TAG.TUNNEL : 0) | (start ? TAG.START | TAG.STANDS : 0) | deco,
    props: start ? [{ type: 'startGantry', f: 0.6 }] : [],
  });
}

export function hill({ height = 10 } = {}) {
  return base('hill', {
    pos: (u, o) => o.set(0, height * 0.5 * (1 - Math.cos(2 * Math.PI * u)), u * C),
  });
}

// Dip below the current level and back (only used on elevated sections).
export function valley({ depth = 9 } = {}) {
  return base('valley', {
    pos: (u, o) => o.set(0, -depth * 0.5 * (1 - Math.cos(2 * Math.PI * u)), u * C),
  });
}

export function wave({ amp = 3.2, bumps = 3 } = {}) {
  return base('wave', {
    pos: (u, o) => o.set(0, amp * Math.sin(bumps * Math.PI * u) ** 2, u * C),
  });
}

// Lateral S-bend that returns to the centerline. periods=2 -> double chicane.
export function chicane({ amp = 11, dir = 1, boosts = [], periods = 1 } = {}) {
  // sin(2πnu)·sin²(πu) peaks at ~0.65 (n=1) / ~0.8 (n=2)
  const k = (amp / (periods === 1 ? 0.65 : 0.8)) * dir;
  return base(periods === 1 ? 'chicane' : 'doubleChicane', {
    boosts,
    pos: (u, o) => o.set(k * Math.sin(2 * Math.PI * periods * u) * Math.sin(Math.PI * u) ** 2, 0, u * C),
  });
}

// 360° barrel roll around an axis above the track.
export function barrelRoll({ radius = 12, dir = 1 } = {}) {
  const phi = (u) => dir * 2 * Math.PI * smoother(seg(u, 0.1, 0.9));
  return rolling('barrelRoll', phi, radius, (u) => (u > 0.08 && u < 0.92 ? TAG.MAGNET : 0));
}

// Roll onto the "wall" (up to ~70°) and back down.
export function wallRide({ angle = 1.2, dir = 1, radius = 16 } = {}) {
  const phi = (u) => dir * angle * Math.sin(Math.PI * smooth(seg(u, 0.05, 0.95))) ** 2;
  return rolling('wallRide', phi, radius, (u) => (u > 0.1 && u < 0.9 ? TAG.MAGNET : 0));
}

// Half roll, drive upside down, half roll on through 360°.
export function twist({ radius = 12, dir = 1 } = {}) {
  const phi = (u) => dir * Math.PI * (smoother(seg(u, 0.06, 0.34)) + smoother(seg(u, 0.66, 0.94)));
  return rolling('twist', phi, radius, (u) => (u > 0.05 && u < 0.95 ? TAG.MAGNET : 0));
}

// Kicker – gap – landing. The craft follows the arc over the gap.
export function jump({ height = 11, gapFrom = 0.36, gapTo = 0.66, boosts = [{ f: 0.12, x: 0 }] } = {}) {
  return base('jump', {
    boosts,
    pos: (u, o) => o.set(0, height * Math.sin(Math.PI * u) ** 2, u * C),
    tags: (u) => (u > gapFrom && u < gapTo ? TAG.GAP : 0) | (u > gapFrom - 0.06 && u < gapTo + 0.04 ? TAG.AIR : 0),
  });
}

// Vertical loop with a sideways offset so entry and exit don't collide,
// followed by an S-shift back to the centerline. Occupies two cells.
export function loop({ radius = 42, shift = 38, dir = 1 } = {}) {
  const L = 2 * C;
  const z0 = 100;
  const R = radius;
  const D = shift * dir; // + = left (local +X)
  const lenA = z0;
  const lenB = 2 * Math.PI * R;
  const lenC = L - z0;
  const total = lenA + lenB + lenC;
  const uA = lenA / total;
  const uB = (lenA + lenB) / total;
  const sStart = z0 + R + 15;
  const sEnd = L - 8;

  const part = (u) => {
    if (u <= uA) return { k: 0, t: u / uA };
    if (u <= uB) return { k: 1, t: (u - uA) / (uB - uA) };
    return { k: 2, t: (u - uB) / (1 - uB) };
  };
  return base('loop', {
    cells: 2,
    pos: (u, o) => {
      const { k, t } = part(u);
      if (k === 0) return o.set(0, 0, t * z0);
      if (k === 1) {
        const th = t * 2 * Math.PI;
        return o.set(D * smooth(t), R - R * Math.cos(th), z0 + R * Math.sin(th));
      }
      const z = z0 + t * lenC;
      return o.set(D * (1 - smooth(clamp01((z - sStart) / (sEnd - sStart)))), 0, z);
    },
    up: (u, o) => {
      const { k, t } = part(u);
      if (k !== 1) return false;
      const th = t * 2 * Math.PI;
      o.set(0, Math.cos(th), -Math.sin(th));
      return true;
    },
    tags: (u) => {
      const { k, t } = part(u);
      return k === 1 && t > 0.03 && t < 0.97 ? TAG.LOOP | TAG.MAGNET : 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Curves (90°). turn = +1 left, -1 right.
// ---------------------------------------------------------------------------

export function curve({ turn = 1, bank = 0, dy = 0, boosts = [], tunnel = false } = {}) {
  const R = C / 2;
  const yOf = rampProfile(dy);
  const id = (turn > 0 ? 'curveL' : 'curveR') + (bank ? 'Bank' : '');
  return base(id, {
    turn,
    dy,
    boosts,
    pos: (u, o) => {
      const a = u * Math.PI * 0.5;
      return o.set(turn * (R - R * Math.cos(a)), yOf(u), R * Math.sin(a));
    },
    // roll > 0 tilts the surface so the right side goes down.
    // For a left turn the inside (left) must be lower -> negative roll.
    roll: (u) => -turn * bank * Math.sin(Math.PI * u) ** 2,
    tags: () => (bank ? TAG.BANK : 0) | (tunnel ? TAG.TUNNEL : 0),
  });
}

// ---------------------------------------------------------------------------
// Registry used by hand-written track specs.
// ---------------------------------------------------------------------------

export const TILE_FACTORIES = {
  start: (p) => straight({ ...p, start: true }),
  straight: (p) => straight(p),
  tunnel: (p) => straight({ ...p, tunnel: true }),
  boost: (p) => straight({ boosts: p.boosts || [{ f: 0.35, x: -6 }, { f: 0.35, x: 6 }], ...p }),
  rampUp: (p) => straight({ dy: CONFIG.track.rampHeight, ...p }),
  rampDown: (p) => straight({ dy: -CONFIG.track.rampHeight, ...p }),
  bridge: (p) => straight({ ...p, deco: TAG.BRIDGE }),
  neonRings: (p) => straight({ ...p, deco: TAG.RINGS }),
  stadium: (p) => straight({ boosts: [{ f: 0.5, x: 0 }], ...p, deco: TAG.STANDS }),
  hill: (p) => hill(p),
  valley: (p) => valley(p),
  wave: (p) => wave(p),
  chicane: (p) => chicane(p),
  doubleChicane: (p) => chicane({ ...p, periods: 2 }),
  barrelRoll: (p) => barrelRoll(p),
  wallRide: (p) => wallRide(p),
  twist: (p) => twist(p),
  jump: (p) => jump(p),
  loop: (p) => loop(p),
  curveL: (p) => curve({ ...p, turn: 1 }),
  curveR: (p) => curve({ ...p, turn: -1 }),
};

export function createTile(type, params = {}) {
  const f = TILE_FACTORIES[type];
  if (!f) throw new Error(`Unknown tile type "${type}"`);
  const t = f(params);
  t.type = type;
  t.params = params;
  return t;
}

// Exit transform of a tile in its local frame (position + yaw change).
export function tileExit(tile) {
  const len = tile.cells * C;
  if (tile.turn === 0) return { pos: new THREE.Vector3(0, tile.dy, len), yaw: 0 };
  const R = C / 2;
  return { pos: new THREE.Vector3(tile.turn * R, tile.dy, R), yaw: (tile.turn * Math.PI) / 2 };
}
