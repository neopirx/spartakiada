// Turns a list of tile specs into a sampled, closed track:
// evenly spaced centerline points with an orthonormal frame
// (forward / up / right), in-plane curvature and tags.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createTile, tileExit, TAG } from './tiles.js';

const TWO_PI = Math.PI * 2;
const wrapAngle = (a) => a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);

export class TrackData {
  constructor(spec) {
    this.name = spec.name || 'Tor';
    this.spec = spec;
    this.width = CONFIG.track.width;
    this._build(spec.tiles);
  }

  _build(tileSpecs) {
    const tiles = tileSpecs.map((t) => createTile(t.type, t.params || {}));
    this.tiles = tiles;

    // --- 1. dense sampling of every tile, chained by transforms --------------
    const dense = { p: [], up: [], hasUp: [], roll: [], tags: [], tile: [] };
    const origin = new THREE.Vector3();
    let yaw = 0;
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const lp = new THREE.Vector3();
    const lu = new THREE.Vector3();
    const placements = [];

    tiles.forEach((tile, ti) => {
      q.setFromAxisAngle(yAxis, yaw);
      placements.push({ origin: origin.clone(), yaw });
      const n = Math.ceil(tile.cells * CONFIG.track.cell * (tile.id === 'loop' ? 8 : 3));
      for (let k = 0; k < n; k++) {
        const u = k / n;
        tile.pos(u, lp).applyQuaternion(q).add(origin);
        const has = tile.up(u, lu);
        if (has) lu.applyQuaternion(q);
        else lu.set(0, 1, 0);
        dense.p.push(lp.clone());
        dense.up.push(lu.clone());
        dense.hasUp.push(has);
        dense.roll.push(tile.roll(u));
        dense.tags.push(tile.tags(u));
        dense.tile.push(ti);
      }
      const ex = tileExit(tile);
      origin.add(ex.pos.applyQuaternion(q));
      yaw += ex.yaw;
    });

    this.placements = placements;
    this.closureError = origin.length();
    this.closureYaw = Math.abs(wrapAngle(yaw));
    if (this.closureError > 0.5 || this.closureYaw > 0.01) {
      console.warn(`[track] "${this.name}" is not closed: gap ${this.closureError.toFixed(2)} m, yaw ${this.closureYaw.toFixed(3)} rad`);
    }

    // --- 2. arc length --------------------------------------------------------
    const m = dense.p.length;
    const cum = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
      cum[i + 1] = cum[i] + dense.p[i].distanceTo(dense.p[(i + 1) % m]);
    }
    const L = cum[m];
    const N = Math.round(L / CONFIG.track.sampleStep);
    const ds = L / N;
    this.length = L;
    this.count = N;
    this.ds = ds;

    // tile start distances
    this.tileStartS = new Float64Array(tiles.length + 1);
    {
      let last = -1;
      for (let i = 0; i < m; i++) {
        if (dense.tile[i] !== last) {
          last = dense.tile[i];
          this.tileStartS[last] = cum[i];
        }
      }
      this.tileStartS[tiles.length] = L;
    }

