// Photo textures from assets/textures/other: pavements, grass, the concrete
// slab ground, PRL concrete fence panels, graffiti and poster walls.
// Preloaded once (preloadPhotoTextures) and then handed out synchronously.
// Like the road photos they are softened a little and filtered bilinear +
// anisotropic, because they slide past right next to the road at speed and
// point-sampled photo grit would shimmer.
import * as THREE from 'three';
import floorUrl from '../../assets/textures/other/concrete_floor.jpeg?url';
import graffitiUrl from '../../assets/textures/other/concrete_graffiti.jpeg?url';
import sidewalkUrl from '../../assets/textures/other/concrete_sidewalk.jpeg?url';
import postersUrl from '../../assets/textures/other/concrete_wall_advertistmens.jpeg?url';
import fenceUrl from '../../assets/textures/other/concrete_wall.jpeg?url';
import grassUrl from '../../assets/textures/other/grass.jpeg?url';
import grassWalkUrl from '../../assets/textures/other/grass_sidewalk.jpeg?url';

// size: real-world metres covered by one repeat [along u, along v]
export const PHOTO = {
  floor: { url: floorUrl, size: [11, 6] },          // big concrete slabs with a faded yellow line
  sidewalk: { url: sidewalkUrl, size: [3, 3] },     // 6 × 6 pavement slabs of 50 cm
  grassWalk: { url: grassWalkUrl, size: [6.5, 6.5] }, // pavement strip + grass verge (u: road -> out)
  grass: { url: grassUrl, size: [5, 5] },
  fence: { url: fenceUrl, size: [4.25, 2.2] },      // "jumbo" precast fence panels
  graffiti: { url: graffitiUrl, size: [6, 2.9] },
  posters: { url: postersUrl, size: [5.5, 3] },
  // graffiti turned 90° for extrusions whose u runs across the track profile
  graffitiRot: { url: graffitiUrl, size: [2.9, 6], rotate: true },
};

const cache = new Map();

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function compose(img, def, maxAniso, lowRes) {
  const max = lowRes ? 512 : 1024;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  let w = Math.round(img.width * k);
  let h = Math.round(img.height * k);
  if (def.rotate) [w, h] = [h, w];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const soften = lowRes ? 'blur(0.8px) contrast(0.85)' : 'blur(0.3px) contrast(0.95)';
  for (const f of ['none', soften]) {
    g.save();
    g.filter = f;
    if (def.rotate) {
      g.translate(w / 2, h / 2);
      g.rotate(Math.PI / 2);
      g.drawImage(img, -h / 2, -w / 2, h, w);
    } else g.drawImage(img, 0, 0, w, h);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.userData.keepFilter = true; // retroifyObject leaves it bilinear
  return t;
}

export async function preloadPhotoTextures(maxAniso = 8, lowRes = false) {
  if (cache.size) return;
  const ids = Object.keys(PHOTO);
  const imgs = new Map();
  await Promise.all([...new Set(ids.map((id) => PHOTO[id].url))].map((url) => loadImage(url).then((img) => imgs.set(url, img)).catch(() => null)));
  for (const id of ids) {
    const img = imgs.get(PHOTO[id].url);
    if (img) cache.set(id, compose(img, PHOTO[id], maxAniso, lowRes));
  }
}

// The texture for id, or null if it failed to load (callers fall back to
// their procedural textures).
export function photoTexture(id) {
  return cache.get(id) || null;
}
