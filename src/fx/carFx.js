// Per-car visual effects:
//  - exhaust of the 4 downward hover engines built into the models (nozzle
//    glow, flare, short jet that gimbals with throttle / steering, heat glow
//    on the road, wash)
//  - engine(s): EngineFX (engineFx.js) – hot nozzle core, flare, jet plume,
//    light-trail ribbon; lift-off backfire flash
//  - underglow point light, exhaust light (player only)
//  - wall-scrape sparks, boost pickup burst, jump landing dust
import * as THREE from 'three';
import { EngineFX } from './engineFx.js';
import { WEATHER } from './weather.js';

// Hover engines: the car models already carry their four downward engines
// where the wheels used to be, so this file adds no hardware – only the
// exhaust effect at the bottom of each engine: a white-hot nozzle glow with a
// coloured rim (seen from below / the side), a small flare sprite, a short
// hot jet between the nozzle and the road, a heat glow on the road and wash.
const nozzleVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const nozzleFrag = /* glsl */ `
  varying vec2 vUv;
  uniform float uPower;
  uniform vec3 uCol;
  void main() {
    float r = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
    float core = 1.0 - smoothstep(0.0, 0.5, r);
    vec3 col = mix(uCol * 1.6, vec3(2.6, 2.4, 2.1), core * core) * (0.45 + 0.55 * uPower);
    col *= 1.0 - smoothstep(0.75, 1.0, r);
    gl_FragColor = vec4(col, 1.0);
  }`;
// jet: bright at the nozzle (v = 1), fading toward the road, soft at the sides
const jetFrag = /* glsl */ `
  varying vec2 vUv;
  uniform float uPower;
  uniform vec3 uCol;
  void main() {
    float x = abs(vUv.x - 0.5) * 2.0;
    float y = vUv.y;
    float w = mix(0.35, 1.0, y);               // narrows toward the tip
    float side = 1.0 - smoothstep(w * 0.4, w, x);
    float len = smoothstep(1.0 - 0.75 * uPower, 1.0, y);
    float core = (1.0 - smoothstep(0.0, w * 0.35, x)) * y * y;
    vec3 col = mix(uCol * 1.3, vec3(2.4, 2.2, 2.0), core) * side * len * (0.5 + 0.5 * uPower);
    gl_FragColor = vec4(col, 1.0);
  }`;

let shared = null;
function getShared() {
  if (shared) return shared;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const glow = new THREE.CanvasTexture(c);
  const disc = new THREE.CircleGeometry(1, 18);
  disc.rotateX(Math.PI / 2); // faces down
  // two crossed quads hanging down from the nozzle (top edge at y = 0)
  const q1 = new THREE.PlaneGeometry(1, 1);
  q1.translate(0, -0.5, 0);
  const q2 = q1.clone().rotateY(Math.PI / 2);
  const jet = mergeQuads(q1, q2);
  shared = { glow, disc, jet };
  return shared;
}

