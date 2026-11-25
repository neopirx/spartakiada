// World-space GPU-drawn particle system (CPU simulated, one draw call per
// blend mode). Each particle follows a "profile" that defines its colour and
// size over life, drag and gravity.
import * as THREE from 'three';

const vert = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  attribute float aSoft;
  varying vec4 vColor;
  varying float vSoft;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vSoft = aSoft;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  }`;

const frag = /* glsl */ `
  varying vec4 vColor;
  varying float vSoft;
  uniform float uAdditive;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    // soft round puff; vSoft -> 0 = hard spark, 1 = soft smoke
    float a = mix(1.0 - smoothstep(0.15, 1.0, r), exp(-r * 3.0), vSoft);
    vec4 c = vec4(vColor.rgb, vColor.a * a);
    if (uAdditive > 0.5) gl_FragColor = vec4(c.rgb * c.a, c.a);
    else gl_FragColor = c;
  }`;

function lerpStops(stops, t, out) {
  // stops: [[t, r, g, b, a], ...]
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const k = Math.min(1, Math.max(0, (t - a[0]) / Math.max(1e-6, b[0] - a[0])));
  out[0] = a[1] + (b[1] - a[1]) * k;
  out[1] = a[2] + (b[2] - a[2]) * k;
  out[2] = a[3] + (b[3] - a[3]) * k;
  out[3] = a[4] + (b[4] - a[4]) * k;
  return out;
}

export const PROFILES = {
  // rain: tiny splash crowns on the road, mist thrown up behind the cars
  splash: { alpha: true, life: [0.12, 0.22], size: [0.18, 0.05], drag: 2, gravity: -9, soft: 0.2,
    color: [[0, 0.85, 0.9, 1.0, 0.7], [1, 0.8, 0.85, 0.95, 0]] },
  spray: { alpha: true, life: [0.3, 0.6], size: [0.5, 2.2], drag: 2.2, gravity: 0.3, soft: 1,
    color: [[0, 0.5, 0.53, 0.6, 0.0], [0.15, 0.5, 0.53, 0.6, 0.16], [1, 0.45, 0.48, 0.55, 0]] },
  // hot exhaust flame puffs: white-blue core -> orange -> deep red
  flame: { life: [0.08, 0.16], size: [0.22, 0.6], drag: 3, gravity: 0, soft: 0.6,
    color: [[0, 1.2, 1.3, 2.0, 0.8], [0.15, 1.8, 0.9, 0.3, 0.6], [0.55, 1.2, 0.25, 0.06, 0.3], [1, 0.3, 0.04, 0.02, 0]] },
  boostFlame: { life: [0.12, 0.24], size: [0.35, 1.0], drag: 2.5, gravity: 0, soft: 0.6,
    color: [[0, 1.3, 1.7, 2.6, 0.8], [0.2, 0.8, 1.1, 2.4, 0.6], [0.6, 1.4, 0.4, 1.0, 0.3], [1, 0.3, 0.05, 0.2, 0]] },
  heat: { life: [0.2, 0.35], size: [0.3, 0.9], drag: 2, gravity: 1, soft: 1,
    color: [[0, 0.5, 0.2, 0.08, 0.2], [1, 0.12, 0.04, 0.02, 0]] },
  smoke: { alpha: true, life: [0.8, 1.6], size: [0.5, 2.8], drag: 1.6, gravity: 1.2, soft: 1,
    color: [[0, 0.22, 0.2, 0.22, 0.0], [0.1, 0.2, 0.18, 0.2, 0.32], [1, 0.35, 0.3, 0.33, 0]] },
  spark: { life: [0.25, 0.6], size: [0.22, 0.08], drag: 1.2, gravity: -14, soft: 0,
    color: [[0, 4, 3.2, 1.6, 1], [0.4, 3.5, 1.4, 0.3, 1], [1, 1.2, 0.2, 0.05, 0]] },
  // hot sparks shed by the jet: tiny, fast-fading, engine-tinted
  ember: { life: [0.08, 0.2], size: [0.14, 0.03], drag: 2, gravity: 0, soft: 0.1,
    color: [[0, 2.5, 2.8, 3.2, 1], [0.5, 0.8, 1.6, 3.0, 0.8], [1, 0.2, 0.4, 1.2, 0]] },
  backfire: { life: [0.06, 0.12], size: [0.7, 1.4], drag: 4, gravity: 0, soft: 0.5,
    color: [[0, 4, 3, 1.5, 1], [1, 2.5, 0.6, 0.1, 0]] },
  wash: { life: [0.15, 0.3], size: [0.25, 0.9], drag: 3, gravity: 0, soft: 1,
    color: [[0, 0.15, 0.45, 1.0, 0.35], [1, 0.03, 0.08, 0.3, 0]] },
  dust: { alpha: true, life: [0.4, 0.8], size: [0.4, 2.0], drag: 2.5, gravity: 0.6, soft: 1,
    color: [[0, 0.5, 0.42, 0.4, 0.22], [1, 0.4, 0.34, 0.33, 0]] },
  boostBurst: { life: [0.3, 0.6], size: [0.35, 0.05], drag: 2, gravity: 0, soft: 0.3,
    color: [[0, 4, 3, 0.8, 1], [0.5, 3.5, 0.8, 0.3, 0.8], [1, 1, 0.1, 0.05, 0]] },
};

export class ParticleSystem {
  constructor(max = 6000, additive = true) {
    this.max = max;
    this.additive = additive;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.soft = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.prof = new Array(max);
    this.sizeMul = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSoft = new THREE.BufferAttribute(this.soft, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aSoft', this.aSoft);
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 600 }, uAdditive: { value: additive ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      toneMapped: false,
    });
    if (additive) {
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
    }
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
    this._c = [0, 0, 0, 0];
  }

  setViewport(height, fovDeg) {
    // pixel size of a 1 m particle at 1 m distance
    this.uniforms.uScale.value = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(profile, x, y, z, vx, vy, vz, sizeMul = 1) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const p = PROFILES[profile];
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = p.life[0] + Math.random() * (p.life[1] - p.life[0]);
    this.prof[i] = p;
    this.sizeMul[i] = sizeMul;
    this.soft[i] = p.soft;
  }

  update(dt) {
    const c = this._c;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const last = --this.count;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[last * 3 + k];
            this.vel[i * 3 + k] = this.vel[last * 3 + k];
          }
          this.age[i] = this.age[last];
          this.life[i] = this.life[last];
          this.prof[i] = this.prof[last];
          this.sizeMul[i] = this.sizeMul[last];
          this.soft[i] = this.soft[last];
        }
        continue;
      }
      const p = this.prof[i];
      const t = this.age[i] / this.life[i];
      const d = Math.exp(-p.drag * dt);
      const o = i * 3;
      this.vel[o] *= d;
      this.vel[o + 1] = this.vel[o + 1] * d + p.gravity * dt;
      this.vel[o + 2] *= d;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      lerpStops(p.color, t, c);
      this.col[i * 4] = c[0];
      this.col[i * 4 + 1] = c[1];
      this.col[i * 4 + 2] = c[2];
      this.col[i * 4 + 3] = c[3];
      this.size[i] = (p.size[0] + (p.size[1] - p.size[0]) * t) * this.sizeMul[i];
      i++;
    }
    const n = this.count;
    this.points.geometry.setDrawRange(0, n);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aSoft]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
  }
}

// Additive + alpha systems used by the game.
export class FXWorld {
  constructor(scene) {
    this.glow = new ParticleSystem(7000, true);
    this.smoke = new ParticleSystem(2500, false);
    scene.add(this.smoke.points, this.glow.points);
    this.scene = scene;
  }

  emit(profile, ...args) {
    (PROFILES[profile].alpha ? this.smoke : this.glow).emit(profile, ...args);
  }

  burst(profile, pos, count, speed, baseVel = null, sizeMul = 1) {
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.emit(profile, pos.x, pos.y, pos.z,
        r * Math.cos(th) * sp + (baseVel ? baseVel.x : 0),
        u * sp + (baseVel ? baseVel.y : 0),
        r * Math.sin(th) * sp + (baseVel ? baseVel.z : 0), sizeMul);
    }
  }

  setViewport(h, fov) {
    this.glow.setViewport(h, fov);
    this.smoke.setViewport(h, fov);
  }

  update(dt) {
    this.glow.update(dt);
    this.smoke.update(dt);
  }

  dispose() {
    this.scene.remove(this.glow.points, this.smoke.points);
  }
}
