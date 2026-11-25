// Post-processing chain: MSAA render -> bloom -> grade (vignette, speed
// chromatic aberration, colour grade, film grain) -> output (tone map + sRGB).
// Plus speed streaks: additive line segments flying past the camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Replaces NaN/Inf pixels before bloom – a single bad pixel would otherwise be
// blurred across the whole screen as a black square.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    bool bad(vec4 c) { return any(isnan(c)) || any(isinf(c)); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (bad(c)) {
        // patch the hole with the valid neighbours instead of a black pixel
        vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
        vec4 acc = vec4(0.0); float n = 0.0;
        for (int i = 0; i < 8; i++) {
          vec2 o = vec2(float(i % 3) - 1.0, float(i / 3) - 1.0);
          if (i >= 4) o = vec2(float((i + 1) % 3) - 1.0, float((i + 1) / 3) - 1.0);
          vec4 s = texture2D(tDiffuse, vUv + o * px);
          if (!bad(s)) { acc += s; n += 1.0; }
        }
        c = n > 0.0 ? acc / n : vec4(0.0, 0.0, 0.0, 1.0);
      }
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 256.0), 1.0);
    }`,
};


// Era-style lens effects shared by both post paths:
//  - lens flare: sun glow + anamorphic streak + a chain of hexagon / ring
//    ghosts through the screen centre (late-90s racer staple). Visibility
//    is read from the frame itself (is the sun disc actually showing?).
//  - rain drops on the lens that refract the image and slide down
//  - lightning flash
const LENS_GLSL = /* glsl */ `
  uniform vec3 uSun;   // xy: sun position (uv), z: flare strength (0 = off)
  uniform float uRain, uFlash;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec2 lensDrops(vec2 uv, float t) {
    vec2 off = vec2(0.0);
    for (int L = 0; L < 2; L++) {
      float sc = L == 0 ? 6.0 : 11.0;
      vec2 g = uv * vec2(uAspect, 1.0) * sc;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = h21(id + float(L) * 17.0);
      float life = fract(t * (0.12 + h * 0.2) + h);
      vec2 p = vec2(h - 0.5, fract(h * 7.13) - 0.5) * 0.5;
      p.y += 0.35 - life * 0.7 * step(0.75, h); // the odd drop slides down
      float r = (L == 0 ? 0.22 : 0.3) * (1.0 - life * life) * step(0.45, h);
      vec2 dd = f - p;
      float m = 1.0 - smoothstep(r * 0.75, r, length(dd));
      off += dd * m * (L == 0 ? 0.09 : 0.05) / sc;
    }
    return off;
  }
  vec3 lensFlare(vec2 uv, sampler2D tex) {
    if (uSun.z <= 0.001) return vec3(0.0);
    vec2 sp = uSun.xy;
    float vis = 0.0;
    for (int i = 0; i < 5; i++) {
      vec2 o = vec2(float(i - 2), float(i == 2 ? 0 : (i & 1) * 2 - 1)) * 0.004;
      vec3 s = texture2D(tex, clamp(sp + o, 0.001, 0.999)).rgb;
      vis += smoothstep(0.95, 1.7, max(s.r, max(s.g, s.b)));
    }
    vis *= 0.2 * uSun.z;
    vis *= 1.0 - smoothstep(0.45, 0.62, max(abs(sp.x - 0.5), abs(sp.y - 0.5)));
    if (vis <= 0.001) return vec3(0.0);
    vec2 asp = vec2(uAspect, 1.0);
    vec2 d = (uv - sp) * asp;
    float r = length(d);
    vec3 col = vec3(1.0, 0.85, 0.62) * exp(-r * 7.0) * 0.55;
    col += vec3(0.55, 0.7, 1.0) * exp(-abs(d.y) * 110.0) * exp(-abs(d.x) * 2.2) * 0.45;
    vec2 axis = vec2(0.5) - sp;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float t = 0.3 + fi * 0.27 + (i > 3 ? 0.25 : 0.0);
      float sz = 0.025 + fract(fi * 0.618) * 0.09 + (i == 6 ? 0.12 : 0.0);
      vec2 q = (uv - (sp + axis * t)) * asp;
      vec2 a = abs(q);
      float hex = max(a.x * 0.866 + a.y * 0.5, a.y);
      float shape = (i == 3 || i == 6)
        ? smoothstep(sz * 0.78, sz * 0.9, length(q)) * (1.0 - smoothstep(sz * 0.9, sz, length(q)))
        : 1.0 - smoothstep(sz * 0.9, sz, hex);
      vec3 gc = i == 0 ? vec3(1.0, 0.6, 0.2) : i == 1 ? vec3(0.3, 1.0, 0.5) : i == 2 ? vec3(0.4, 0.5, 1.0) : i == 3 ? vec3(1.0, 0.4, 0.7) : i == 4 ? vec3(0.9, 0.9, 0.3) : i == 5 ? vec3(0.3, 0.8, 1.0) : vec3(0.8, 0.5, 1.0);
      col += gc * shape * 0.12;
    }
    return col * vis;
  }`;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uHit: { value: 0 },
    uAspect: { value: 1 },
    uSun: { value: new THREE.Vector3() },
    uRain: { value: 0 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uBoost, uHit, uAspect;
    varying vec2 vUv;
    ${LENS_GLSL}
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main() {
      vec2 uv0 = vUv + lensDrops(vUv, uTime) * uRain;
      vec2 c = uv0 - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      // radial chromatic aberration grows with speed / boost / impacts
      float ca = (0.0015 + uSpeed * 0.003 + uBoost * 0.006 + uHit * 0.012) * r;
      vec2 dir = normalize(c + 1e-5);
      vec3 col;
      col.r = texture2D(tDiffuse, uv0 - dir * ca).r;
      col.g = texture2D(tDiffuse, uv0).g;
      col.b = texture2D(tDiffuse, uv0 + dir * ca).b;
      col += lensFlare(vUv, tDiffuse);
      col += vec3(0.75, 0.8, 1.0) * uFlash * 0.3;
      // radial speed blur at the edges while boosting
      if (uBoost > 0.01) {
        vec3 acc = vec3(0.0);
        for (int i = 1; i <= 6; i++) acc += texture2D(tDiffuse, vUv - c * float(i) * 0.007 * uBoost * r).rgb;
        col = mix(col, acc / 6.0, smoothstep(0.2, 0.7, r) * uBoost);
      }
      // grade: warm highlights, violet shadows
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col * vec3(0.92, 0.88, 1.08), col * vec3(1.06, 1.0, 0.94), smoothstep(0.05, 0.6, l));
      col = mix(vec3(l), col, 1.08); // a touch more saturation
      // vignette
      col *= mix(1.0, (1.0 - smoothstep(0.25, 0.95, r)), 0.55 + uHit * 0.3);
      col += vec3(0.8, 0.1, 0.1) * uHit * smoothstep(0.3, 0.9, r) * 0.6;
      // grain
      col += (hash(vUv * 731.0) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Final pass of the PSX path: point-sampled upscale of the low-res frame,
// tone map, then 15-bit colour with a 4x4 ordered dither (in output space),
// plus the gameplay overlays (boost blur, impact flash, light vignette).
const PsxShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(640, 360) },
    uOut: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uBoost: { value: 0 },
    uHit: { value: 0 },
    uAspect: { value: 1 },
    uLevels: { value: 31 },
    uSun: { value: new THREE.Vector3() },
    uRain: { value: 0 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes, uOut;
    uniform float uTime, uBoost, uHit, uAspect, uLevels;
    varying vec2 vUv;
    ${LENS_GLSL}
    const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    float bayer4(vec2 p) {
      ivec2 q = ivec2(mod(p, 4.0));
      return BAYER[q.x + q.y * 4] / 16.0;
    }
    void main() {
      // "sharp bilinear" upscale: crisp low-res pixels, but their edges are
      // anti-aliased over one screen pixel instead of hard nearest-neighbour
      vec2 duv = vUv + lensDrops(vUv, uTime) * uRain;
      vec2 texel = duv * uRes;
      vec2 px = floor(texel);
      vec2 scale = max(uOut / uRes, vec2(1.0));
      vec2 cd = fract(texel) - 0.5;
      vec2 rr = 0.5 - 0.5 / scale;
      vec2 f = (cd - clamp(cd, -rr, rr)) * scale + 0.5;
      vec2 uv = (px + f) / uRes;
      vec3 col = texture2D(tDiffuse, uv).rgb;
      col += lensFlare((px + 0.5) / uRes, tDiffuse);
      col += vec3(0.75, 0.8, 1.0) * uFlash * 0.3;
      vec2 c = uv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      if (uBoost > 0.01) {
        vec3 acc = vec3(0.0);
        for (int i = 1; i <= 5; i++) acc += texture2D(tDiffuse, uv - c * float(i) * 0.012 * uBoost * r).rgb;
        col = mix(col, acc / 5.0, smoothstep(0.25, 0.75, r) * uBoost);
      }
      col *= mix(1.0, 1.0 - smoothstep(0.45, 1.05, r), 0.35 + uHit * 0.4);
      col += vec3(0.9, 0.1, 0.1) * uHit * smoothstep(0.3, 0.9, r) * 0.7;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      float d = bayer4(px) - 0.5;
      gl_FragColor.rgb = floor(clamp(gl_FragColor.rgb, 0.0, 1.0) * uLevels + 0.5 + d * 0.6) / uLevels;
    }`,
};

