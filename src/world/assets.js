// Hand-made asset library: Blockbench buildings (glTF) and the PS1-style
// tree pack (FBX). Every model is normalised to its real-world size in
// metres, its base put at y = 0, centred on its footprint and turned so that
// its street front faces +Z (width along X, depth along Z).
// The city instances them per mesh (see city.js -> _assetMeshes).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RETRO } from '../fx/retro.js';
import { nightWindows } from './photoFacades.js';

const GLTF_URLS = import.meta.glob('../../assets/buildings/*.gltf', { eager: true, query: '?url', import: 'default' });
const TREE_URLS = import.meta.glob('../../assets/ps1-style tree pack/Models/*.fbx', { eager: true, query: '?url', import: 'default' });
const TREE_TEX = import.meta.glob('../../assets/ps1-style tree pack/Textures/*.png', { eager: true, query: '?url', import: 'default' });
const byName = (glob, name) => {
  for (const [k, v] of Object.entries(glob)) if (k.split('/').pop().replace(/\.[^.]+$/, '') === name) return v;
  return null;
};

// Buildings. `height`: real height in metres (uniform scale, so the
// footprint keeps the model's proportions). `front`: yaw that turns the
// model's street side to +Z. `kind`: how the city uses it.
//   block  – residential panel block (row building)
//   tower  – point block, 14-16 storeys
//   office – office / institutional
//   shop   – low pavilion with shop fronts
//   hall   – industrial hall
//   kiosk  – RUCH newsstand, sits on the pavement
const Q = Math.PI / 2;
export const BUILDINGS = {
  building_01: { height: 30, front: Q, kind: 'block' }, // ~11 storeys, 65 m long
  building_02: { height: 33, front: Q, kind: 'block' }, // ~12 storeys, 78 m long
  building_03: { height: 28, front: Q, kind: 'block' }, // ~10 storeys, 75 m long
  building_04: { height: 44, front: 0, kind: 'tower' }, // 16 storeys, 22 × 24 m
  building_06: { height: 40, front: 0, kind: 'tower' }, // 14 storeys, 17 × 30 m
  building_factory_01: { height: 19, front: Q, kind: 'hall' },
  building_store_01: { height: 6.5, front: Q, kind: 'shop' }, // 40 m shopping row
  store_02: { height: 12, front: Q, kind: 'shop' }, // pavilion + office floor
  store_03: { height: 8, front: Q, kind: 'shop' },
  office: { height: 26, front: Q, kind: 'office' },
  office_02: { height: 40, front: Q, kind: 'office' },
  kiosk: { height: 2.7, front: Q, kind: 'kiosk' }, // real RUCH kiosk ~2.7 m tall
};

// Trees: real heights (m). tex = texture names for the model's materials
// (the pack's FBX files point at textures under other names).
export const TREES = {
  tree01: { height: 11, tex: { tree01: 'tree01' } }, // birch-like
  tree02: { height: 7.5, tex: { tree02: 'tree02' } }, // autumn maple
  tree03: { height: 8.5, tex: { treee03: 'treee03' } },
  tree04: { height: 6.5, tex: { deadtree: 'tree03' } }, // bare tree
  tree05: { height: 6, tex: { tree05: 'tree05' } },
  tree06: { height: 10, tex: { tree06: 'tree06' } }, // pine
  tree07: { height: 8, tex: { tree07: 'tree07' } },
  tree08: { height: 9.5, tex: { tree08: 'tree08' } },
};
export const GRASS = {
  grass01: { height: 0.9, tex: { '65756756': '65756756' } },
  grass04: { height: 0.7, tex: { Plants_09: 'Plants_09' } },
  grass05: { height: 0.6, tex: { Plants: 'Plants' } },
  grass06: { height: 0.8, tex: { Plants_05: 'Plants_05' } },
  grass07: { height: 0.7, tex: { Plants_03: 'Plants_03' } },
};

let lib = null;
/** The loaded library once loadBuildingAssets() resolved (sync access for the city). */
export let ASSETS = null;

