// Loads car models (FBX), normalises them (Y-up, facing +Z, bottom at y=0,
// scaled to CONFIG.car.length) and creates per-racer instances with their own
// livery (hue shift of the original texture) and a blob shadow.
// Effects (thrusters, exhaust) live in src/fx/carFx.js and attach to the
// anchors defined here.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { CONFIG } from '../config.js';
import polonezUrl from '../../assets/cars/polonez.fbx?url';
import fiatUrl from '../../assets/cars/fiat.fbx?url';

// Car registry – add more era cars here.
//  rotation: converts the file's axes to the game convention (Y up, nose +Z)
//  anchors : effect attachment points in the model's own units, measured
//            AFTER `rotation` is applied (use tools/model-viewer.html)
//            pods     – the 4 downward hover thrusters (bottom centre of each pod)
//            exhausts – exhaust pipe outlets (engine nozzles)
//  length  : metres, the model is scaled to it (default CONFIG.car.length)
//  engine  : nozzle size (m) and jet colours for EngineFX
//  voice   : engine sound pitch character (1 = deepest)
//  stats   : 1..5 bars shown on the car-select screen
//  handling: multipliers on CONFIG.car (thrust, drag, steer, grip)
export const CAR_MODELS = {
  polonez: {
    name: 'Polonez',
    full: 'FSO Polonez 2136',
    blurb: 'Ciężki, stabilny, jeden wielki dysz. Najwyższa prędkość maksymalna.',
    url: polonezUrl,
    voice: 1.0,
    stats: { speed: 5, accel: 3, handling: 3, weight: 5 },
    handling: { thrust: 1.0, drag: 0.95, steer: 0.94, grip: 0.95 },
    length: 4.27, // FSO Polonez hatchback: 4272 mm
    engine: { size: 0.24, color: [0.25, 0.75, 1.0], boostColor: [1.0, 0.25, 0.55] },
    rotation: [-Math.PI / 2, 0, 0], // file is Z-up
    anchors: {
      pods: [
        [15, 0.3, 30], [-15, 0.3, 30],
        [15, 0.3, -28], [-15, 0.3, -28],
      ],
      exhausts: [[-8.5, 3.05, -50]],
    },
  },
  fiat: {
    name: 'Fiat 126p',
    full: 'Polski Fiat 126p „Maluch” 2136',
    blurb: 'Mały, zwinny, podwójny wydech. Najlepsze przyspieszenie i skręt.',
    url: fiatUrl,
    voice: 1.22,
    stats: { speed: 3, accel: 5, handling: 5, weight: 2 },
    handling: { thrust: 1.06, drag: 1.1, steer: 1.14, grip: 1.12 },
    rotation: [-Math.PI / 2, 0, 0], // file is Z-up
    length: 3.05, // Polski Fiat 126p: 3054 mm
    engine: { size: 0.15, color: [1.0, 0.6, 0.18], boostColor: [1.0, 0.2, 0.7] },
    anchors: {
      pods: [
        [18.5, 0.3, 31.4], [-18.5, 0.3, 31.4],
        [18.5, 0.3, -30.4], [-18.5, 0.3, -30.4],
      ],
      exhausts: [[-13.86, 5.35, -50.3], [-9.9, 5.35, -50.3]],
    },
  },
};

const cache = new Map();

export async function loadCarModel(id = 'polonez', onProgress) {
  if (cache.has(id)) return cache.get(id);
  const def = CAR_MODELS[id];
  const promise = new Promise((resolve) => {
    new FBXLoader().load(
      def.url,
      (obj) => resolve(normalise(obj, { ...def, id })),
      (e) => onProgress && e.total && onProgress(e.loaded / e.total),
      (err) => {
        console.error('[car] failed to load model, using placeholder', err);
        resolve(placeholderCar());
      },
    );
  });
  cache.set(id, promise);
  return promise;
}

