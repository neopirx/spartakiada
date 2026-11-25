// Painted panoramic sky, the way 32-bit arcade racers did it: one wide
// texture wrapped around the horizon with posterised cumulus (flat shading
// bands, a hard lit rim on the sun side), high streaky cirrus, a hazy ridge
// of hills and the distant silhouette of a PRL city (panel blocks, steelworks
// chimneys with smoke, a TV mast) sitting right on the horizon.
//
// The canvas is drawn in angular units: x = azimuth in degrees (0..360,
// matching u = atan(x, z) / 2π + 0.5 in the sky shader), y = elevation in
// degrees from PANO.bottom to PANO.top. Everything is transparent except
// the painted things, so the shader's gradient sky shows through.
import * as THREE from 'three';
import { RETRO } from '../fx/retro.js';

export const PANO = { bottom: -3, top: 34, gain: 1.6 };

// linear HDR colour (THREE.Vector3 / Color-like) -> css sRGB, divided by the
// shader's pano gain so highlights above 1 survive the 8-bit texture
function css(v, mul = 1, a = 1) {
  const enc = (x) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, (x * mul) / PANO.gain)), 1 / 2.2));
  const r = v.x ?? v.r;
  const g = v.y ?? v.g;
  const b = v.z ?? v.b;
  return `rgba(${enc(r)},${enc(g)},${enc(b)},${a})`;
}
const lerp3 = (a, b, k) => ({ x: (a.x ?? a.r) + ((b.x ?? b.r) - (a.x ?? a.r)) * k, y: (a.y ?? a.g) + ((b.y ?? b.g) - (a.y ?? a.g)) * k, z: (a.z ?? a.b) + ((b.z ?? b.b) - (a.z ?? a.b)) * k });

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} T      time-of-day preset (already modified for the weather)
 * @param {object} W      weather definition (WEATHERS[name])
 * @param {THREE.Vector3} sunDir
 * @param {number} seed
 * @returns {THREE.CanvasTexture}
 */
