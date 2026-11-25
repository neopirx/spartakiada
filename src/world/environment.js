// Retro-futurist PRL city around the track: sky for the time of day,
// the trackside street city (city.js), a background skyline and landmarks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../track/generator.js';
import * as TX from './textures.js';
import { SUN_DIR, FOG, createSky, createSun, applyTimeOfDay } from './atmosphere.js';
import { Weather, WEATHERS, resolveWeather, weatherTime } from '../fx/weather.js';
import { paintSkyPanorama } from './skyPainter.js';
import { City, CITY_THEMES } from './city.js';
import { BAY, FLOOR, GROUND, roofTexture, streetTexture } from './facades.js';
import { photoTexture, PHOTO } from './photoTextures.js';
import { brutalFacade } from './brutal.js';

// skyline building style -> brutalist façade
const SKY_FACADE = { blok: 'panel', wiezowiec: 'fins', socrealizm: 'waffle', kamienica: 'ribbon', futuro: 'waffle', hala: 'hall' };
import { ASSETS, instanceAsset, placeMatrix } from './assets.js';

const TIMES_BY_SEED = ['day', 'dusk', 'night', 'day'];

export class Environment {
  constructor(scene, track, seed = 1, { time, city, weather } = {}) {
    this.scene = scene;
    this.track = track;
    this.seed = seed;
    this.rng = mulberry32(seed * 31 + 7);
    this.timeName = time || TIMES_BY_SEED[seed % TIMES_BY_SEED.length];
    this.weatherName = resolveWeather(weather, seed);
    this.T = applyTimeOfDay(this.timeName, (T) => weatherTime(T, this.weatherName));
    const themes = Object.keys(CITY_THEMES);
    this.cityTheme = city || themes[seed % themes.length];
    this.group = new THREE.Group();
    this.group.name = 'environment';
    this.blinkers = [];
    scene.add(this.group);

    this.center = track.bounds.getCenter(new THREE.Vector3());
    const size = track.bounds.getSize(new THREE.Vector3());
    this.radius = Math.max(size.x, size.z) * 0.5 + 200;

    this._buildSpatialHash();
    this._sky();
    this._lights();
    this._ground();
    this.city = new City(track, { rng: this.rng, theme: this.cityTheme, time: this.T });
    this.group.add(this.city.group);
    this._skyline();
    this._landmarks();
    this.weather = new Weather(this.group, this.weatherName, { T: this.T, center: this.center, radius: this.radius, sunDir: this.sunDir });
  }

  dispose(audio) {
    this.weather?.dispose(audio);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.scene.fog = null;
  }

  _buildSpatialHash() {
    const cell = 40;
    this.hash = new Map();
    this.hashCell = cell;
    const t = this.track;
    for (let i = 0; i < t.count; i += 3) {
      const x = t.pos[i * 3];
      const z = t.pos[i * 3 + 2];
      const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(x, z);
    }
  }

