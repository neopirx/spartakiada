// Anti-grav racer engine, in the manner of the classic futuristic racers:
//  - nozzle core: white-hot disc with a coloured rim, flashes on backfire
//  - flare: camera-facing glow with a horizontal anamorphic streak
//  - plume: a short, tight jet cone with a hot core, travelling noise and
//    shock diamonds on boost (no campfire flames, no smoke)
//  - light trail: a long ribbon left behind in world space that fades with
//    age and grows with speed – the signature "light streak" of the genre
import * as THREE from 'three';

const plumeVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const plumeFrag = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  uniform float uTime, uPower, uBoost;
  uniform vec3 uCol, uBoostCol;
  float hash(float n){ return fract(sin(n) * 43758.5453); }
  float noise(float x){ float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    float along = clamp(1.0 - vUv.y, 0.0, 1.0); // 0 at the nozzle
    float facing = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float core = pow(facing, 3.0);           // bright centre line
    float body = pow(facing, 1.2);
    float flow = 0.75 + 0.25 * noise(along * 9.0 - uTime * 55.0 + vUv.x * 3.0);
    float fall = pow(1.0 - along, 1.6);
    // shock diamonds: bright pinches along the jet, stronger on boost
    float diamonds = smoothstep(0.55, 1.0, sin(along * 22.0 - uTime * 8.0)) * (0.35 + uBoost * 0.9) * (1.0 - along);
    vec3 col = mix(uCol, uBoostCol, uBoost);
    vec3 hot = vec3(1.0, 0.97, 0.92) * 3.2;
    vec3 c = mix(col * 2.2, hot, clamp(core * (1.0 - along * 1.3) + diamonds, 0.0, 1.0));
    float a = (body * 0.3 + core * 0.7 + diamonds) * fall * flow * uPower * 0.8;
    a = max(a, 0.0);
    gl_FragColor = vec4(c * a, a);
  }`;

const coreFrag = /* glsl */ `
  varying vec2 vUv;
  uniform float uPower, uBoost, uFlash;
  uniform vec3 uCol, uBoostCol;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    vec3 col = mix(uCol, uBoostCol, uBoost);
    float hot = 1.0 - smoothstep(0.0, 0.62, r);
    float rim = smoothstep(0.45, 0.8, r) * (1.0 - smoothstep(0.85, 1.0, r));
    vec3 c = vec3(1.0, 0.98, 0.95) * hot * (2.5 + uFlash * 4.0) + col * rim * 2.5;
    float a = clamp((hot + rim) * (0.55 + uPower * 0.6), 0.0, 1.0);
    gl_FragColor = vec4(c * a, a);
  }`;

const trailVert = /* glsl */ `
  attribute float aFade;
  attribute float aSide;
  varying float vFade;
  varying float vSide;
  varying float vDepth;
  void main() {
    vFade = aFade;
    vSide = aSide;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const trailFrag = /* glsl */ `
  varying float vFade;
  varying float vSide;
  varying float vDepth;
  uniform vec3 uCol, uBoostCol;
  uniform float uBoost, uAlpha;
  void main() {
    float x = abs(vSide);
    float core = 1.0 - smoothstep(0.0, 0.35, x);
    float glow = 1.0 - smoothstep(0.2, 1.0, x);
    vec3 col = mix(uCol, uBoostCol, uBoost);
    vec3 c = col * glow * 1.6 + vec3(1.0, 0.97, 0.94) * core * 1.4 * vFade;
    float a = (glow * 0.6 + core * 0.6) * vFade * uAlpha * smoothstep(3.0, 12.0, vDepth);
    gl_FragColor = vec4(c * a, a);
  }`;

function additive(vertexShader, fragmentShader, uniforms, side = THREE.DoubleSide) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side,
    toneMapped: false,
    defines: { PSX_NO_SNAP: 1 },
  });
}

let shared = null;
function getShared() {
  if (shared) return shared;
  // flare: soft round glow + thin horizontal streak
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 32, 0, 128, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(96, 0, 64, 64);
  const lin = g.createLinearGradient(0, 0, 256, 0);
  lin.addColorStop(0, 'rgba(255,255,255,0)');
  lin.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  lin.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lin;
  g.fillRect(0, 30, 256, 4);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(16, 28, 224, 8);
  const flare = new THREE.CanvasTexture(c);
  // plume: cone along -Z from the nozzle, uv.y = 1 at the nozzle
  const plume = new THREE.CylinderGeometry(1, 0.15, 1, 16, 8, true);
  plume.translate(0, -0.5, 0);
  plume.rotateX(Math.PI / 2);
  const disc = new THREE.PlaneGeometry(2, 2);
  disc.rotateY(Math.PI); // faces -Z (backwards)
  shared = { flare, plume, disc };
  return shared;
}

const TRAIL_PTS = 28;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

