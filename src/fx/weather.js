// Stylised weather in the manner of late-90s racers: everything is cheap,
// readable and a bit exaggerated rather than physically simulated.
//  - rain : streak lines that stretch with the camera's motion, splashes on
//           the road, spray behind the cars, droplets on the "lens" (post),
//           a wet glossy road, overcast sky, rain noise
//  - storm: heavier rain + lightning (sky / scene flash) + thunder
//  - snow : chunky square flakes that drift and swirl, wind noise
//  - fog  : thick height fog (the classic draw-distance cover)
//  - clouds: broken cloud cover only
// The clouds themselves are painted into the sky panorama
// (world/skyPainter.js); `cumulus` / `overcast` steer how it is painted.
import * as THREE from 'three';
import { RETRO } from './retro.js';

export const WEATHERS = {
  clear: { label: 'Pogodnie', overcast: 0, cover: 0, fogMul: 1, cumulus: true },
  clouds: { label: 'Pochmurno', overcast: 0.3, cover: -0.12, fogMul: 1.2, cumulus: true },
  rain: { label: 'Deszcz', overcast: 0.7, cover: -0.3, fogMul: 1.6, rain: 1, wet: 1, cumulus: true },
  storm: { label: 'Burza', overcast: 0.85, cover: -0.38, fogMul: 1.8, rain: 1.5, wet: 1, lightning: true, cumulus: true },
  snow: { label: 'Śnieg', overcast: 0.55, cover: -0.28, fogMul: 2.2, snow: 1, cumulus: true },
  fog: { label: 'Mgła', overcast: 0.45, cover: -0.15, fogMul: 4.5, cumulus: false },
};
const BY_SEED = ['clear', 'clouds', 'clear', 'rain', 'clouds', 'snow', 'storm', 'fog', 'clear'];

/** Pick the weather: explicit name > per-seed default. */
export function resolveWeather(name, seed = 1) {
  if (name && WEATHERS[name]) return name;
  return BY_SEED[(seed * 7 + 3) % BY_SEED.length];
}

// Live state read by car FX / post (one weather at a time).
export const WEATHER = { name: 'clear', rain: 0, snow: 0, wet: 0, flash: 0, flare: 1 };

// Change a time-of-day preset (already cloned) for the weather.
export function weatherTime(T, name) {
  const W = WEATHERS[name] || WEATHERS.clear;
  const o = W.overcast;
  const grey = (v, k) => {
    const l = (v.x + v.y + v.z) / 3;
    v.set(v.x + (l - v.x) * k, v.y + (l - v.y) * k, v.z + (l - v.z) * k);
  };
  if (o > 0) {
    for (const k of ['horizon', 'low', 'mid', 'zenith']) {
      grey(T.sky[k], o * 0.85);
      T.sky[k].multiplyScalar(1 - o * 0.35);
    }
    grey(T.cloudLit, o * 0.6);
    T.cloudLit.multiplyScalar(1 - o * 0.4);
    T.cloudDark.multiplyScalar(1 - o * 0.3);
    T.cloudRim.multiplyScalar(1 - o);
    T.halo.multiplyScalar(1 - o * 0.8);
    T.sunDisc.multiplyScalar(1 - o * 0.9);
    T.stars *= 1 - o;
    T.retroSun *= o > 0.5 ? 0 : 1;
    T.sun.intensity *= 1 - o * 0.65;
    T.hemi.intensity *= 1 - o * 0.15;
    const l = T.fog.r * 0.3 + T.fog.g * 0.59 + T.fog.b * 0.11;
    T.fog.lerp(new THREE.Color(l, l, l * 1.05), o * 0.7);
  }
  T.cloudCover = Math.max(0.12, T.cloudCover + W.cover);
  T.fogDensity *= W.fogMul;
  if (W.snow) {
    T.fog.lerp(new THREE.Color(0.75, 0.78, 0.84), 0.5);
    T.ground = '#8d8f94';
  }
  if (W.wet) T.ground = '#3a3a3c';
  return T;
}

// ---------------------------------------------------------------------------
const flakeVert = /* glsl */ `
  attribute float aSize;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 1.0, uScale / 160.0);
  }`;
const flakeFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uSquare;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    // square flakes in the PSX style, round otherwise
    if (uSquare < 0.5 && dot(p, p) > 1.0) discard;
    gl_FragColor = vec4(uColor, 0.9);
  }`;

export class Weather {
  /**
   * @param {THREE.Object3D} parent
   * @param {string} name
   * @param {{T: object, center: THREE.Vector3, radius: number, sunDir: THREE.Vector3}} ctx
   */
  constructor(parent, name, { T, center, radius, sunDir }) {
    this.name = name;
    this.W = WEATHERS[name] || WEATHERS.clear;
    this.T = T;
    this.group = new THREE.Group();
    this.group.name = 'weather';
    parent.add(this.group);
    this.time = 0;
    this.flash = 0;
    this.nextStrike = 4 + Math.random() * 6;
    this.strikes = [];
    WEATHER.name = name;
    WEATHER.rain = this.W.rain || 0;
    WEATHER.snow = this.W.snow || 0;
    WEATHER.wet = this.W.wet || 0;
    WEATHER.flash = 0;
    WEATHER.flare = 1 - (this.W.overcast || 0) * 1.1;
    if (this.W.rain) this._rain();
    if (this.W.snow) this._snow();
    this._v = new THREE.Vector3();
  }

  // ---- rain: streaks in a box that wraps around the camera
  _rain() {
    const n = Math.round(1700 * this.W.rain);
    this.box = new THREE.Vector3(46, 26, 46);
    this.drops = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.drops[i * 3] = Math.random() * this.box.x;
      this.drops[i * 3 + 1] = Math.random() * this.box.y;
      this.drops[i * 3 + 2] = Math.random() * this.box.z;
    }
    const pos = new Float32Array(n * 6);
    const col = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const k = 0.55 + Math.random() * 0.45;
      col.set([0.62 * k, 0.68 * k, 0.78 * k, 0.85 * k, 0.9 * k, 1.0 * k], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.rainPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.rainPos);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.group.add(this.rain);
    this.wind = new THREE.Vector3(3 + Math.random() * 3, 0, 2);
  }

  // ---- snow: chunky flakes, wobbling as they fall
  _snow() {
    const n = 2600;
    this.box = new THREE.Vector3(60, 34, 60);
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    this.flakes = new Float32Array(n * 4); // x y z phase (box space)
    for (let i = 0; i < n; i++) {
      this.flakes.set([Math.random() * this.box.x, Math.random() * this.box.y, Math.random() * this.box.z, Math.random() * 6.28], i * 4);
      size[i] = 0.07 + Math.random() * 0.09;
    }
    const g = new THREE.BufferGeometry();
    this.snowPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.snowPos);
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.snowMat = new THREE.ShaderMaterial({
      vertexShader: flakeVert,
      fragmentShader: flakeFrag,
      uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color(0.95, 0.96, 1.0).multiplyScalar(this.T.exposure >= 1 && this.T.lamps < 0.5 ? 1.1 : 0.75) }, uSquare: { value: RETRO.enabled ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(g, this.snowMat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
    this.wind = new THREE.Vector3(2, 0, 1);
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {{velocity?: THREE.Vector3, vehicle?: object, fx?: object, audio?: object, viewportH?: number}} o
   */
  update(dt, camera, { velocity, vehicle, fx, audio, viewportH = 480 } = {}) {
    this.time += dt;
    const cp = camera.position;
    const vel = velocity || this._v.set(0, 0, 0);
    if (this.rain) {
      const n = this.drops.length / 3;
      const B = this.box;
      const fall = 26;
      const a = this.rainPos.array;
      // the streak shows the drop's motion relative to the camera
      const len = 0.035;
      const rx = (this.wind.x - vel.x) * len;
      const ry = (-fall - vel.y) * len;
      const rz = (this.wind.z - vel.z) * len;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        let y = this.drops[o + 1] - fall * dt;
        if (y < 0) y += B.y;
        this.drops[o + 1] = y;
        this.drops[o] = (this.drops[o] + this.wind.x * dt) % B.x;
        this.drops[o + 2] = (this.drops[o + 2] + this.wind.z * dt) % B.z;
        // wrap into the box around the camera
        const x = cp.x + ((((this.drops[o] - cp.x) % B.x) + B.x) % B.x) - B.x / 2;
        const z = cp.z + ((((this.drops[o + 2] - cp.z) % B.z) + B.z) % B.z) - B.z / 2;
        const yy = cp.y + ((((y - cp.y) % B.y) + B.y) % B.y) - B.y / 2;
        const k = i * 6;
        a[k] = x;
        a[k + 1] = yy;
        a[k + 2] = z;
        a[k + 3] = x - rx;
        a[k + 4] = yy - ry;
        a[k + 5] = z - rz;
      }
      this.rainPos.needsUpdate = true;
      // splashes on the road around the player
      if (vehicle && fx) {
        const fr = vehicle.frame;
        const m = Math.floor(dt * 160 * this.W.rain + Math.random());
        for (let i = 0; i < m; i++) {
          const along = -6 + Math.random() * 46;
          const side = (Math.random() - 0.5) * 26;
          const h = vehicle.h || 0.75;
          fx.emit('splash',
            vehicle.position.x + fr.fwd.x * along + fr.right.x * side - fr.up.x * h,
            vehicle.position.y + fr.fwd.y * along + fr.right.y * side - fr.up.y * h + 0.05,
            vehicle.position.z + fr.fwd.z * along + fr.right.z * side - fr.up.z * h,
            fr.up.x * 2.5 + (Math.random() - 0.5), fr.up.y * 2.5, fr.up.z * 2.5 + (Math.random() - 0.5), 1);
        }
      }
    }
    if (this.snow) {
      const n = this.flakes.length / 4;
      const B = this.box;
      const a = this.snowPos.array;
      const t = this.time;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const ph = this.flakes[o + 3];
        let y = this.flakes[o + 1] - (2.2 + (i % 5) * 0.35) * dt;
        if (y < 0) y += B.y;
        this.flakes[o + 1] = y;
        this.flakes[o] += (this.wind.x + Math.sin(t * 1.3 + ph) * 1.6) * dt;
        this.flakes[o + 2] += (this.wind.z + Math.cos(t * 1.1 + ph * 1.7) * 1.6) * dt;
        a[i * 3] = cp.x + ((((this.flakes[o] - cp.x) % B.x) + B.x) % B.x) - B.x / 2;
        a[i * 3 + 1] = cp.y + ((((y - cp.y) % B.y) + B.y) % B.y) - B.y / 2;
        a[i * 3 + 2] = cp.z + ((((this.flakes[o + 2] - cp.z) % B.z) + B.z) % B.z) - B.z / 2;
      }
      this.snowPos.needsUpdate = true;
      this.snowMat.uniforms.uScale.value = viewportH * 1.2;
    }
    // lightning
    if (this.W.lightning) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = 5 + Math.random() * 9;
        const near = Math.random();
        // two or three flickers
        const k = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < k; i++) this.strikes.push({ t: this.time + i * (0.07 + Math.random() * 0.1), p: 0.6 + near * 0.6 });
        audio?.thunder(near);
      }
      for (const s of this.strikes) if (this.time >= s.t) { this.flash = Math.max(this.flash, s.p); s.done = true; }
      this.strikes = this.strikes.filter((s) => !s.done);
    }
    this.flash = Math.max(0, this.flash - dt * 6);
    WEATHER.flash = this.flash;
    if (audio && !this._audioSet) {
      audio.setWeather({ rain: this.W.rain || 0, wind: this.W.snow ? 0.7 : this.W.lightning ? 0.5 : this.W.rain ? 0.2 : 0 });
      this._audioSet = audio.enabled;
    }
    if (audio && this.W.snow) audio.windGust(0.5 + 0.5 * Math.sin(this.time * 0.3));
  }

  dispose(audio) {
    this.group.removeFromParent();
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    audio?.setWeather({ rain: 0, wind: 0 });
    WEATHER.rain = WEATHER.snow = WEATHER.wet = WEATHER.flash = 0;
    WEATHER.flare = 1;
  }
}