/** Loads everything once. @returns {Promise<{buildings, trees, grass}>} */
export function loadBuildingAssets() {
  if (lib) return lib;
  lib = (async () => {
    const out = { buildings: {}, trees: {}, grass: {} };
    const gltf = new GLTFLoader();
    const jobs = Object.entries(BUILDINGS).map(async ([id, def]) => {
      try {
        const g = await gltf.loadAsync(byName(GLTF_URLS, id));
        out.buildings[id] = prepare(g.scene, def, id, buildingMaterial);
      } catch (e) {
        console.warn('[assets] building failed', id, e);
      }
    });
    const texLoader = new THREE.TextureLoader();
    const texCache = new Map();
    const tex = (name) => {
      if (!texCache.has(name)) {
        const t = texLoader.load(byName(TREE_TEX, name));
        t.colorSpace = THREE.SRGBColorSpace;
        pointSample(t);
        texCache.set(name, t);
      }
      return texCache.get(name);
    };
    const loadPlant = async (id, def, into) => {
      try {
        // keep the FBXLoader from fetching the textures by their original
        // (missing) paths – they are assigned by name below
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((u) => (/\.(png|jpe?g|tga|bmp)$/i.test(u) ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' : u));
        const obj = await new FBXLoader(manager).loadAsync(byName(TREE_URLS, id));
        const plantMat = (src) => {
          const name = (src.map?.name || src.name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
          const texName = def.tex[name] || Object.values(def.tex)[0];
          // leaves and bark share one texture sheet per tree
          return new THREE.MeshLambertMaterial({ map: tex(texName), alphaTest: 0.45, side: THREE.DoubleSide });
        };
        into[id] = prepare(obj, def, id, plantMat);
      } catch (e) {
        console.warn('[assets] plant failed', id, e);
      }
    };
    for (const [id, def] of Object.entries(TREES)) jobs.push(loadPlant(id, def, out.trees));
    for (const [id, def] of Object.entries(GRASS)) jobs.push(loadPlant(id, def, out.grass));
    await Promise.all(jobs);
    ASSETS = out;
    return out;
  })();
  return lib;
}

function pointSample(t) {
  if (!t) return t;
  if (RETRO.enabled) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  } else {
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
  }
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const matCache = new WeakMap();
// Blockbench exports unlit-looking standard materials with nearest filtering
// and clamp; switch to Lambert (cheaper, same height fog) and give it a
// lit-window emissive twin for dusk / night.
function buildingMaterial(src) {
  if (matCache.has(src)) return matCache.get(src);
  const map = pointSample(src.map);
  const m = new THREE.MeshLambertMaterial({
    map,
    emissiveMap: map ? nightWindows(map) : null,
    emissive: map ? 0xffffff : 0x000000,
    emissiveIntensity: 0,
    transparent: false,
    alphaTest: src.transparent || src.alphaTest ? 0.5 : 0,
    side: THREE.FrontSide,
  });
  m.userData.windows = !!map;
  matCache.set(src, m);
  return m;
}

// Normalise: rotate to front = +Z, scale to real height, base at y = 0,
// centred on the footprint. Returns the list of (geometry, material, matrix)
// parts so the city can instance each one.
function prepare(src, def, id, toMat) {
  const root = new THREE.Group();
  src.rotation.y = def.front || 0;
  root.add(src);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = def.height / size.y;
  const c = box.getCenter(new THREE.Vector3());
  const norm = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const parts = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const geo = o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
    geo.computeBoundingSphere();
    if (mats.length === 1) parts.push({ geometry: geo, material: toMat(mats[0]) });
    else {
      // split multi-material meshes by group so each part has one material
      for (const g of geo.groups) {
        const sub = geo.clone();
        sub.clearGroups();
        sub.setIndex(geo.index ? Array.from(geo.index.array.slice(g.start, g.start + g.count)) : null);
        if (!geo.index) {
          sub.setDrawRange(g.start, g.count);
        }
        parts.push({ geometry: sub, material: toMat(mats[g.materialIndex]) });
      }
    }
  });
  const sz = size.clone().multiplyScalar(k);
  return {
    id,
    def,
    parts,
    size: sz, // x = width along the street, y = height, z = depth
    create() {
      const g = new THREE.Group();
      for (const p of parts) g.add(new THREE.Mesh(p.geometry, p.material));
      return g;
    },
  };
}

/**
 * Instanced meshes for one asset placed at many transforms.
 * @param {{parts}} asset
 * @param {THREE.Matrix4[]} matrices
 */
export function instanceAsset(asset, matrices) {
  const out = [];
  if (!asset || !matrices.length) return out;
  for (const p of asset.parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}

/** Placement matrix: ground position, yaw (the model's front +Z turned to yaw), uniform scale. */
export function placeMatrix(x, y, z, yaw, s = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(s, s, s),
  );
}
