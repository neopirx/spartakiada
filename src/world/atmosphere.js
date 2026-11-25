// Sky dome with procedural clouds, height fog with sun in-scattering
// (patched into every built-in material), the shadow-casting sun and the
// time-of-day presets (day / dusk / night) every track picks one of.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RETRO } from '../fx/retro.js';
import { PANO } from './skyPainter.js';

// The sun always sits at the same azimuth; only its elevation changes per
// time of day. SUN_DIR / LIGHT_DIR are mutated in place by applyTimeOfDay().
const SUN_AZ = new THREE.Vector2(-0.55, -0.83).normalize();
export const SUN_DIR = new THREE.Vector3(-0.55, 0.075, -0.83).normalize();
export const LIGHT_DIR = new THREE.Vector3(-0.55, 0.42, -0.83).normalize();

export const FOG = {
  color: new THREE.Color(0x6a3346),
  density: 0.00042,
  falloff: 0.012, // height falloff (1/m)
  base: CONFIG.track.groundY, // ground level
};

const c = (hex) => new THREE.Color(hex);
const v = (r, g, b) => new THREE.Vector3(r, g, b);

// Time-of-day presets. Colours are linear-ish HDR values used by the sky shader.
export const TIMES = {
  // bright arcade afternoon: saturated blue sky, big white cumulus
  day: {
    elevation: 0.42,
    sky: { horizon: v(0.86, 0.9, 0.95), low: v(0.52, 0.7, 0.96), mid: v(0.22, 0.46, 0.92), zenith: v(0.06, 0.2, 0.68) },
    halo: v(0.55, 0.45, 0.3),
    sunDisc: v(2.2, 2.0, 1.6), sunSize: 0.045, retroSun: 0,
    stars: 0,
    cloudLit: v(1.3, 1.28, 1.24), cloudDark: v(0.5, 0.57, 0.72), cloudRim: v(0.4, 0.35, 0.25), cloudCover: 0.47,
    fog: c(0xa9bfdc), fogDensity: 0.00024,
    sun: { color: 0xfff0d8, intensity: 3.0 },
    hemi: { sky: 0xa8ccff, ground: 0x7a6a58, intensity: 1.25 },
    fill: { color: 0x9ab4ff, intensity: 0.35 },
    exposure: 1.0,
    windows: 0.08, // emissive strength of lit windows
    lamps: 0.0,    // street-lamp glow
    neon: 0.55,
    ground: '#5d5b58',
  },
  // the original look: low striped sun, violet sky
  dusk: {
    elevation: 0.075,
    sky: { horizon: v(1.05, 0.46, 0.24), low: v(0.78, 0.28, 0.34), mid: v(0.34, 0.12, 0.3), zenith: v(0.035, 0.03, 0.1) },
    halo: v(1.0, 0.5, 0.22),
    sunDisc: v(2.2, 1.9, 1.0), sunSize: 0.11, retroSun: 1,
    stars: 1,
    cloudLit: v(1.2, 0.55, 0.35), cloudDark: v(0.2, 0.09, 0.18), cloudRim: v(1.4, 0.7, 0.4), cloudCover: 0.52,
    fog: c(0x6a3346), fogDensity: 0.00042,
    sun: { color: 0xffb27a, intensity: 2.6 },
    hemi: { sky: 0x8a7cff, ground: 0x5a3024, intensity: 1.0 },
    fill: { color: 0x5a78ff, intensity: 0.5 },
    exposure: 1.05,
    windows: 1.4,
    lamps: 1,
    neon: 1,
    ground: '#3a3838',
  },
  // city night: deep blue, sodium lamps, neon everywhere
  night: {
    elevation: 0.3,
    sky: { horizon: v(0.32, 0.16, 0.2), low: v(0.12, 0.08, 0.2), mid: v(0.04, 0.05, 0.14), zenith: v(0.008, 0.012, 0.05) },
    halo: v(0.15, 0.18, 0.3),
    sunDisc: v(1.6, 1.7, 2.0), sunSize: 0.03, retroSun: 0, // the moon
    stars: 1.3,
    cloudLit: v(0.22, 0.2, 0.3), cloudDark: v(0.05, 0.04, 0.09), cloudRim: v(0.3, 0.3, 0.45), cloudCover: 0.56,
    fog: c(0x1c1830), fogDensity: 0.00045,
    sun: { color: 0x8fa8ff, intensity: 0.7 },
    hemi: { sky: 0x4a50a0, ground: 0x402a20, intensity: 0.55 },
    fill: { color: 0xff9a50, intensity: 0.2 }, // city glow from below
    exposure: 1.0,
    windows: 1.8,
    lamps: 1.3,
    neon: 1.4,
    ground: '#26262a',
  },
};

