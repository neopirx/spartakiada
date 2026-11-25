// Road surface themes built from the seamless photo textures in
// assets/textures/roads. The photos run along X, so they are rotated to run
// along V (track length) and get PRL red/white kerbs painted on the edges.
import * as THREE from 'three';
import road06 from '../../assets/textures/roads/road_road_0006_01_tiled_s.jpg?url';
import road16 from '../../assets/textures/roads/road_road_0016_01_tiled_s.jpg?url';
import road18 from '../../assets/textures/roads/road_road_0018_01_s.jpg?url';

export const ROAD_THEMES = [
  { id: 'lines', url: road16, mirror: false, edgeLine: false },
  { id: 'concrete', url: road06, mirror: false, edgeLine: true },
  { id: 'worn', url: road18, mirror: true, edgeLine: true }, // not tileable -> mirror along the length
];

const cache = [];

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function compose(img, theme, maxAniso, lowRes) {
  const across = lowRes ? 512 : 1024;
  // length of one repeat in pixels (photo is rotated: its width runs along the track)
  let along = Math.round((across * img.width) / img.height);
  if (theme.mirror) along *= 2;
  along = Math.min(lowRes ? 2048 : 4096, along);
  const c = document.createElement('canvas');
  c.width = across;
  c.height = along;
  const g = c.getContext('2d');
  // The photos are full of pixel-sized grit. Sliding under the camera at
  // 400 km/h that grit is what reads as flicker, so soften it: a little blur
  // and less contrast keep the asphalt's character without the strobing.
  const soften = lowRes ? 'blur(1.2px) contrast(0.72) saturate(0.9)' : 'blur(0.4px) contrast(0.9)';
  const drawRot = (y0, h, flip) => {
    // sharp copy underneath: the blur fades the tile edges, which would
    // otherwise show as seams every repeat
    for (const f of ['none', soften]) {
      g.save();
      g.filter = f;
      g.translate(across / 2, y0 + h / 2);
      g.rotate(Math.PI / 2);
      if (flip) g.scale(-1, 1);
      g.drawImage(img, -h / 2, -across / 2, h, across);
      g.restore();
    }
  };
  if (theme.mirror) {
    drawRot(0, along / 2, false);
    drawRot(along / 2, along / 2, true);
  } else drawRot(0, along, false);

  // painted kerbs + guide lines, then grime multiplied back over them
  const kerb = across * 0.045;
  const blocks = Math.max(4, Math.round(along / (across / 8)));
  const bh = along / blocks;
  g.globalAlpha = 0.92;
  for (let i = 0; i < blocks; i++) {
    g.fillStyle = i % 2 ? '#e6e0d2' : '#b81c26';
    g.fillRect(0, i * bh, kerb, bh);
    g.fillRect(across - kerb, i * bh, kerb, bh);
  }
  if (theme.edgeLine) {
    g.fillStyle = '#e8dcae';
    g.globalAlpha = 0.8;
    g.fillRect(kerb + across / 100, 0, across / 146, along);
    g.fillRect(across - kerb - across / 60, 0, across / 146, along);
  }
  g.globalAlpha = 0.55;
  g.globalCompositeOperation = 'multiply';
  g.save();
  g.beginPath();
  g.rect(0, 0, kerb + across / 50, along);
  g.rect(across - kerb - across / 50, 0, kerb + across / 50, along);
  g.clip();
  if (theme.mirror) {
    drawRot(0, along / 2, false);
    drawRot(along / 2, along / 2, true);
  } else drawRot(0, along, false);
  g.restore();
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Bilinear up close (like the arcade hardware of the era, Namco System 22),
  // trilinear + full anisotropy far away: point sampling the road made every
  // texel pop in and out as it slid under the camera.
  tex.anisotropy = maxAniso;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.userData.keepFilter = true; // retroifyObject must not switch it to nearest
  // separate linear copy for bump / roughness
  const data = new THREE.CanvasTexture(c);
  data.wrapS = data.wrapT = THREE.RepeatWrapping;
  data.anisotropy = maxAniso;
  data.userData.keepFilter = true;
  return { texture: tex, data, aspect: along / across, id: theme.id };
}

export async function preloadRoadTextures(maxAniso = 8, lowRes = false) {
  if (cache.length) return cache;
  const imgs = await Promise.all(ROAD_THEMES.map((t) => loadImage(t.url).catch(() => null)));
  imgs.forEach((img, i) => {
    cache[i] = img ? compose(img, ROAD_THEMES[i], maxAniso, lowRes) : null;
  });
  return cache;
}

export function roadTheme(index) {
  const list = cache.filter(Boolean);
  if (!list.length) return null;
  return list[((index % list.length) + list.length) % list.length];
}