export class PostFX {
  /**
   * @param {{retro?: boolean, retroHeight?: number, bloom?: boolean}} opts
   */
  constructor(renderer, scene, camera, { retro = false, retroHeight = 360 } = {}) {
    this.renderer = renderer;
    this.retro = retro;
    this.retroHeight = retroHeight;
    this.hit = 0;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (retro) {
      // 4× MSAA even at low resolution: without it kerbs, lane lines and wall
      // tops crawl and flicker at speed
      const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(renderer, rt);
      this.composer.setPixelRatio(1);
      this.composer.addPass(new RenderPass(scene, camera));
      this.composer.addPass(new ShaderPass(SanitizeShader));
      // a faint glow keeps neon readable at night; far below the modern look
      this.bloom = new UnrealBloomPass(new THREE.Vector2(16, 16), 0.28, 0.35, 0.95);
      this.composer.addPass(this.bloom);
      this.grade = new ShaderPass(PsxShader);
      this.composer.addPass(this.grade);
      return;
    }
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  // internal render size for the PSX path
  lowSize(w, h) {
    const lh = Math.min(this.retroHeight, h);
    return [Math.max(2, Math.round((lh * w) / h)), lh];
  }

  setSize(w, h) {
    this.grade.uniforms.uAspect.value = w / h;
    if (this.retro) {
      const [lw, lh] = this.lowSize(w, h);
      this.composer.setSize(lw, lh);
      this.grade.uniforms.uRes.value.set(lw, lh);
      this.grade.uniforms.uOut.value.set(w, h);
      return;
    }
    this.composer.setSize(w, h);
  }

  // render another scene / camera through the same chain (car showroom)
  setView(scene, camera) {
    const rp = this.composer.passes[0];
    rp.scene = scene;
    rp.camera = camera;
  }

  /** sun: {x, y} uv on screen + strength; rain 0..1; flash 0..1 */
  setLens({ sunX = 0, sunY = 0, flare = 0, rain = 0, flash = 0 } = {}) {
    const u = this.grade.uniforms;
    u.uSun.value.set(sunX, sunY, flare);
    u.uRain.value = rain;
    u.uFlash.value = flash;
  }

  render(dt, { speed = 0, boost = 0 } = {}) {
    const u = this.grade.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 100;
    if (u.uSpeed) u.uSpeed.value += (speed - u.uSpeed.value) * Math.min(1, dt * 4);
    u.uBoost.value += (boost - u.uBoost.value) * Math.min(1, dt * (boost ? 6 : 2));
    this.hit = Math.max(0, this.hit - dt * 3);
    u.uHit.value = this.hit;
    this.composer.render(dt);
  }
}

// Additive streaks around the camera that stretch with speed.
export class SpeedStreaks {
  constructor(scene, count = 90) {
    this.count = count;
    this.pts = [];
    const pos = new Float32Array(count * 6);
    const col = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.scene = scene;
    for (let i = 0; i < count; i++) this.pts.push({ p: new THREE.Vector3(), life: 0 });
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
  }

