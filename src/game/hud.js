// DOM heads-up display + minimap.
import { KMH } from '../config.js';
import { deaccent } from '../ui/text.js';

const $ = (id) => document.getElementById(id);

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// 7-segment digit layout: a b c d e f g
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

function digit(g, n, x, y, w, h, on, off) {
  const t = Math.max(2, Math.round(w / 5)); // segment thickness
  const hh = Math.floor(h / 2);
  const segs = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, hh - t],
    c: [x + w - t, y + hh + 1, t, hh - t - 1],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + hh + 1, t, hh - t - 1],
    f: [x, y + t, t, hh - t],
    g: [x + t, y + hh - Math.floor(t / 2), w - 2 * t, t],
  };
  const lit = SEG[n] || '';
  for (const k of 'abcdefg') {
    g.fillStyle = lit.includes(k) ? on : off;
    g.fillRect(...segs[k]);
  }
}

export class HUD {
  constructor() {
    this.root = $('hud');
    this.track = $('hud-track');
    this.speed = $('hud-speed');
    this.speedBar = $('hud-speedbar');
    this.lap = $('hud-lap');
    this.pos = $('hud-pos');
    this.time = $('hud-time');
    this.laps = $('hud-laps');
    this.msg = $('hud-msg');
    this.center = $('hud-center');
    this.boost = $('hud-boost');
    this.wrong = $('hud-wrong');
    this.map = $('hud-map');
    this.tacho = $('hud-tacho');
    this.tachoCtx = this.tacho.getContext('2d');
    this._t = 0;
    this.mapCtx = this.map.getContext('2d');
    this._msgTimer = 0;
    this._centerTimer = 0;
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  setupMap(track) {
    const W = this.map.width;
    const H = this.map.height;
    const b = track.bounds;
    const sx = b.max.x - b.min.x;
    const sz = b.max.z - b.min.z;
    const scale = (Math.min(W, H) - 24) / Math.max(sx, sz);
    this.mapProj = (x, z) => [W / 2 + (x - (b.min.x + sx / 2)) * scale, H / 2 + (z - (b.min.z + sz / 2)) * scale];
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const g = off.getContext('2d');
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= track.count; i += 4) {
        const k = (i % track.count) * 3;
        const [x, y] = this.mapProj(track.pos[k], track.pos[k + 2]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    };
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 7;
    path();
    g.stroke();
    g.strokeStyle = '#e9e1cf';
    g.lineWidth = 3;
    path();
    g.stroke();
    // start line marker
    const p = track.pos;
    const i = Math.round(track.startS / track.ds) * 3;
    const [x, y] = this.mapProj(p[i], p[i + 2]);
    g.fillStyle = '#d4202a';
    g.fillRect(x - 4, y - 4, 8, 8);
    this.mapBase = off;
  }

  drawMap(vehicles, player) {
    const g = this.mapCtx;
    g.clearRect(0, 0, this.map.width, this.map.height);
    if (this.mapBase) g.drawImage(this.mapBase, 0, 0);
    for (const v of vehicles) {
      const [x, y] = this.mapProj(v.position.x, v.position.z);
      g.fillStyle = v === player ? '#ffd23a' : '#ff4a3a';
      g.beginPath();
      g.arc(x, y, v === player ? 5 : 3.5, 0, Math.PI * 2);
      g.fill();
      if (v === player) {
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
  }

  update(dt, { speed, lap, laps, position, racers, time, lapTimes, best, boost, wrongWay }) {
    const kmh = Math.round(speed * KMH);
    this._t += dt;
    this.drawTacho(kmh, speed, boost);
    this.lap.innerHTML = `<b>${Math.min(lap, laps)}</b><i>/${laps}</i>`;
    this.pos.innerHTML = `<b>${position}</b><i>/${racers}</i>`;
    this.time.textContent = fmtTime(time);
    this.laps.innerHTML = lapTimes.map((t, i) => `<div class="${t === best ? 'best' : ''}">O${i + 1} ${fmtTime(t)}</div>`).join('');
    this.boost.classList.toggle('on', boost);
    this.wrong.classList.toggle('on', wrongWay);

    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this.msg.classList.remove('on');
    }
    if (this._centerTimer > 0) {
      this._centerTimer -= dt;
      if (this._centerTimer <= 0) this.center.classList.remove('on');
    }
  }

  // segmented arcade tachometer + 7-segment speed readout, drawn at low
  // resolution and upscaled with pixelated CSS
  drawTacho(kmh, speed, boost) {
    const g = this.tachoCtx;
    const W = this.tacho.width;
    const H = this.tacho.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = 70;
    const n = 30;
    const a0 = Math.PI * 0.95;
    const a1 = Math.PI * 2.05;
    const frac = Math.min(1, speed / 165);
    const lit = Math.round(frac * n);
    const flash = boost && Math.floor(this._t * 12) % 2 === 0;
    // backing plate
    g.fillStyle = 'rgba(8,6,14,0.55)';
    g.beginPath();
    g.arc(cx, cy, 68, a0 - 0.08, a1 + 0.08);
    g.lineTo(cx + 40, H - 2);
    g.lineTo(cx - 40, H - 2);
    g.closePath();
    g.fill();
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + 0.5) / n) * (a1 - a0);
      const r0 = 50;
      const r1 = 50 + 8 + (i / n) * 8;
      const f = i / n;
      let col = f < 0.55 ? '#f4ecd6' : f < 0.8 ? '#ffd23a' : '#ff3b2b';
      if (boost) col = flash ? '#ffffff' : '#ffb000';
      g.strokeStyle = i < lit ? col : 'rgba(255,255,255,0.12)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    // scale marks
    g.fillStyle = '#c8b8a0';
    g.font = 'bold 7px monospace';
    g.textAlign = 'center';
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (a1 - a0);
      g.fillText(String(k), cx + Math.cos(a) * 43, cy + Math.sin(a) * 43 + 3);
    }
    // digits
    const str = String(Math.min(999, kmh)).padStart(3, '0');
    const dw = 17;
    const dh = 30;
    const x0 = cx - (dw * 3 + 8) / 2;
    const on = boost ? '#ffd23a' : '#fff4d8';
    for (let i = 0; i < 3; i++) digit(g, +str[i], x0 + i * (dw + 4), 32, dw, dh, on, 'rgba(255,255,255,0.07)');
    g.fillStyle = '#ff6a4a';
    g.font = 'bold 8px monospace';
    g.fillText('KM/H', cx, 74);
  }

  message(text, secs = 2) {
    this.msg.textContent = deaccent(text);
    this.msg.classList.add('on');
    this._msgTimer = secs;
  }

  big(text, secs = 0.9, cls = '') {
    this.center.textContent = deaccent(text);
    // countdown digits in the chunky 3D face
    this.center.className = `on ${cls}${/^\d+$/.test(text) ? ' digit' : ''}`;
    // restart CSS animation
    void this.center.offsetWidth;
    this._centerTimer = secs;
  }

  // "♪ CONCRETE MOTORIK II" tag for a few seconds when a music track starts
  nowPlaying(title, secs = 4) {
    this.track.textContent = `♪ ${deaccent(title)}`;
    this.track.classList.add('on');
    clearTimeout(this._trackT);
    this._trackT = setTimeout(() => this.track.classList.remove('on'), secs * 1000);
  }
}