let current = TIMES.dusk;
export const currentTime = () => current;

// deep copy of a preset so weather can modify it without touching TIMES
function clonePreset(src) {
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v.clone === 'function') out[k] = v.clone();
    else if (v && typeof v === 'object') out[k] = clonePreset(v);
    else out[k] = v;
  }
  return out;
}

export function applyTimeOfDay(name, modify = null) {
  current = clonePreset(TIMES[name] || TIMES.dusk);
  if (modify) modify(current);
  const e = current.elevation;
  SUN_DIR.set(SUN_AZ.x * Math.sqrt(1 - e * e), e, SUN_AZ.y * Math.sqrt(1 - e * e));
  const le = Math.max(0.42, e);
  LIGHT_DIR.set(SUN_AZ.x * Math.sqrt(1 - le * le), le, SUN_AZ.y * Math.sqrt(1 - le * le));
  FOG.color.copy(current.fog);
  FOG.density = current.fogDensity;
  return current;
}

let installed = false;

// Replace three's fog chunks with exponential height fog + sun glow.
// The glow tint is derived from the fog colour so it works for every
// time of day without extra uniforms.
export function installHeightFog() {
  if (installed) return;
  installed = true;
  // Bump mapping normalises screen-space derivatives of the position; where
  // they vanish (distant / grazing / snapped triangles) that is NaN, which
  // showed up as flickering black squares on the road. Guard it.
  THREE.ShaderChunk.bumpmap_pars_fragment = THREE.ShaderChunk.bumpmap_pars_fragment
    .replace('vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );', 'vec3 dpx = dFdx( surf_pos.xyz ); vec3 dpy = dFdy( surf_pos.xyz );\n\t\tif ( dot( dpx, dpx ) < 1e-14 || dot( dpy, dpy ) < 1e-14 ) return surf_norm;\n\t\tvec3 vSigmaX = normalize( dpx );')
    .replace('vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );', 'vec3 vSigmaY = normalize( dpy );')
    .replace('return normalize( abs( fDet ) * surf_norm - vGrad );', 'vec3 bn = abs( fDet ) * surf_norm - vGrad;\n\t\treturn dot( bn, bn ) > 1e-12 ? normalize( bn ) : surf_norm;');
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying vec3 vFogWorldPos;
    #endif`;
  // mvPosition exists in every shader that includes fog_vertex (sprites too)
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogWorldPos = ( inverse( viewMatrix ) * vec4( mvPosition.xyz, 1.0 ) ).xyz;
    #endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vFogWorldPos;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
    #endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      vec3 fogRay = vFogWorldPos - cameraPosition;
      float fogDist = length( fogRay );
      #ifdef FOG_EXP2
        float fDens = fogDensity;
      #else
        float fDens = 1.0 / max( fogFar, 1.0 );
      #endif
      float fFall = ${FOG.falloff.toFixed(5)};
      float camH = max( cameraPosition.y - (${FOG.base.toFixed(2)}), 0.0 );
      float dy = fogRay.y * fFall;
      float heightTerm = abs( dy ) > 1e-3 ? ( 1.0 - exp( -dy ) ) / dy : 1.0;
      float fogAmount = 1.0 - exp( -fDens * exp( -camH * fFall ) * fogDist * heightTerm );
      // keep a minimum distance haze even high up
      fogAmount = max( fogAmount, 1.0 - exp( -fogDist * fDens * 0.18 ) );
      vec3 fDir = fogRay / max( fogDist, 1e-3 );
      vec2 fH = normalize( fDir.xz + 1e-4 );
      float sunAmt = pow( max( dot( fH, vec2( ${SUN_AZ.x.toFixed(4)}, ${SUN_AZ.y.toFixed(4)} ) ), 0.0 ), 6.0 ) * ( 1.0 - abs( fDir.y ) );
      vec3 fCol = mix( fogColor, fogColor * vec3( 1.55, 1.12, 0.78 ) + vec3( 0.06, 0.03, 0.0 ), sunAmt * 0.85 );
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fCol, clamp( fogAmount, 0.0, 1.0 ) );
    #endif`;
}