  // true if any track point lies within r of (x, z)
  nearTrack(x, z, r) {
    const c = this.hashCell;
    const n = Math.ceil(r / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const arr = this.hash.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const dx = arr[k] - x;
          const dz = arr[k + 1] - z;
          if (dx * dx + dz * dz < r * r) return true;
        }
      }
    }
    return false;
  }

  _sky() {
    this.sunDir = SUN_DIR;
    // painted retro panorama around the horizon; the procedural cloud deck
    // only stays for overcast weathers
    const W = WEATHERS[this.weatherName] || WEATHERS.clear;
    const pano = paintSkyPanorama(this.T, W, SUN_DIR, this.seed || 1);
    const sky = createSky({ pano, fbm: (W.overcast || 0) > 0.5 ? 1 : 0 });
    this.skyMat = sky.material;
    this.group.add(sky.mesh);
    this.scene.fog = new THREE.FogExp2(FOG.color, FOG.density);
  }

  _lights() {
    const T = this.T;
    const hemi = new THREE.HemisphereLight(T.hemi.sky, T.hemi.ground, T.hemi.intensity);
    this.group.add(hemi);
    this.hemi = hemi;
    this.hemiBase = T.hemi.intensity;
    this.sun = createSun();
    this.group.add(this.sun.light, this.sun.target);
    this.sun.follow(this.center);
    const fill = new THREE.DirectionalLight(T.fill.color, T.fill.intensity);
    fill.position.set(300, 800, 400);
    this.group.add(fill);
  }

  _ground() {
    // concrete slab ground (photo), tinted by the time of day's ground colour;
    // the procedural asphalt is the fallback
    const photo = photoTexture('floor');
    let mat;
    if (photo) {
      const t = photo.clone();
      t.repeat.set(16000 / PHOTO.floor.size[0], 16000 / PHOTO.floor.size[1]);
      // photo averages ~0.155 linear: scale so it lands a bit above the old asphalt
      mat = new THREE.MeshLambertMaterial({ map: t, color: new THREE.Color(this.T.ground).multiplyScalar(8) });
    } else {
      const t = streetTexture(this.T.ground);
      t.repeat.set(16000 / 14, 16000 / 14);
      mat = new THREE.MeshLambertMaterial({ map: t });
    }
    const g = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), mat);
    g.receiveShadow = true;
    g.rotation.x = -Math.PI / 2;
    g.position.set(this.center.x, CONFIG.track.groundY, this.center.z);
    this.group.add(g);
  }

  // Background blocks behind the trackside rows: a dense skyline seen
  // through side streets and over the roofs. Batched with the city materials.
  _skyline() {
    const rnd = this.rng;
    const gy = CONFIG.track.groundY;
    const R0 = this.radius;
    const placed = this.city.footprints.slice();
    const styles = ['blok', 'blok', 'wiezowiec', 'socrealizm', 'kamienica', 'futuro', 'hala'];
    const buckets = new Map();
    const push = (key, data) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(data);
    };
    for (let i = 0; i < 1400; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() < 0.6 ? rnd() * R0 * 1.1 : R0 * 1.1 + rnd() * R0 * 1.4;
      const x = this.center.x + Math.cos(a) * r;
      const z = this.center.z + Math.sin(a) * r;
      const style = styles[Math.floor(rnd() * styles.length)];
      const tall = style === 'wiezowiec' || rnd() < 0.15;
      const w = (4 + Math.floor(rnd() * 10)) * BAY;
      const d = 12 + rnd() * 10;
      const reach = Math.hypot(w, d) / 2;
      if (this.nearTrack(x, z, reach + 38)) continue;
      let ok = true;
      for (const p of placed) {
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz < (p.r + reach) * (p.r + reach) * 0.8) { ok = false; break; }
      }
      if (!ok) continue;
      placed.push({ x, z, r: reach });
      const yaw = Math.round(rnd() * 4) * (Math.PI / 2) + (rnd() < 0.15 ? Math.PI / 4 : 0);
      // brutalist concrete, bucketed by façade and variant
      const floors = tall ? 12 + Math.floor(rnd() * 16) : 4 + Math.floor(rnd() * 9);
      push(`${SKY_FACADE[style]}:${1 + Math.floor(rnd() * 3)}`, { x, z, w, d, h: GROUND + floors * FLOOR, yaw });
    }
    this._parks(placed);
    const T = this.T;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const roof = new THREE.MeshLambertMaterial({ map: roofTexture() });
    for (const [bucket, list] of buckets) {
      const [style, seed] = bucket.split(':');
      const tx = brutalFacade(style, +seed);
      // per-instance UV scale is not available, so scale UVs per bucket by the mean size
      const mw = list.reduce((s, b) => s + b.w, 0) / list.length;
      const mh = list.reduce((s, b) => s + b.h, 0) / list.length;
      const md = list.reduce((s, b) => s + b.d, 0) / list.length;
      const mk = (span) => {
        const m = tx.map.clone();
        const e = tx.emissive.clone();
        for (const t of [m, e]) {
          t.repeat.set(span / (4 * BAY), mh / (4 * FLOOR));
          t.needsUpdate = true;
        }
        return new THREE.MeshLambertMaterial({ map: m, emissiveMap: e, emissive: 0xffffff, emissiveIntensity: T.windows });
      };
      const xFace = mk(md);
      const zFace = mk(mw);
      const mesh = new THREE.InstancedMesh(box, [xFace, xFace, roof, roof, zFace, zFace], list.length);
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      list.forEach((b, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
        mesh.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(b.x, gy, b.z), q, new THREE.Vector3(b.w, b.h, b.d)));
        mesh.setColorAt(k, c.setHSL(0.07 + rnd() * 0.06, 0.02 + rnd() * 0.06, 0.66 + rnd() * 0.22));
      });
      this.group.add(mesh);
    }
  }

  // clumps of trees in the open ground between the background blocks
  _parks(placed) {
    if (!ASSETS || !Object.keys(ASSETS.trees).length) return;
    const rnd = this.rng;
    const ids = Object.keys(ASSETS.trees);
    const by = new Map();
    const gy = CONFIG.track.groundY;
    const lawns = [];
    for (let c = 0; c < 70; c++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * this.radius * 1.4;
      const px = this.center.x + Math.cos(a) * r;
      const pz = this.center.z + Math.sin(a) * r;
      const n = 3 + Math.floor(rnd() * 8);
      let planted = 0;
      for (let i = 0; i < n; i++) {
        const x = px + (rnd() - 0.5) * 30;
        const z = pz + (rnd() - 0.5) * 30;
        if (this.nearTrack(x, z, 30)) continue;
        let ok = true;
        for (const p of placed) {
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz < (p.r + 4) * (p.r + 4)) { ok = false; break; }
        }
        if (!ok) continue;
        const id = ids[Math.floor(rnd() * ids.length)];
        if (!by.has(id)) by.set(id, []);
        by.get(id).push(placeMatrix(x, gy, z, rnd() * 6.28, 0.85 + rnd() * 0.35));
        planted++;
      }
      if (planted) lawns.push({ x: px, z: pz, r: 22 + (c % 3) * 3 });
    }
    for (const [id, list] of by) for (const m of instanceAsset(ASSETS.trees[id], list)) this.group.add(m);
    // a lawn under every clump that got trees
    const grass = photoTexture('grass');
    if (grass && lawns.length) {
      const geos = lawns.map((l) => {
        const { x, z, r } = l;
        const g = new THREE.CircleGeometry(r, 20);
        g.rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        const pos = g.attributes.position;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, (pos.getX(k) + x) / PHOTO.grass.size[0], -(pos.getZ(k) + z) / PHOTO.grass.size[1]);
        g.translate(x, gy + 0.04 + (lawns.indexOf(l) % 4) * 0.01, z);
        return g;
      });
      const lawn = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ map: grass, color: new THREE.Color().setScalar(Math.min(1.6, (1.6 * new THREE.Color(this.T.ground).getHSL({}).l) / 0.36)), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      lawn.receiveShadow = true;
      this.group.add(lawn);
    }
  }

  _landmarks() {
    const gy = CONFIG.track.groundY;
    const R = this.radius;
    const c = this.center;
    const place = (obj, angle, dist) => {
      obj.position.set(c.x + Math.cos(angle) * dist, gy, c.z + Math.sin(angle) * dist);
      this.group.add(obj);
    };
    // Socialist-realist spire tower towards the sunset
    const sunAng = Math.atan2(this.sunDir.z, this.sunDir.x);
    place(spireTower(), sunAng + 0.35, R + 700);
    place(saucerArena(), sunAng + 2.2, R + 350);
    const mast = tvMast();
    place(mast.group, sunAng - 1.6, R + 900);
    this.blinkers.push(...mast.blinkers);
    for (let i = 0; i < 6; i++) {
      const ch = chimney(this.rng);
      place(ch.group, sunAng + 3.4 + i * 0.12, R + 500 + i * 60);
      this.blinkers.push(...ch.blinkers);
    }
  }

  // keep the shadow frustum around the focus (player)
  follow(pos) {
    this.sun.follow(pos);
  }

  update(dt, time) {
    this.skyMat.uniforms.uTime.value = time;
    const flash = this.weather ? this.weather.flash : 0;
    this.skyMat.uniforms.uFlash.value = flash;
    this.hemi.intensity = this.hemiBase + flash * 3.5;
    this.city.update(time);
    for (const b of this.blinkers) {
      if (b.kind === 'flicker') {
        const on = Math.sin(time * 13 + b.phase) + Math.sin(time * 7.3 + b.phase * 2) > -1.2;
        b.mat.color.setScalar(on ? 2 : 0.25);
      } else if (b.kind === 'beacon') {
        b.mat.color.setRGB(Math.sin(time * 3 + b.phase) > 0.2 ? 4 : 0.3, 0, 0);
      }
    }
  }
}