  update(dt, camera, velocity, speedNorm, boost) {
    const intensity = Math.max(0, speedNorm - 0.45) * 1.6 + boost * 0.8;
    const f = camera.getWorldDirection(this._f);
    const r = this._r.crossVectors(f, camera.up).normalize();
    const u = this._u.crossVectors(r, f).normalize();
    const pos = this.aPos.array;
    const col = this.aCol.array;
    const len = 0.02 + speedNorm * 0.06 + boost * 0.05; // seconds of motion shown
    for (let i = 0; i < this.count; i++) {
      const s = this.pts[i];
      s.life -= dt;
      if (s.life <= 0) {
        // respawn in a tube ahead of the camera
        const a = Math.random() * Math.PI * 2;
        const rad = 3 + Math.random() * 9;
        s.p.copy(camera.position).addScaledVector(f, 8 + Math.random() * 50)
          .addScaledVector(r, Math.cos(a) * rad).addScaledVector(u, Math.sin(a) * rad * 0.7);
        s.life = 0.25 + Math.random() * 0.35;
        s.max = s.life;
        s.tint = Math.random();
      }
      const o = i * 6;
      pos[o] = s.p.x;
      pos[o + 1] = s.p.y;
      pos[o + 2] = s.p.z;
      // static point -> relative motion is -velocity; its trail lies ahead of it
      pos[o + 3] = s.p.x + velocity.x * len;
      pos[o + 4] = s.p.y + velocity.y * len;
      pos[o + 5] = s.p.z + velocity.z * len;
      const fade = Math.sin((s.life / s.max) * Math.PI) * intensity * 0.6;
      const cr = boost ? 1.4 : 0.9;
      const cg = boost ? 0.9 : 0.9 + s.tint * 0.2;
      const cb = boost ? 0.5 : 1.1;
      col[o] = cr * fade; col[o + 1] = cg * fade; col[o + 2] = cb * fade;
      col[o + 3] = 0; col[o + 4] = 0; col[o + 5] = 0;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.lines.visible = intensity > 0.01;
  }

  dispose() {
    this.scene.remove(this.lines);
  }
}