function normalise(obj, def) {
  obj.rotation.set(...def.rotation);
  const wrap = new THREE.Group();
  wrap.add(obj);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const scale = (def.length || CONFIG.car.length) / size.z;
  const center = box.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -box.min.y, -center.z);
  wrap.scale.setScalar(scale);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    o.material = new THREE.MeshStandardMaterial({
      map: src.map || null,
      color: 0xffffff,
      metalness: 0.35,
      roughness: 0.42,
    });
    if (o.material.map) {
      o.material.map.colorSpace = THREE.SRGBColorSpace;
      o.material.map.anisotropy = 8;
    }
    o.castShadow = true;
    o.receiveShadow = true;
  });
  const toLocal = ([x, y, z]) => new THREE.Vector3(x + obj.position.x, y + obj.position.y, z + obj.position.z).multiplyScalar(scale);
  const a = def.anchors || {};
  const bounds = { length: size.z * scale, width: size.x * scale, height: size.y * scale };
  const anchors = {
    pods: a.pods ? a.pods.map(toLocal) : defaultPods(bounds),
    exhausts: (a.exhausts || [[0, size.y * 0.3, box.min.z]]).map(toLocal),
  };
  const e = def.engine || {};
  const col = (c) => (c ? new THREE.Color(...c) : undefined);
  return { object: wrap, bounds, anchors, id: def.id, def, engine: { size: e.size ?? 0.22, color: col(e.color), boostColor: col(e.boostColor) } };
}

function defaultPods(b) {
  const x = b.width * 0.38;
  const z = b.length * 0.3;
  return [new THREE.Vector3(x, 0, z), new THREE.Vector3(-x, 0, z), new THREE.Vector3(x, 0, -z), new THREE.Vector3(-x, 0, -z)];
}

function placeholderCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0xc03020, metalness: 0.4, roughness: 0.4 }));
  body.position.y = 0.6;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 2.4), new THREE.MeshStandardMaterial({ color: 0x223344 }));
  cab.position.set(0, 1.3, -0.3);
  g.add(body, cab);
  const bounds = { length: 5, width: 2.3, height: 1.6 };
  return { object: g, bounds, anchors: { pods: defaultPods(bounds), exhausts: [new THREE.Vector3(-0.5, 0.3, -2.5)] } };
}

// Hue-shifted copy of a material: keeps the livery details, changes colours.
function liveryMaterial(base, hue, sat = 1) {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHue = { value: hue };
    shader.uniforms.uSat = { value: sat };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uHue; uniform float uSat;
        vec3 hueShift(vec3 c, float h) {
          const vec3 k = vec3(0.57735);
          float ca = cos(h);
          vec3 r = c * ca + cross(k, c) * sin(h) + k * dot(k, c) * (1.0 - ca);
          float l = dot(r, vec3(0.299,0.587,0.114));
          return mix(vec3(l), r, uSat);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = hueShift(diffuseColor.rgb, uHue);`);
  };
  m.customProgramCacheKey = () => `livery_${hue.toFixed(2)}_${sat}`;
  return m;
}

export const LIVERIES = [
  { hue: 0, sat: 1, name: 'Oranżada' },
  { hue: 2.2, sat: 1.0, name: 'Zieleń' },
  { hue: 3.6, sat: 1.0, name: 'Błękit' },
  { hue: 1.2, sat: 1.1, name: 'Cytryna' },
  { hue: 5.0, sat: 1.1, name: 'Fiolet' },
  { hue: 0.0, sat: 0.0, name: 'Srebro' },
];

let shadowTex = null;

export function createCarInstance(template, liveryIdx = 0) {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.6)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const root = new THREE.Group(); // placed on the track by physics
  const body = new THREE.Group(); // visual bank / pitch / bob
  root.add(body);
  const car = template.object.clone(true);
  const L = LIVERIES[liveryIdx % LIVERIES.length];
  car.traverse((o) => {
    if (o.isMesh && !(L.hue === 0 && L.sat === 1)) o.material = liveryMaterial(o.material, L.hue, L.sat);
  });
  body.add(car);
  const { length, width } = template.bounds;

  // soft contact shadow – sits on the road, not on the bobbing body
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.4, length * 1.15),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  root.add(shadow);

  return {
    root,
    body,
    shadow,
    bounds: template.bounds,
    anchors: template.anchors,
    engine: template.engine,
    animate(state) {
      shadow.position.y = -state.h + 0.08;
    },
  };
}