export function paintSkyPanorama(T, W, sunDir, seed = 1) {
  const rnd = mulberry(seed * 9973 + 11);
  const Wpx = RETRO.enabled ? 2048 : 4096;
  const Hpx = RETRO.enabled ? 512 : 1024;
  const c = document.createElement('canvas');
  c.width = Wpx;
  c.height = Hpx;
  const g = c.getContext('2d');
  const span = PANO.top - PANO.bottom;
  // angular units: x degrees right, y degrees up
  g.setTransform(Wpx / 360, 0, 0, -Hpx / span, 0, (PANO.top / span) * Hpx);

  const sunAz = ((Math.atan2(sunDir.x, sunDir.z) / (Math.PI * 2) + 0.5) * 360 + 360) % 360;
  const angTo = (x) => {
    let d = Math.abs(x - sunAz) % 360;
    if (d > 180) d = 360 - d;
    return d;
  };
  const night = T.stars > 1.1 && T.lamps > 1.1;
  const overcast = W.overcast || 0;
  const horizon = T.sky.horizon;
  const fog = { x: T.fog.r, y: T.fog.g, z: T.fog.b };

  // draw a shape at x and its copies across the 0/360 seam
  const wrap = (x, w, fn) => {
    fn(x);
    if (x - w < 0) fn(x + 360);
    if (x + w > 360) fn(x - 360);
  };

  // ---- high cirrus streaks -------------------------------------------------------------
  const cirrus = Math.round((W.cumulus ? 10 : 0) * (1 - overcast * 0.6));
  for (let i = 0; i < cirrus; i++) {
    const x = rnd() * 360;
    const y = 14 + rnd() * 16;
    const len = 18 + rnd() * 40;
    const col = lerp3(T.cloudLit, horizon, 0.35);
    wrap(x, len, (xx) => {
      for (let k = 0; k < 5; k++) {
        g.fillStyle = css(col, 1, 0.18 + rnd() * 0.12);
        g.beginPath();
        g.ellipse(xx + (rnd() - 0.5) * len * 0.6, y + (rnd() - 0.5) * 1.2, len * (0.25 + rnd() * 0.25), 0.25 + rnd() * 0.35, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  // ---- overcast decks (rain / storm / snow): layered flat stratus -------------------------
  if (overcast > 0.5) {
    for (let layer = 0; layer < 4; layer++) {
      const y0 = 2 + layer * 5;
      const n = 26;
      const k = layer / 3;
      const col = lerp3(T.cloudDark, T.cloudLit, 0.25 + k * 0.35);
      for (let i = 0; i < n; i++) {
        const x = (i / n) * 360 + rnd() * 10;
        const w = 14 + rnd() * 22;
        wrap(x, w, (xx) => {
          const yy = y0 + rnd() * 3;
          const hh = 2.2 + rnd() * 2.5;
          // darker underside, lighter top: two stacked flat tones
          g.fillStyle = css(T.cloudDark, 0.95, 0.8);
          g.beginPath();
          g.ellipse(xx, yy - hh * 0.25, w, hh, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = css(col, 1 - layer * 0.04, 0.9);
          g.beginPath();
          g.ellipse(xx + (rnd() - 0.5) * 4, yy + hh * 0.2, w * 0.9, hh * 0.8, 0, 0, Math.PI * 2);
          g.fill();
        });
      }
    }
  }

  // ---- cumulus -------------------------------------------------------------------------------
  // posterised: shadow body, mid band, lit cap, hard rim towards the sun
  const cumulus = (x, base, w, h) => {
    const toSun = 1 - angTo(x) / 180; // 1 = in front of the sun (back-lit)
    const lit = lerp3(T.cloudLit, horizon, 0.1 + 0.25 * (1 - base / 20));
    const dark = lerp3(T.cloudDark, horizon, 0.35);
    const mid = lerp3(lit, dark, 0.45 + toSun * 0.25);
    const rim = T.cloudRim;
    const blobs = [];
    const n = 5 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const bx = x + (f - 0.5) * w * 0.9 + (rnd() - 0.5) * w * 0.12;
      const r = w * (0.12 + rnd() * 0.1) * (1 - Math.abs(f - 0.5) * 0.9);
      const by = base + r * 0.55 + (1 - Math.abs(f - 0.5) * 2) * h * (0.35 + rnd() * 0.3);
      blobs.push([bx, by, r]);
    }
    // cauliflower top
    const topN = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < topN; i++) {
      const bx = x + (rnd() - 0.5) * w * 0.35;
      const r = w * (0.1 + rnd() * 0.08);
      blobs.push([bx, base + h * (0.7 + rnd() * 0.35), r]);
    }
    // the sun side (in azimuth) gets the light
    const sx = Math.sign(((sunAz - x + 540) % 360) - 180) || 1;
    const shape = (dx = 0, dy = 0, s = 1) => {
      g.beginPath();
      for (const [bx, by, r] of blobs) {
        g.moveTo(bx + dx * r + r * s, by + dy * r);
        g.arc(bx + dx * r, by + dy * r, r * s, 0, Math.PI * 2);
      }
    };
    g.save();
    // flat base
    g.beginPath();
    g.rect(x - w, base, w * 2, h * 3);
    g.clip();
    shape();
    g.fillStyle = css(dark);
    g.fill();
    shape();
    g.clip();
    shape(-sx * 0.12, 0.2, 0.95);
    g.fillStyle = css(mid);
    g.fill();
    shape(-sx * 0.22, 0.42, 0.85);
    g.fillStyle = css(lit);
    g.fill();
    g.restore();
    // hard rim on the sun side, brighter for back-lit clouds (silver lining):
    // the outer band of each blob not covered by a copy shifted away from the sun
    g.save();
    g.beginPath();
    g.rect(x - w, base, w * 2, h * 3);
    g.clip();
    shape();
    g.clip();
    g.fillStyle = css(lerp3(lit, rim, 0.5), 1 + toSun * 0.8, 0.85);
    for (const [bx, by, r] of blobs) {
      // crescent per puff (puff minus a copy shifted away from the sun);
      // also outlines the puffs inside the cloud, like a painted sky
      g.save();
      g.beginPath();
      g.arc(bx, by, r, 0, Math.PI * 2);
      g.clip();
      g.beginPath();
      g.rect(bx - 2 * r, by - 2 * r, 4 * r, 4 * r);
      g.moveTo(bx - sx * r * 0.18 + r * 0.98, by - r * 0.08);
      g.arc(bx - sx * r * 0.18, by - r * 0.08, r * 0.98, 0, Math.PI * 2, true);
      g.fill('evenodd');
      g.restore();
    }
    g.restore();
    // a darker band along the flat base
    g.fillStyle = css(dark, 0.8, 0.55);
    g.fillRect(x - w * 0.42, base, w * 0.84, h * 0.06);
  };
  if (W.cumulus) {
    const count = Math.round(10 + 22 * Math.min(1, overcast + 0.35 + (0.5 - T.cloudCover)));
    const list = [];
    for (let i = 0; i < count; i++) {
      // big towering banks near the horizon, smaller puffs higher up
      const far = rnd();
      const base = 0.8 + far * far * 17;
      const w = (32 - far * 18) * (0.7 + rnd() * 0.6);
      list.push({ x: rnd() * 360, base, w, h: w * (0.38 + rnd() * 0.3) });
    }
    // far (high, small) first so the near big ones overlap them
    list.sort((a, b) => b.base - a.base);
    for (const cl of list) wrap(cl.x, cl.w, (xx) => cumulus(xx, cl.base, cl.w, cl.h));
  }

  // ---- horizon: haze band, hills, distant city ---------------------------------------------------
  const haze = lerp3(horizon, fog, 0.5);
  // ridge of hills
  {
    const col = lerp3(haze, { x: 0.2, y: 0.24, z: 0.32 }, night ? 0.6 : 0.22);
    g.fillStyle = css(col);
    g.beginPath();
    g.moveTo(0, PANO.bottom);
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
    for (let x = 0; x <= 360; x += 1) {
      const a = (x / 360) * Math.PI * 2;
      const y = 0.55 + 0.45 * Math.sin(a * 3 + ph[0]) + 0.3 * Math.sin(a * 7 + ph[1]) + 0.18 * Math.sin(a * 17 + ph[2]);
      g.lineTo(x, Math.max(0.05, y));
    }
    g.lineTo(360, PANO.bottom);
    g.closePath();
    g.fill();
  }
  // city skyline: two layers, the nearer one darker
  const blinks = [];
  for (let layer = 0; layer < 2; layer++) {
    const col = lerp3(haze, night ? { x: 0.03, y: 0.03, z: 0.06 } : { x: 0.22, y: 0.24, z: 0.3 }, night ? 0.75 : 0.25 + layer * 0.17);
    g.fillStyle = css(col);
    let x = rnd() * 2;
    while (x < 360) {
      const kind = rnd();
      if (kind < 0.62) {
        // panel block / slab
        const w = 0.8 + rnd() * 2.6;
        const h = 0.35 + rnd() * (layer ? 1.1 : 0.7);
        g.fillRect(x, -0.5, w, h + 0.5);
        if (night) windows(g, x, h, w, rnd);
        x += w + rnd() * 0.6;
      } else if (kind < 0.8) {
        // point tower
        const w = 0.45 + rnd() * 0.5;
        const h = 1.2 + rnd() * 1.4;
        g.fillRect(x, -0.5, w, h + 0.5);
        if (night) windows(g, x, h, w, rnd);
        x += w + 0.2 + rnd() * 1.2;
      } else if (kind < 0.92) {
        // steelworks chimney with a smoke plume drifting downwind
        const h = 2.2 + rnd() * 2.2;
        g.fillRect(x, -0.5, 0.18, h + 0.5);
        g.fillStyle = css({ x: 0.7, y: 0.12, z: 0.1 }, night ? 0.4 : 1);
        g.fillRect(x, h - 0.35, 0.18, 0.15);
        g.fillRect(x, h - 0.8, 0.18, 0.15);
        g.fillStyle = css(col);
        const smoke = lerp3(T.cloudDark, T.cloudLit, night ? 0.2 : 0.55);
        for (let k = 0; k < 7; k++) {
          g.fillStyle = css(smoke, 1, 0.55 - k * 0.06);
          g.beginPath();
          g.ellipse(x + 0.1 + k * 0.9, h + 0.25 + k * 0.32, 0.3 + k * 0.22, 0.22 + k * 0.1, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = css(col);
        blinks.push([x + 0.09, h + 0.05]);
        x += 0.6 + rnd() * 3;
      } else {
        // TV mast / crane
        const h = 3 + rnd() * 2.5;
        g.fillRect(x, -0.5, 0.08, h + 0.5);
        g.fillRect(x - 0.35, h * 0.55, 0.78, 0.07);
        blinks.push([x + 0.04, h], [x + 0.04, h * 0.55]);
        x += 1 + rnd() * 4;
      }
      if (rnd() < 0.06) x += 6 + rnd() * 14; // gaps over fields / the river
    }
  }
  // red aviation lights
  g.fillStyle = 'rgba(255,60,40,0.95)';
  for (const [bx, by] of blinks) g.fillRect(bx - 0.09, by - 0.05, 0.18, 0.12);
  // sodium sky-glow over the city at night / dusk
  if (T.lamps > 0.5) {
    const glow = g.createLinearGradient(0, 0, 0, 5);
    glow.addColorStop(0, `rgba(255,150,70,${(0.22 * T.lamps).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(255,150,70,0)');
    g.fillStyle = glow;
    g.fillRect(0, -0.5, 360, 5.5);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  // no mipmaps: they would draw a seam where atan() wraps around
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = RETRO.enabled ? THREE.NearestFilter : THREE.LinearFilter;
  return t;
}

function windows(g, x, h, w, rnd) {
  const prev = g.fillStyle;
  for (let yy = 0.15; yy < h - 0.1; yy += 0.18) {
    for (let xx = x + 0.08; xx < x + w - 0.08; xx += 0.22) {
      if (rnd() < 0.3) {
        g.fillStyle = rnd() < 0.8 ? 'rgba(255,200,110,0.85)' : 'rgba(170,220,255,0.8)';
        g.fillRect(xx, yy, 0.09, 0.07);
      }
    }
  }
  g.fillStyle = prev;
}