    // --- 3. uniform resampling ------------------------------------------------
    const pos = new Float32Array(N * 3);
    const baseUp = new Float32Array(N * 3);
    const roll = new Float32Array(N);
    const tags = new Uint16Array(N);
    const tileIdx = new Uint16Array(N);
    let j = 0;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const s = i * ds;
      while (j < m - 1 && cum[j + 1] <= s) j++;
      const a = j;
      const b = (j + 1) % m;
      const segLen = cum[j + 1] - cum[j];
      const t = segLen > 0 ? (s - cum[j]) / segLen : 0;
      tmp.copy(dense.p[a]).lerp(dense.p[b], t);
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
      tmp.copy(dense.up[a]).lerp(dense.up[b], t);
      baseUp.set([tmp.x, tmp.y, tmp.z], i * 3);
      roll[i] = dense.roll[a] + wrapAngle(dense.roll[b] - dense.roll[a]) * t;
      tags[i] = t < 0.5 ? dense.tags[a] : dense.tags[b];
      tileIdx[i] = dense.tile[a];
    }

    // --- 4. frames ------------------------------------------------------------
    const fwd = new Float32Array(N * 3);
    const up = new Float32Array(N * 3);
    const right = new Float32Array(N * 3);
    const P = (i, o) => o.fromArray(pos, ((i + N) % N) * 3);
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const f = new THREE.Vector3();
    const u = new THREE.Vector3();
    const r = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      P(i + 1, v1);
      P(i - 1, v0);
      f.subVectors(v1, v0).normalize();
      u.fromArray(baseUp, i * 3);
      u.addScaledVector(f, -u.dot(f)).normalize();
      if (roll[i] !== 0) u.applyAxisAngle(f, roll[i]);
      r.crossVectors(f, u).normalize();
      f.toArray(fwd, i * 3);
      u.toArray(up, i * 3);
      r.toArray(right, i * 3);
    }

    // signed in-plane curvature (+ = turning right)
    const kappa = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      v1.fromArray(fwd, ((i + 1) % N) * 3);
      v0.fromArray(fwd, ((i - 1 + N) % N) * 3);
      r.fromArray(right, i * 3);
      kappa[i] = v1.sub(v0).dot(r) / (2 * ds);
    }
    // light smoothing of curvature to remove sampling noise
    const k2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let d = -3; d <= 3; d++) acc += kappa[(i + d + N) % N];
      k2[i] = acc / 7;
    }
    // Rolling sections (barrel roll, twist, wall ride, loop) are magnetic rails:
    // their roll acceleration shows up as in-plane curvature that would act
    // like a hairpin turn, so the physics ignores it there.
    for (let i = 0; i < N; i++) if (tags[i] & TAG.MAGNET) k2[i] = 0;

    Object.assign(this, { pos, fwd, up, right, kappa: k2, tags, tileIdx, roll });

    // --- 5. boosters & props --------------------------------------------------
    this.boosts = [];
    this.props = [];
    tiles.forEach((tile, ti) => {
      const s0 = this.tileStartS[ti];
      const len = this.tileStartS[ti + 1] - s0;
      for (const b of tile.boosts) {
        this.boosts.push({ s: s0 + b.f * len, x: b.x, length: 7, width: 7 });
      }
      for (const p of tile.props) this.props.push({ ...p, s: s0 + p.f * len, tile: ti });
    });
    const startTile = tiles.findIndex((t) => t.id === 'start');
    this.startS = startTile >= 0 ? this.tileStartS[startTile] + 0.6 * (this.tileStartS[startTile + 1] - this.tileStartS[startTile]) : 0;

    // bounds
    const box = new THREE.Box3();
    for (let i = 0; i < N; i++) box.expandByPoint(P(i, v0));
    this.bounds = box;
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  // Signed shortest distance from s1 to s2 along the loop.
  deltaS(s1, s2) {
    let d = s2 - s1;
    const L = this.length;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  _interp(arr, s, out) {
    const x = this.wrapS(s) / this.ds;
    const i = Math.floor(x) % this.count;
    const j = (i + 1) % this.count;
    const t = x - Math.floor(x);
    const a = i * 3;
    const b = j * 3;
    return out.set(
      arr[a] + (arr[b] - arr[a]) * t,
      arr[a + 1] + (arr[b + 1] - arr[a + 1]) * t,
      arr[a + 2] + (arr[b + 2] - arr[a + 2]) * t,
    );
  }

  // Fills a frame object {pos, fwd, up, right} for distance s.
  frameAt(s, fr) {
    this._interp(this.pos, s, fr.pos);
    this._interp(this.fwd, s, fr.fwd).normalize();
    this._interp(this.up, s, fr.up);
    fr.up.addScaledVector(fr.fwd, -fr.up.dot(fr.fwd)).normalize();
    fr.right.crossVectors(fr.fwd, fr.up);
    return fr;
  }

  kappaAt(s) {
    const x = this.wrapS(s) / this.ds;
    const i = Math.floor(x) % this.count;
    const j = (i + 1) % this.count;
    const t = x - Math.floor(x);
    return this.kappa[i] * (1 - t) + this.kappa[j] * t;
  }

  tagsAt(s) {
    return this.tags[Math.round(this.wrapS(s) / this.ds) % this.count];
  }

  // World position of a point with lateral offset x (+ right) and height h.
  pointAt(s, x, h, out, fr = this._fr || (this._fr = makeFrame())) {
    this.frameAt(s, fr);
    return out.copy(fr.pos).addScaledVector(fr.right, x).addScaledVector(fr.up, h);
  }
}

export function makeFrame() {
  return {
    pos: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    up: new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
}

export { TAG };