class Trail {
  constructor(scene, uniforms) {
    this.pts = [];
    const n = TRAIL_PTS;
    this.pos = new Float32Array(n * 2 * 3);
    this.fade = new Float32Array(n * 2);
    this.sideA = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      this.sideA[i * 2] = -1;
      this.sideA[i * 2 + 1] = 1;
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aFade = new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aFade', this.aFade);
    g.setAttribute('aSide', new THREE.BufferAttribute(this.sideA, 1));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, additive(trailVert, trailFrag, uniforms));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  // push the current nozzle position; keep `life` seconds of history
  update(p, t, life, width, camPos) {
    const pts = this.pts;
    const last = pts[pts.length - 1];
    if (!last || last.p.distanceToSquared(p) > 0.25 || t - last.t > 0.03) pts.push({ p: p.clone(), t });
    else last.p.copy(p);
    while (pts.length > TRAIL_PTS || (pts.length > 2 && t - pts[0].t > life)) pts.shift();
    const n = pts.length;
    const pos = this.pos;
    const fade = this.fade;
    for (let i = 0; i < TRAIL_PTS; i++) {
      const k = Math.min(i, n - 1);
      const q = pts[n - 1 - k]; // i = 0 -> newest (at the nozzle)
      const age = Math.min(1, (t - q.t) / life);
      const prev = pts[Math.max(0, n - 2 - k)].p;
      const next = pts[Math.min(n - 1, n - k)].p;
      _t.subVectors(next, prev);
      if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
      _v.subVectors(camPos, q.p);
      _s.crossVectors(_t, _v).normalize();
      const f = i >= n ? 0 : (1 - age) * (1 - age) * Math.min(1, i / 2 + 0.3);
      const w = width * (0.35 + 0.65 * (1 - age));
      _a.copy(q.p).addScaledVector(_s, -w);
      _b.copy(q.p).addScaledVector(_s, w);
      pos.set([_a.x, _a.y, _a.z, _b.x, _b.y, _b.z], i * 6);
      fade[i * 2] = fade[i * 2 + 1] = f;
    }
    this.aPos.needsUpdate = true;
    this.aFade.needsUpdate = true;
  }

  reset() {
    this.pts.length = 0;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

export class EngineFX {
  /**
   * @param {THREE.Object3D} body  car body group (engine anchors are in its space)
   * @param {THREE.Vector3[]} nozzles
   * @param {{scene: THREE.Scene, size?: number, color?: THREE.Color, boostColor?: THREE.Color}} opts
   */
  constructor(body, nozzles, { scene, size = 0.22, color, boostColor }) {
    const S = getShared();
    this.body = body;
    this.nozzles = nozzles;
    this.size = size;
    this.uniforms = {
      uTime: { value: 0 },
      uPower: { value: 0.5 },
      uBoost: { value: 0 },
      uFlash: { value: 0 },
      uAlpha: { value: 0 },
      uCol: { value: color || new THREE.Color(0.25, 0.75, 1.0) },
      uBoostCol: { value: boostColor || new THREE.Color(1.0, 0.25, 0.55) },
    };
    const plumeMat = additive(plumeVert, plumeFrag, this.uniforms);
    const coreMat = additive(plumeVert, coreFrag, this.uniforms, THREE.FrontSide);
    this.flareMat = new THREE.SpriteMaterial({ map: S.flare, color: this.uniforms.uCol.value.clone(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true });
    this.parts = nozzles.map((p) => {
      const core = new THREE.Mesh(S.disc, coreMat);
      core.position.copy(p).add(_v.set(0, 0, -0.02));
      core.scale.setScalar(size);
      const plume = new THREE.Mesh(S.plume, plumeMat);
      plume.position.copy(p);
      const flare = new THREE.Sprite(this.flareMat);
      flare.position.copy(p).add(_v.set(0, 0, -0.15));
      flare.renderOrder = 3;
      body.add(core, plume, flare);
      return { core, plume, flare, trail: new Trail(scene, this.uniforms), world: new THREE.Vector3() };
    });
    this.time = Math.random() * 10;
    this.flash = 0;
  }

  backfire() {
    this.flash = 1;
  }

  /**
   * @param {{throttle:number, boost:number, speed:number}} st
   */
  update(dt, st, camPos) {
    this.time += dt;
    const u = this.uniforms;
    const thr = st.throttle;
    u.uTime.value = this.time;
    u.uBoost.value += ((st.boost ? 1 : 0) - u.uBoost.value) * Math.min(1, dt * 8);
    const boost = u.uBoost.value;
    const tt = this.time;
    const flicker = 0.94 + 0.06 * (Math.sin(tt * 43.0) * 0.5 + Math.sin(tt * 27.1 + 1.1) * 0.3 + Math.sin(tt * 61.7 + 2.3) * 0.2);
    u.uPower.value = (0.35 + thr * 0.65 + boost * 0.5) * flicker;
    this.flash = Math.max(0, this.flash - dt * 9);
    u.uFlash.value = this.flash;
    // trails show with speed
    u.uAlpha.value = Math.min(1, Math.max(0, (st.speed - 8) / 45)) * (0.75 + boost * 0.5);
    const size = this.size;
    const len = size * (2 + thr * 5 + boost * 9) * flicker;
    const rad = size * (0.6 + boost * 0.3);
    this.flareMat.color.copy(u.uCol.value).lerp(u.uBoostCol.value, boost).multiplyScalar(0.45 + thr * 0.35 + boost * 0.9 + this.flash * 2);
    const fw = size * (2.6 + thr * 1.2 + boost * 3 + this.flash * 4) * flicker;
    this.body.updateMatrixWorld();
    for (const p of this.parts) {
      p.plume.scale.set(rad, rad, len);
      p.core.scale.setScalar(size * (1 + this.flash * 0.6 + boost * 0.25));
      p.flare.scale.set(fw * 2.4, fw * 0.6, 1);
      p.world.copy(p.core.position);
      this.body.localToWorld(p.world);
      p.trail.update(p.world, this.time, 0.32 + boost * 0.15, size * (0.9 + boost * 0.6), camPos);
    }
  }

  dispose() {
    for (const p of this.parts) p.trail.dispose();
  }
}