// ---------------------------------------------------------------------------
function spireTower() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9b79a, roughness: 0.8, emissive: 0x2a1a10 });
  const winTex = TX.blockTextures(6, 12, 99);
  const tiers = [
    [140, 70, 140], [100, 60, 100], [70, 60, 70], [46, 50, 46], [30, 40, 30],
  ];
  let y = 0;
  for (const [w, h, d] of tiers) {
    const m = winTex.map.clone(); m.repeat.set(w / 20, h / 25); m.needsUpdate = true;
    const e = winTex.emissive.clone(); e.repeat.copy(m.repeat); e.needsUpdate = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: m, emissiveMap: e, emissive: 0xffffff, emissiveIntensity: 1.2, color: 0xe0d0b8 }));
    b.position.y = y + h / 2;
    g.add(b);
    // corner pinnacles
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.ConeGeometry(3, 18, 6), mat);
      p.position.set((sx * w) / 2, y + h + 9, (sz * d) / 2);
      g.add(p);
    }
    y += h;
  }
  const spire = new THREE.Mesh(new THREE.ConeGeometry(10, 110, 8), mat);
  spire.position.y = y + 55;
  g.add(spire);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.2, 0.6), toneMapped: false }));
  tip.position.y = y + 112;
  g.add(tip);
  return g;
}

