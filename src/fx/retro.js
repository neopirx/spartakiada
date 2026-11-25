// "PSX" presentation – the 32-bit arcade-console look (Ridge Racer era):
//  - low internal resolution, nearest-neighbour upscale (see postfx.js)
//  - point-sampled textures (blocky texels up close, mip blend far away)
//  - vertex snapping to the internal pixel grid (the familiar polygon jitter)
//  - 15-bit colour with ordered dithering (see postfx.js)
//  - no realtime shadow maps; blob shadows only
// Must be installed before any material compiles; switching style reloads.
import * as THREE from 'three';

export const RETRO = {
  enabled: false,
  height: 360, // internal vertical resolution
};

export function installRetro({ enabled, height }) {
  RETRO.enabled = enabled;
  RETRO.height = height;
  if (!enabled) return;
  // Snap clip-space vertices to a grid matching the internal resolution.
  // Aspect is assumed 16:9 for the horizontal grid – exact matching is not
  // needed for the effect.
  // grid at twice the internal resolution: the polygon wobble is still
  // there, but subtle instead of jumpy
  const gy = height.toFixed(1);
  const gx = ((height * 16) / 9).toFixed(1);
  THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
    'gl_Position = projectionMatrix * mvPosition;',
    `gl_Position = projectionMatrix * mvPosition;
    #ifndef PSX_NO_SNAP
    if ( gl_Position.w > 0.05 ) {
      vec2 psxGrid = vec2( ${gx}, ${gy} );
      gl_Position.xy = floor( gl_Position.xy / gl_Position.w * psxGrid + 0.5 ) / psxGrid * gl_Position.w;
    }
    #endif`,
  );
}

const seen = new WeakSet();

// Point-sample a texture up close; trilinear when minified so distant
// surfaces don't sparkle.
export function retroTexture(t) {
  if (!t || seen.has(t)) return t;
  seen.add(t);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = Math.max(t.anisotropy || 1, 2);
  t.needsUpdate = true;
  return t;
}

const SLOTS = ['map', 'emissiveMap', 'bumpMap', 'roughnessMap', 'alphaMap', 'normalMap'];

// Walk an object tree and point-sample every texture it uses.
// snap: false keeps the vertices off the PSX grid. The world (track, city,
// ground) uses that: snapped road / kerb / wall vertices jump by a pixel
// as the camera moves, which made the whole road shimmer while driving.
// Cars and small props keep the wobble.
export function retroifyObject(root, { snap = true } = {}) {
  if (!RETRO.enabled) return;
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!snap && !(m.defines && 'PSX_NO_SNAP' in m.defines)) {
        m.defines = { ...(m.defines || {}), PSX_NO_SNAP: '' };
        m.needsUpdate = true;
      }
      for (const k of SLOTS) if (m[k] && !m[k].userData.keepFilter) retroTexture(m[k]);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) retroTexture(u.value);
    }
  });
}
