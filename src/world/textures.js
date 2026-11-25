// Procedurally drawn canvas textures – no external image files needed.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function noise(ctx, w, h, amount, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = Math.random() * 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

// Road: concrete slabs, red/white kerbs, yellow lane dashes. U across, V along.
export function roadTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#3a3c42';
  g.fillRect(0, 0, 512, 512);
  noise(g, 512, 512, 9000, 0.06);
  // slab seams
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 2;
  for (let y = 0; y <= 512; y += 128) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
  }
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.stroke();
  // kerbs
  const kerb = 26;
  for (let y = 0; y < 512; y += 64) {
    g.fillStyle = (y / 64) % 2 ? '#e8e4da' : '#c8202a';
    g.fillRect(0, y, kerb, 64);
    g.fillRect(512 - kerb, y, kerb, 64);
  }
  // inner guide lines
  g.fillStyle = '#d9b52a';
  g.fillRect(kerb + 6, 0, 5, 512);
  g.fillRect(512 - kerb - 11, 0, 5, 512);
  // centre dashes
  g.fillStyle = 'rgba(235,235,225,0.85)';
  for (let y = 16; y < 512; y += 128) g.fillRect(170, y, 6, 64), g.fillRect(336, y, 6, 64);
  return tex(c);
}

export function concreteTexture(base = '#5d5a55') {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 6000, 0.08);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (let x = 0; x < 256; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  return tex(c);
}

// Wall: white/red warning stripes on the inner face.
export function wallTexture() {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#d8d4c8';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#b81d26';
  for (let x = -64; x < 256; x += 64) {
    g.beginPath();
    g.moveTo(x, 64); g.lineTo(x + 32, 64); g.lineTo(x + 64, 0); g.lineTo(x + 32, 0);
    g.fill();
  }
  g.fillStyle = '#222';
  g.fillRect(0, 0, 256, 6);
  noise(g, 256, 64, 800, 0.1);
  return tex(c);
}

// Booster pad: chevrons, scrolled in the shader via texture offset.
export function boostTexture() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#1a0606';
  g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 64) {
    g.fillStyle = '#ff3b1f';
    g.beginPath();
    g.moveTo(10, y + 60); g.lineTo(64, y + 14); g.lineTo(118, y + 60);
    g.lineTo(118, y + 38); g.lineTo(64, y - 8); g.lineTo(10, y + 38);
    g.fill();
    g.fillStyle = '#ffd23a';
    g.beginPath();
    g.moveTo(26, y + 52); g.lineTo(64, y + 20); g.lineTo(102, y + 52);
    g.lineTo(102, y + 44); g.lineTo(64, y + 10); g.lineTo(26, y + 44);
    g.fill();
  }
  return tex(c);
}

// Window grid for panel-block buildings ("wielka płyta").
// Returns { map, emissive } – lit windows glow at night.
export function blockTextures(cols = 8, rows = 10, seed = 1) {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#8f8a80';
  g.fillRect(0, 0, W, H);
  noise(g, W, H, 4000, 0.07);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const cw = W / cols;
  const rh = H / rows;
  // panel seams
  g.strokeStyle = 'rgba(40,38,35,0.6)';
  g.lineWidth = 2;
  for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, H); g.stroke(); }
  for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, j * rh); g.lineTo(W, j * rh); g.stroke(); }
  // balcony band colour accents (typical PRL pastel panels)
  const accents = ['#b5543c', '#4f7a8c', '#c79b3b', '#6c8a4e'];
  const accent = accents[Math.floor(rnd() * accents.length)];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * cw + cw * 0.2;
      const y = j * rh + rh * 0.22;
      const w = cw * 0.6;
      const h = rh * 0.5;
      if (i % 3 === 1) {
        g.fillStyle = accent;
        g.fillRect(i * cw + 2, j * rh + rh * 0.72, cw - 4, rh * 0.26);
      }
      const lit = rnd();
      g.fillStyle = '#1d2129';
      g.fillRect(x, y, w, h);
      if (lit < 0.38) {
        const warm = rnd() < 0.8;
        const col = warm ? `hsl(${38 + rnd() * 12},90%,${55 + rnd() * 20}%)` : `hsl(${200 + rnd() * 30},70%,65%)`;
        g.fillStyle = col;
        g.fillRect(x, y, w, h);
        ge.fillStyle = col;
        ge.fillRect(x, y, w, h);
      }
    }
  }
  return { map: tex(c), emissive: tex(e) };
}

// Neon / painted signs with Polish lettering.
export function signTexture(text, { fg = '#ff3344', bg = 'rgba(0,0,0,0)', w = 1024, h = 256, font = 'bold', glow = true, border = false } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = fg;
    g.lineWidth = h * 0.05;
    g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
  }
  let size = h * 0.62;
  g.font = `${font} ${size}px "Arial Narrow", "Roboto Condensed", Impact, sans-serif`;
  while (g.measureText(text).width > w * 0.9 && size > 10) {
    size -= 4;
    g.font = `${font} ${size}px "Arial Narrow", "Roboto Condensed", Impact, sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (glow) {
    g.shadowColor = fg;
    g.shadowBlur = h * 0.12;
  }
  g.fillStyle = fg;
  g.fillText(text, w / 2, h / 2 + size * 0.04);
  g.shadowBlur = 0;
  return tex(c, { repeat: false });
}

// Constructivist-style poster for trackside billboards.
export function posterTexture(lines, palette) {
  const [c, g] = canvas(1024, 512);
  const [bg, fg, acc] = palette;
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 512);
  // diagonal wedge
  g.fillStyle = acc;
  g.beginPath();
  g.moveTo(0, 512); g.lineTo(380, 0); g.lineTo(560, 0); g.lineTo(180, 512);
  g.fill();
  g.beginPath();
  g.arc(870, 120, 80, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    let size = i === 0 ? 120 : 64;
    g.font = `bold ${size}px "Arial Narrow", Impact, sans-serif`;
    while (g.measureText(line).width > 900 && size > 20) {
      size -= 4;
      g.font = `bold ${size}px "Arial Narrow", Impact, sans-serif`;
    }
    g.fillText(line, 60, 190 + i * 130);
  });
  g.strokeStyle = fg;
  g.lineWidth = 10;
  g.strokeRect(20, 20, 984, 472);
  return tex(c, { repeat: false });
}

export function groundTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#23252a';
  g.fillRect(0, 0, 512, 512);
  noise(g, 512, 512, 12000, 0.05);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  return tex(c);
}

// Soft radial glow sprite (thrusters, lamps).
export function glowTexture(color = '255,180,80') {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, `rgba(${color},1)`);
  grd.addColorStop(0.25, `rgba(${color},0.6)`);
  grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return tex(c, { repeat: false });
}