function saucerArena() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(120, 50, 45, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
  );
  body.position.y = 40;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(118, 120, 4, 48), new THREE.MeshStandardMaterial({ color: 0x6f747a, metalness: 0.6, roughness: 0.4 }));
  roof.position.y = 63;
  g.add(roof);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(120, 1.6, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3.2), toneMapped: false }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 61;
  g.add(rim);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(50, 56, 18, 32), new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.9 }));
  base.position.y = 9;
  g.add(base);
  return g;
}

function tvMast() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.4, roughness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc02020, metalness: 0.4, roughness: 0.5 });
  const blinkers = [];
  for (let i = 0; i < 12; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(3 - i * 0.2, 3.2 - i * 0.2, 30, 6), i % 2 ? red : mat);
    seg.position.y = 15 + i * 30;
    g.add(seg);
    if (i % 3 === 2) {
      const lm = new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false });
      const l = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), lm);
      l.position.y = 30 + i * 30;
      g.add(l);
      blinkers.push({ mat: lm, phase: i * 0.5, kind: 'beacon' });
    }
  }
  return { group: g, blinkers };
}

function chimney(rng) {
  const g = new THREE.Group();
  const h = 110 + rng() * 80;
  const blinkers = [];
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(6 - i * 0.5, 6.5 - i * 0.5, h / segs, 16),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xb52a22 : 0xe2ddd2, roughness: 0.8 }),
    );
    seg.position.y = (h / segs) * (i + 0.5);
    g.add(seg);
  }
  const lm = new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false });
  const l = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), lm);
  l.position.y = h + 2;
  g.add(l);
  blinkers.push({ mat: lm, phase: rng() * 6, kind: 'beacon' });
  // smoke puffs
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x7a5a60, transparent: true, opacity: 0.35, depthWrite: false });
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(10 + i * 5, 10, 8), smokeMat);
    p.position.set(i * 14, h + 10 + i * 10, i * 4);
    g.add(p);
  }
  return { group: g, blinkers };
}