function mergeQuads(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array;
  const pb = b.attributes.position.array;
  g.setAttribute('position', new THREE.Float32BufferAttribute([...pa, ...pb], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([...a.attributes.uv.array, ...b.attributes.uv.array], 2));
  const ia = [...a.index.array];
  g.setIndex([...ia, ...ia.map((i) => i + pa.length / 3)]);
  return g;
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _back = new THREE.Vector3();
const _side = new THREE.Vector3();

export class CarFX {
  /**
   * @param {object} car   instance from createCarInstance (has body, anchors)
   * @param {FXWorld} fx
   * @param {{player?: boolean}} opts
   */
  constructor(car, fx, { player = false } = {}) {
    this.car = car;
    this.fx = fx;
    this.player = player;
    const S = getShared();
    const body = car.body;
    const { pods, exhausts } = car.anchors;
    this.time = Math.random() * 10;

    // --- hover engine exhaust (effect only, at the bottom of each model engine)
    const r = THREE.MathUtils.clamp((car.bounds?.length || 4.3) * 0.06, 0.18, 0.27);
    const engCol = car.engine?.color || new THREE.Color(0.25, 0.75, 1.0);
    this.nozzleUniforms = { uPower: { value: 1 }, uCol: { value: engCol.clone() } };
    const add = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false };
    const nozzleMat = new THREE.ShaderMaterial({ vertexShader: nozzleVert, fragmentShader: nozzleFrag, uniforms: this.nozzleUniforms, ...add });
    const jetMat = new THREE.ShaderMaterial({ vertexShader: nozzleVert, fragmentShader: jetFrag, uniforms: this.nozzleUniforms, side: THREE.DoubleSide, ...add });
    this.flareMat = new THREE.SpriteMaterial({ map: S.glow, color: engCol.clone().multiplyScalar(1.1), ...add });
    this.engCol = engCol.clone();
    this.flareR = r;
    this.spots = [];
    this.nacelles = [];
    this.flares = [];
    for (const p of pods) {
      const pivot = new THREE.Group(); // gimbal at the nozzle
      pivot.position.copy(p);
      const disc = new THREE.Mesh(S.disc, nozzleMat);
      disc.scale.setScalar(r);
      disc.position.y = -0.01;
      const jet = new THREE.Mesh(S.jet, jetMat);
      jet.scale.set(r * 1.7, 0.55, r * 1.7);
      const flare = new THREE.Sprite(this.flareMat);
      flare.position.y = -0.05;
      flare.scale.setScalar(r * 1.5);
      pivot.add(disc, jet, flare);
      body.add(pivot);
      this.nacelles.push(pivot);
      this.flares.push(flare);
      // faint heat glow on the road under each engine
      const spot = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: S.glow, color: engCol.clone().multiplyScalar(0.9), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(p.x, 0, p.z);
      car.root.add(spot);
      this.spots.push(spot);
    }
    this.tiltX = 0;
    this.tiltZ = 0;
    this.pods = pods;

    // --- engine(s)
    this.exhausts = exhausts;
    this.engine = new EngineFX(body, exhausts, {
      scene: fx.scene,
      size: car.engine?.size ?? 0.22,
      color: car.engine?.color,
      boostColor: car.engine?.boostColor,
    });
    this.prevPipe = exhausts.map(() => null);

    // --- lights
    this.under = new THREE.PointLight(0x4aa8ff, player ? 22 : 14, 8, 2);
    this.under.position.set(0, -0.2, 0);
    car.root.add(this.under);
    if (player) {
      this.exLight = new THREE.PointLight(0x60b0ff, 0, 9, 2);
      this.exLight.position.copy(exhausts[0] || new THREE.Vector3(0, 0.3, -2.6)).add(_v.set(0, 0, -0.8));
      body.add(this.exLight);
    }
    this.prevThrottle = 0;
    this.wasAir = false;
  }

  /**
   * @param {Vehicle} v
   * @param {number} dt
   * @param {number} detail 0..1 – particle budget (distance to camera)
   */
  update(v, dt, detail = 1) {
    this.time += dt;
    const t = this.time;
    const thr = v.throttle;
    const boost = v.boostTimer > 0 ? 1 : 0;
    const speed = v.speed;

    // hover engine exhaust: power, gimbal
    const power = 0.6 + thr * 0.4 + boost * 0.3;
    // smooth flicker (no per-frame random: these lights shine on the road)
    const flick = 0.95 + 0.05 * (Math.sin(t * 31.0) * 0.6 + Math.sin(t * 17.3 + 1.7) * 0.4);
    this.nozzleUniforms.uPower.value = power * flick;
    for (const f of this.flares) f.scale.setScalar(this.flareR * (1.1 + 0.6 * power) * flick);
    const k = 1 - Math.exp(-dt * 6);
    this.tiltX += ((thr * 0.28 - (v.brake || 0) * 0.2) - this.tiltX) * k; // nozzles swing back when accelerating
    this.tiltZ += (-(v.steer || 0) * 0.22 - this.tiltZ) * k;
    for (const n of this.nacelles) n.rotation.set(-this.tiltX, 0, this.tiltZ);
    for (const s of this.spots) {
      s.position.y = -v.h + 0.12;
      s.material.opacity = 0.18 + 0.14 * power;
      s.scale.setScalar(0.7 + 0.08 * Math.sin(t * 20 + s.id));
    }
    this.under.intensity = (this.player ? 16 : 10) * (0.8 + 0.3 * power) * flick;

    // engine
    this.engine.update(dt, { throttle: thr, boost, speed }, this.fx.camera ? this.fx.camera.position : v.position);
    if (this.exLight) {
      this.exLight.color.copy(this.engine.uniforms.uCol.value).lerp(this.engine.uniforms.uBoostCol.value, this.engine.uniforms.uBoost.value);
      // rises / falls smoothly; was ±15 % random noise every frame
      const target = 3 + thr * 6 + boost * 14 + this.engine.flash * 12;
      this.exGlow = (this.exGlow ?? target) + (target - (this.exGlow ?? target)) * Math.min(1, dt * 10);
      this.exLight.intensity = this.exGlow * flick;
    }

    // --- particles (world space)
    const fx = this.fx;
    const body = this.car.body;
    _back.copy(v.heading).negate();
    const vel = v.velocity;
    // backfire on lift-off: nozzle flash + a few hot sparks (no smoke – it's a jet)
    if (this.prevThrottle > 0.7 && thr < 0.3 && speed > 30) {
      this.engine.backfire();
      for (const e of this.exhausts) {
        _b.copy(e);
        body.localToWorld(_b);
        fx.burst('spark', _b, 6, 6, _v.copy(vel).multiplyScalar(0.85));
      }
    }
    // occasional embers off the jet at full power
    if (detail > 0.5 && (thr > 0.8 || boost)) {
      for (const e of this.exhausts) {
        if (Math.random() > dt * (6 + boost * 20)) continue;
        _b.copy(e);
        body.localToWorld(_b);
        fx.emit('ember', _b.x, _b.y, _b.z, vel.x * 0.8 + _back.x * 10 + (Math.random() - 0.5) * 2, vel.y * 0.8 + (Math.random() - 0.5) * 2, vel.z * 0.8 + _back.z * 10 + (Math.random() - 0.5) * 2, 1);
      }
    }
    this.prevThrottle = thr;

    // thruster wash on the road
    if (detail > 0.3) {
      const fr = v.frame;
      for (const p of this.pods) {
        if (Math.random() > dt * 14 * detail) continue;
        _a.copy(p);
        this.car.root.localToWorld(_a);
        _a.addScaledVector(fr.up, -v.h + 0.15);
        _side.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        fx.emit('wash', _a.x, _a.y, _a.z, vel.x * 0.85 + _side.x * 6, vel.y * 0.85 + _side.y * 6, vel.z * 0.85 + _side.z * 6, 1);
        if (speed > 70 && Math.random() < 0.25) {
          fx.emit('dust', _a.x, _a.y, _a.z, vel.x * 0.55 + (Math.random() - 0.5) * 4, vel.y * 0.55 + 1, vel.z * 0.55 + (Math.random() - 0.5) * 4, 1);
        }
      }
    }

    // spray off a wet road, thrown up by the hover engines
    if (WEATHER.wet > 0 && detail > 0.2 && speed > 15 && !v.airborne) {
      const fr = v.frame;
      const rate = dt * (10 + speed * 0.35) * WEATHER.wet * detail;
      for (const p of this.pods) {
        if (p.z > 0 || Math.random() > rate) continue;
        _a.copy(p);
        this.car.root.localToWorld(_a);
        _a.addScaledVector(fr.up, -v.h + 0.2);
        fx.emit('spray', _a.x, _a.y, _a.z,
          vel.x * 0.55 + fr.up.x * 2.5 + (Math.random() - 0.5) * 3, vel.y * 0.55 + fr.up.y * 2.5, vel.z * 0.55 + fr.up.z * 2.5 + (Math.random() - 0.5) * 3, 1);
      }
    }

    // wall scrape sparks
    if (v.scrape > 0.05) {
      const fr = v.frame;
      const side = Math.sign(v.x);
      _a.copy(v.position).addScaledVector(fr.right, side * 1.3).addScaledVector(fr.up, 0.1);
      const n = Math.floor(v.scrape * 60 * dt + Math.random());
      for (let i = 0; i < n * 3; i++) {
        fx.emit('spark', _a.x, _a.y, _a.z,
          vel.x * 0.7 + fr.up.x * 6 * Math.random() - fr.right.x * side * 5 * Math.random() + (Math.random() - 0.5) * 6,
          vel.y * 0.7 + fr.up.y * 6 * Math.random() + Math.random() * 4,
          vel.z * 0.7 + fr.up.z * 6 * Math.random() - fr.right.z * side * 5 * Math.random() + (Math.random() - 0.5) * 6, 1);
      }
    }

    // jump landing
    const air = v.airborne;
    if (this.wasAir && !air) this.landing(v);
    this.wasAir = air;
  }

  boostBurst(v) {
    _a.copy(v.position);
    this.fx.burst('boostBurst', _a, 40, 14, v.velocity);
  }

  impact(v, strength) {
    const fr = v.frame;
    _a.copy(v.position).addScaledVector(fr.right, Math.sign(v.x) * 1.3);
    this.fx.burst('spark', _a, Math.floor(20 + strength * 60), 12 + strength * 10, _v.copy(v.velocity).multiplyScalar(0.6));
    this.fx.burst('smoke', _a, 4, 2, _v.copy(v.velocity).multiplyScalar(0.4), 1.2);
  }

  landing(v) {
    const fr = v.frame;
    _a.copy(v.position).addScaledVector(fr.up, -v.h);
    this.fx.burst('dust', _a, 14, 7, _v.copy(v.velocity).multiplyScalar(0.6), 1.5);
    this.fx.burst('spark', _a, 30, 10, _v.copy(v.velocity).multiplyScalar(0.7));
  }

  dispose() {
    this.engine.dispose();
    this.under.removeFromParent();
    this.exLight?.removeFromParent();
  }
}