/**
 * @param {{pano?: THREE.Texture, fbm?: number}} opts
 *   pano: painted panorama (skyPainter.js) composited around the horizon
 *   fbm:  amount of the procedural cloud deck (overcast weathers only)
 */
export function createSky({ pano = null, fbm = 1 } = {}) {
  const T = current;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uTime: { value: 0 },
      uFog: { value: FOG.color.clone() },
      uHorizon: { value: T.sky.horizon },
      uLow: { value: T.sky.low },
      uMid: { value: T.sky.mid },
      uZenith: { value: T.sky.zenith },
      uHalo: { value: T.halo },
      uSunDisc: { value: T.sunDisc },
      uSunSize: { value: T.sunSize },
      uRetroSun: { value: T.retroSun },
      uStars: { value: T.stars },
      uCloudLit: { value: T.cloudLit },
      uCloudDark: { value: T.cloudDark },
      uCloudRim: { value: T.cloudRim },
      uCloudCover: { value: T.cloudCover },
      uFlash: { value: 0 },
      uPoster: { value: RETRO.enabled ? 1 : 0 },
      uPano: { value: pano },
      uPanoOn: { value: pano ? 1 : 0 },
      uPanoRange: { value: new THREE.Vector3(PANO.bottom, PANO.top, PANO.gain) },
      uFbm: { value: fbm },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSun, uFog, uHorizon, uLow, uMid, uZenith, uHalo, uSunDisc;
      uniform vec3 uCloudLit, uCloudDark, uCloudRim;
      uniform float uTime, uSunSize, uRetroSun, uStars, uCloudCover, uFlash, uPoster, uPanoOn, uFbm;
      uniform vec3 uPanoRange;
      uniform sampler2D uPano;

      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float hash3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 r = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sunDot = max(dot(d, uSun), 0.0);

        vec3 col = mix(uHorizon, uLow, smoothstep(0.0, 0.08, h));
        col = mix(col, uMid, smoothstep(0.06, 0.28, h));
        col = mix(col, uZenith, smoothstep(0.2, 0.8, h));
        float side = dot(normalize(d.xz + 1e-4), normalize(uSun.xz + 1e-4));
        col *= mix(vec3(0.85, 0.88, 1.08), vec3(1.08, 1.0, 0.94), side * 0.5 + 0.5);
        col += uHalo * (pow(sunDot, 8.0) * 0.6 + pow(sunDot, 64.0) * 0.8);

        // stars
        vec3 sp = floor(d * 420.0);
        float st = step(0.9982, hash3(sp)) * smoothstep(0.18, 0.55, h) * uStars;
        float starLight = st * (0.6 + 0.4 * sin(uTime * 3.0 + hash3(sp + 1.0) * 30.0));

        // sun / moon disc (striped retro sun at dusk)
        float dd = distance(d, uSun);
        float disc = 1.0 - smoothstep(uSunSize * 0.95, uSunSize, dd);
        float below = d.y - uSun.y;
        float stripes = step(0.45 + clamp(-below * 6.0, 0.0, 0.4), fract(below * 60.0 + 0.3));
        disc *= (below > 0.0 || uRetroSun < 0.5) ? 1.0 : stripes;
        vec3 sunCol = mix(uSunDisc, vec3(1.0, 0.25, 0.4) * 2.2, uRetroSun * (1.0 - smoothstep(-0.1, 0.08, below)));
        col += sunCol * disc;

        // clouds: fbm on a plane above the camera
        float cloudA = 0.0;
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.08) * 1.1;
          vec2 drift = vec2(uTime * 0.012, uTime * 0.004);
          float base = fbm(uv * 1.2 + drift);
          float detail = fbm(uv * 4.0 - drift * 2.0);
          float c = base * 0.75 + detail * 0.35;
          cloudA = smoothstep(uCloudCover, uCloudCover + 0.3, c) * smoothstep(0.0, 0.12, h) * uFbm;
          float thick = smoothstep(uCloudCover + 0.03, 1.0, c);
          // PSX: posterised cloud bands like a painted sky texture
          if (uPoster > 0.5) {
            cloudA = floor(cloudA * 4.0 + 0.5) / 4.0;
            thick = floor(thick * 3.0 + 0.5) / 3.0;
          }
          vec3 lit = mix(uCloudLit, uCloudLit * 1.15, pow(sunDot, 4.0));
          vec3 cloudCol = mix(lit, uCloudDark, thick * 0.85);
          cloudCol += uCloudRim * pow(sunDot, 12.0) * (1.0 - thick) * 2.0;
          cloudCol = mix(cloudCol, uFog * 1.3, (1.0 - smoothstep(0.0, 0.25, h)));
          col = mix(col, cloudCol, cloudA);
        }
        col += starLight * (1.0 - cloudA);

        // horizon haze blends into the height fog
        col = mix(col, uFog * 1.15 + uHalo * 0.25 * pow(sunDot, 3.0), (1.0 - smoothstep(-0.02, 0.06, h)) * 0.9);

        // painted panorama: clouds, hills and the distant city on the horizon
        if (uPanoOn > 0.5) {
          float el = degrees(asin(clamp(h, -1.0, 1.0)));
          float pv = (el - uPanoRange.x) / (uPanoRange.y - uPanoRange.x);
          if (pv > 0.0 && pv < 1.0) {
            float pu = atan(d.x, d.z) / 6.2831853 + 0.5;
            vec4 p = texture2D(uPano, vec2(pu, pv));
            col = mix(col, p.rgb * uPanoRange.z, p.a);
            cloudA = max(cloudA, p.a * step(0.0, h));
          }
        }
        // lightning lights the cloud deck from inside
        col += vec3(0.7, 0.75, 1.0) * uFlash * (0.4 + cloudA * 1.6) * smoothstep(-0.05, 0.3, h);
        col = mix(col, uFog * 0.7, (1.0 - smoothstep(-0.25, -0.02, h)));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return { mesh: sky, material: mat };
}

// Directional sun with a shadow frustum that follows a focus point.
export function createSun() {
  const T = current;
  const sun = new THREE.DirectionalLight(T.sun.color, T.sun.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const S = 110;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 900 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 3;
  const target = new THREE.Object3D();
  sun.target = target;
  const texel = (2 * S) / 2048;
  const tmp = new THREE.Vector3();
  const dir = LIGHT_DIR.clone();
  return {
    light: sun,
    target,
    follow(focus) {
      // snap to shadow texels in light space to avoid shimmering
      tmp.copy(focus);
      tmp.x = Math.round(tmp.x / texel) * texel;
      tmp.z = Math.round(tmp.z / texel) * texel;
      target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(dir, 450);
      target.updateMatrixWorld();
    },
  };
}
