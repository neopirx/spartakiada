// Builds all render geometry for a TrackData: road, walls, hull, tunnels,
// pillars, booster pads, start gantry, corner chevrons and decorative
// segment structures (bridge arches, neon rings, grandstands).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { TAG, makeFrame } from './trackData.js';
import * as TX from '../world/textures.js';
import { RETRO } from '../fx/retro.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { photoTexture, PHOTO } from '../world/photoTextures.js';

const W = CONFIG.track.width;
const HW = W / 2;
const WH = CONFIG.track.wallHeight;
const HULL_BOTTOM = -1.6;
// Winding rule for extrude(): a profile listed from right (+x) to left (-x)
// produces up-facing triangles.
const ROAD_PROFILE = [[HW, 0], [-HW, 0]];

// Extrude a 2D profile (x = lateral (+right), y = height along up) along the
// track samples in [i0, i1] (inclusive, may wrap). vScale converts metres to V.
function extrude(track, profile, i0, i1, { vScale = 1 / W, uMode = 'profile' } = {}) {
  const N = track.count;
  const count = i1 >= i0 ? i1 - i0 + 1 : N - i0 + i1 + 1;
  const P = profile.length;
  const positions = new Float32Array(count * P * 3);
  const uvs = new Float32Array(count * P * 2);
  const indices = [];
  const p = new THREE.Vector3();
  const r = new THREE.Vector3();
  const u = new THREE.Vector3();
  const plen = [0];
  for (let k = 1; k < P; k++) plen.push(plen[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  const total = plen[P - 1] || 1;
  for (let c = 0; c < count; c++) {
    const i = (i0 + c) % N;
    p.fromArray(track.pos, i * 3);
    r.fromArray(track.right, i * 3);
    u.fromArray(track.up, i * 3);
    const v = (i0 + c) * track.ds * vScale;
    for (let k = 0; k < P; k++) {
      const [x, y] = profile[k];
      const o = (c * P + k) * 3;
      positions[o] = p.x + r.x * x + u.x * y;
      positions[o + 1] = p.y + r.y * x + u.y * y;
      positions[o + 2] = p.z + r.z * x + u.z * y;
      uvs[(c * P + k) * 2] = uMode === 'profile' ? plen[k] / total : plen[k] / 4;
      uvs[(c * P + k) * 2 + 1] = v;
    }
  }
  for (let c = 0; c < count - 1; c++) {
    for (let k = 0; k < P - 1; k++) {
      const a = c * P + k;
      const b = a + P;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// The hull under the road deck: top lips and underside in plain concrete,
// the outer side faces in chunks of ~60 m that are either plain concrete or
// sprayed with graffiti (photo texture, upright and readable from outside on
// both sides). Merged per material.
function hullMeshes(track, a, b, concreteMat, graffitiMat) {
  const N = track.count;
  const count = b >= a ? b - a + 1 : N - a + b + 1;
  const plain = [];
  const sprayed = [];
  const lips = [[[-HW - 0.25, WH], [-HW - 1.2, WH]], [[-HW - 1.2, HULL_BOTTOM], [HW + 1.2, HULL_BOTTOM]], [[HW + 1.2, WH], [HW + 0.25, WH]]];
  for (const prof of lips) plain.push(extrude(track, prof, a, b, { vScale: 1 / 16 }));
  const sides = [
    { prof: [[-HW - 1.2, WH], [-HW - 1.2, HULL_BOTTOM]], sgn: -1, flipV: true }, // top -> bottom
    { prof: [[HW + 1.2, HULL_BOTTOM], [HW + 1.2, WH]], sgn: 1, flipV: false }, // bottom -> top
  ];
  const [gw] = PHOTO.graffiti.size;
  const along = gw * ((WH - HULL_BOTTOM) / PHOTO.graffiti.size[1]); // keep the photo's aspect
  const CH = 60;
  for (let c = 0; c < count - 1; c += CH) {
    const i0 = (a + c) % N;
    const i1 = (a + Math.min(count - 1, c + CH)) % N;
    for (const sd of sides) {
      // deterministic per chunk/side so rebuilding a track gives the same walls
      const h = Math.sin((a + c) * 12.9898 + sd.sgn * 78.233) * 43758.5453;
      const spray = graffitiMat && h - Math.floor(h) < 0.4;
      if (!spray) {
        plain.push(extrude(track, sd.prof, i0, i1, { vScale: 1 / 16 }));
        continue;
      }
      // u: along the track (mirrored on the left so text reads left-to-right
      // from outside), v: up the wall
      const g = extrude(track, sd.prof, i0, i1, { vScale: 1 / along });
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) {
        const pu = uv.getX(k);
        const pv = uv.getY(k);
        uv.setXY(k, sd.sgn * pv, sd.flipV ? 1 - pu : pu);
      }
      sprayed.push(g);
    }
  }
  const out = [new THREE.Mesh(mergeGeometries(plain), concreteMat)];
  if (sprayed.length) out.push(new THREE.Mesh(mergeGeometries(sprayed), graffitiMat));
  return out;
}

// Contiguous (non-wrapping) ranges of samples whose tags include `flag`.
function ranges(track, flag) {
  const out = [];
  const N = track.count;
  let start = -1;
  for (let i = 0; i < N; i++) {
    const on = (track.tags[i] & flag) !== 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, N - 1]);
  return out;
}

// Ranges of solid road (everything except GAP), wrapping around the loop.
// Without gaps the loop is split in two so it closes seamlessly.
function solidRanges(track) {
  const N = track.count;
  const gap = (i) => (track.tags[(i + N) % N] & TAG.GAP) !== 0;
  let g0 = -1;
  for (let i = 0; i < N; i++) if (gap(i)) { g0 = i; break; }
  if (g0 < 0) return { closed: true, list: [[0, N - 1], [N - 1, 0]] };
  const list = [];
  let start = -1;
  for (let k = 1; k <= N; k++) {
    const i = (g0 + k) % N;
    if (!gap(i) && start < 0) start = i;
    if (gap(i) && start >= 0) {
      list.push([start, (i - 1 + N) % N]);
      start = -1;
    }
  }
  if (start >= 0) list.push([start, (g0 - 1 + N) % N]);
  return { closed: false, list };
}

function frameMatrix(fr, pos) {
  // object local: +X = track right, +Y = up, +Z = backwards (faces the driver)
  const m = new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.fwd.clone().negate());
  m.setPosition(pos);
  return m;
}

const shadowed = (mesh, cast = true, receive = true) => {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
};

/**
 * @param {TrackData} track
 * @param {{ road?: {texture, data, aspect} }} opts
 */
export function buildTrackMesh(track, opts = {}) {
  const group = new THREE.Group();
  group.name = 'track';
  const N = track.count;
  const animated = [];

  // --- materials ------------------------------------------------------------------
  let roadMat;
  let roadV = 1 / W;
  if (opts.road) {
    // PSX path: no bump map (the hardware had none; its screen-space
    // derivatives also shimmer badly at low resolution)
    // PSX path also drops the roughness map: per-texel roughness turns
    // the sun / sky reflection into sparkles that strobe at speed.
    roadMat = new THREE.MeshStandardMaterial({
      map: opts.road.texture,
      bumpMap: RETRO.enabled ? null : opts.road.data,
      bumpScale: 2.2,
      roughnessMap: RETRO.enabled ? null : opts.road.data,
      roughness: RETRO.enabled ? 0.9 : 1.55, // modern: multiplied by the photo's grey levels
      metalness: 0.05,
    });
    roadV = 1 / (W * opts.road.aspect);
  } else {
    roadMat = new THREE.MeshStandardMaterial({ map: TX.roadTexture(), roughness: 0.75, metalness: 0.15 });
  }
  const wallMat = new THREE.MeshStandardMaterial({ map: TX.wallTexture(), roughness: 0.55, side: THREE.DoubleSide });
  const hullMat = new THREE.MeshStandardMaterial({ map: TX.concreteTexture('#4a4846'), roughness: 0.9, side: THREE.DoubleSide });
  const gTex = photoTexture('graffiti');
  const graffitiMat = gTex ? new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.92, side: THREE.DoubleSide }) : null;
  // glow strips lie on the hull top: lift + polygon offset so they never z-fight it
  const glowL = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.18, 0.15), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const glowR = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.15, 1.4), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });

  const leftWall = [[-HW, 0], [-HW - 0.25, WH]];
  const rightWall = [[HW + 0.25, WH], [HW, 0]];

  // --- road / walls / hull (skipping jump gaps) ---------------------------------------
  const solid = solidRanges(track);
  for (const [a, b] of solid.list) {
    // profile runs right -> left so the triangles face up (front side visible from above)
    group.add(shadowed(new THREE.Mesh(extrude(track, ROAD_PROFILE, a, b, { vScale: roadV }), roadMat), false, true));
    group.add(shadowed(new THREE.Mesh(extrude(track, leftWall, a, b, { vScale: 1 / 8, uMode: 'metric' }), wallMat)));
    group.add(shadowed(new THREE.Mesh(extrude(track, rightWall, a, b, { vScale: 1 / 8, uMode: 'metric' }), wallMat)));
    for (const m of hullMeshes(track, a, b, hullMat, graffitiMat)) group.add(shadowed(m));
    group.add(new THREE.Mesh(extrude(track, [[-HW - 0.3, WH + 0.06], [-HW - 1.1, WH + 0.06]], a, b), glowL));
    group.add(new THREE.Mesh(extrude(track, [[HW + 1.1, WH + 0.06], [HW + 0.3, WH + 0.06]], a, b), glowR));
  }
  if (!solid.closed) {
    // end caps at the jump lips + warning stripes
    const shape = new THREE.Shape();
    const outline = [[-HW, 0], [HW, 0], [HW + 0.25, WH], [HW + 1.2, WH], [HW + 1.2, HULL_BOTTOM], [-HW - 1.2, HULL_BOTTOM], [-HW - 1.2, WH], [-HW - 0.25, WH]];
    outline.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    const capGeo = new THREE.ShapeGeometry(shape);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xd8b020, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x2a1a00 });
    const lipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.3), toneMapped: false });
    const fr = makeFrame();
    for (const [a, b] of solid.list) {
      for (const i of [a, b]) {
        track.frameAt(i * track.ds, fr);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.applyMatrix4(frameMatrix(fr, fr.pos));
        group.add(cap);
        // glowing lip strip across the road edge
        const lip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, 0.5), lipMat);
        lip.applyMatrix4(frameMatrix(fr, fr.pos.clone().addScaledVector(fr.up, 0.05)));
        group.add(lip);
      }
    }
  }

  // --- tunnels -----------------------------------------------------------------------
  const tunnelMat = new THREE.MeshStandardMaterial({ map: TX.concreteTexture('#55524e'), roughness: 0.95, side: THREE.DoubleSide });
  const tunnelLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.5, 1.0), toneMapped: false, side: THREE.DoubleSide });
  const arc = [];
  const R = HW + 1.2;
  for (let k = 0; k <= 16; k++) {
    const a = Math.PI - (k / 16) * Math.PI;
    arc.push([Math.cos(a) * R, WH + Math.sin(a) * R * 0.7]);
  }
  for (const [a, b] of ranges(track, TAG.TUNNEL)) {
    group.add(shadowed(new THREE.Mesh(extrude(track, arc, a, b, { vScale: 1 / 16 }), tunnelMat)));
    for (const lx of [-0.35, 0.35]) {
      const ang = Math.PI / 2 - lx;
      const x = Math.cos(ang) * (R - 0.3);
      const y = WH + Math.sin(ang) * (R - 0.3) * 0.7;
      group.add(new THREE.Mesh(extrude(track, [[x - 0.6, y], [x + 0.6, y - 0.05]], a, b), tunnelLight));
    }
    for (const i of [a, b]) group.add(portal(track, i * track.ds, R));
  }

  // --- pillars -----------------------------------------------------------------------
  const pillarGeo = new THREE.BoxGeometry(2.2, 1, 2.2);
  pillarGeo.translate(0, -0.5, 0);
  const pillarMat = new THREE.MeshStandardMaterial({ map: TX.concreteTexture('#6a665f'), roughness: 0.9 });
  const mats = [];
  const fr = makeFrame();
  const gy = CONFIG.track.groundY;
  for (let i = 0; i < N; i += 30) {
    const s = i * track.ds;
    track.frameAt(s, fr);
    if (fr.up.y < 0.9 || track.tags[i] & (TAG.TUNNEL | TAG.MAGNET | TAG.GAP | TAG.BRIDGE)) continue;
    for (const x of [-HW + 3, HW - 3]) {
      const top = fr.pos.clone().addScaledVector(fr.right, x).addScaledVector(fr.up, HULL_BOTTOM);
      const h = top.y - gy;
      if (h < 1.5) continue;
      const m = new THREE.Matrix4().compose(top, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(fr.fwd.x, 0, fr.fwd.z).normalize()), new THREE.Vector3(1, h, 1));
      mats.push(m);
    }
  }
  if (mats.length) {
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, mats.length);
    mats.forEach((m, k) => pillars.setMatrixAt(k, m));
    group.add(shadowed(pillars));
  }

  // --- booster pads ---------------------------------------------------------------------
  const boostTex = TX.boostTexture();
  boostTex.repeat.set(1, 1.5);
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTex, toneMapped: false, color: new THREE.Color(1.8, 1.8, 1.8), polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  const padPositions = [];
  const padUV = [];
  const padIdx = [];
  const tmp = new THREE.Vector3();
  for (const b of track.boosts) {
    const steps = 6;
    const base = padPositions.length / 3;
    for (let k = 0; k <= steps; k++) {
      const s = b.s - b.length / 2 + (k / steps) * b.length;
      for (const side of [-1, 1]) {
        track.pointAt(s, b.x + (side * b.width) / 2, 0.06, tmp);
        padPositions.push(tmp.x, tmp.y, tmp.z);
        padUV.push(side < 0 ? 0 : 1, k / steps);
      }
    }
    for (let k = 0; k < steps; k++) {
      const a = base + k * 2;
      padIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  if (padPositions.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(padPositions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(padUV, 2));
    g.setIndex(padIdx);
    group.add(new THREE.Mesh(g, boostMat));
  }

  // --- start line + gantry -------------------------------------------------------------
  const gantry = startGantry(track);
  group.add(gantry.object);

  // --- decoration -------------------------------------------------------------------------
  group.add(cornerChevrons(track));
  for (const [a, b] of ranges(track, TAG.BRIDGE)) group.add(bridgeArches(track, a, b));
  for (const [a, b] of ranges(track, TAG.STANDS)) group.add(grandstands(track, a, b));
  const rings = neonRings(track);
  if (rings) {
    group.add(rings.mesh);
    animated.push(rings);
  }

  return {
    group,
    startLights: gantry.lights,
    // wet asphalt: darker, glossy, reflects the sky / city lights
    setWet(k) {
      roadMat.color.setScalar(1 - 0.3 * k);
      roadMat.roughness = RETRO.enabled ? 0.9 - 0.55 * k : 1.55 - 1.25 * k;
      roadMat.metalness = 0.05 + 0.35 * k;
      roadMat.envMapIntensity = 1 + 1.6 * k;
      roadMat.needsUpdate = true;
    },
    update(dt, t) {
      boostTex.offset.y = (boostTex.offset.y - dt * 2.2) % 1;
      boostMat.color.setScalar(1.5 + 0.5 * Math.sin(t * 10));
      for (const a of animated) a.update(dt, t);
    },
  };
}

function portal(track, s, R) {
  const fr = makeFrame();
  track.frameAt(s, fr);
  const geo = new THREE.TorusGeometry(R, 0.8, 6, 24, Math.PI);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb02a22, roughness: 0.5, emissive: 0x401010 });
  const m = new THREE.Mesh(geo, mat);
  // proper (right-handed) basis: right × up = −fwd. A mirrored basis here made
  // setFromRotationMatrix return a skewed rotation on some track headings.
  const basis = new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.fwd.clone().negate());
  m.quaternion.setFromRotationMatrix(basis);
  m.scale.set(1, 0.7, 1);
  m.position.copy(fr.pos).addScaledVector(fr.up, WH);
  return shadowed(m);
}

function startGantry(track) {
  const g = new THREE.Group();
  const fr = makeFrame();
  track.frameAt(track.startS, fr);
  g.applyMatrix4(frameMatrix(fr, fr.pos));

  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const x = c.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
    x.fillStyle = (i + j) % 2 ? '#111' : '#eee';
    x.fillRect(i * 16, j * 16, 16, 16);
  }
  const lineTex = new THREE.CanvasTexture(c);
  lineTex.colorSpace = THREE.SRGBColorSpace;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 3.5), new THREE.MeshStandardMaterial({ map: lineTex, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.05;
  line.receiveShadow = true;
  g.add(line);

  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9890, metalness: 0.6, roughness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc0202a, roughness: 0.5 });
  for (const side of [-1, 1]) {
    const post = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.6, 14, 1.6), red));
    post.position.set(side * (HW + 2), 7, 0);
    g.add(post);
  }
  const beam = shadowed(new THREE.Mesh(new THREE.BoxGeometry(W + 6, 3.2, 1.8), steel));
  beam.position.set(0, 13, 0);
  g.add(beam);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.62, 2.6),
    new THREE.MeshBasicMaterial({ map: TX.signTexture('START · META', { fg: '#fff3d6', bg: '#b0141c', glow: false }), toneMapped: false }),
  );
  sign.position.set(0, 13, 0.91);
  g.add(sign);

  const lights = [];
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0x220000, toneMapped: false }));
    l.position.set((k - 2) * 1.5, 15.4, 0.92);
    g.add(l);
    lights.push(l);
  }
  const lbox = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1.8, 1.2), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  lbox.position.set(0, 15.4, 0.3);
  g.add(lbox);
  return { object: g, lights };
}

function cornerChevrons(track) {
  const group = new THREE.Group();
  const tex = TX.signTexture('>>>', { fg: '#ffffff', bg: '#c41c24', glow: false, w: 256, h: 128 });
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.3, 1.3, 1.3), side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(4, 2);
  const fr = makeFrame();
  const pos = new THREE.Vector3();
  track.tiles.forEach((tile, ti) => {
    if (!tile.turn) return;
    const s0 = track.tileStartS[ti];
    const len = track.tileStartS[ti + 1] - s0;
    const side = tile.turn > 0 ? 1 : -1;
    for (const f of [0.2, 0.45, 0.7]) {
      const s = s0 + f * len;
      if (track.tagsAt(s) & TAG.TUNNEL) continue;
      track.frameAt(s, fr);
      pos.copy(fr.pos).addScaledVector(fr.right, side * (HW + 0.6)).addScaledVector(fr.up, WH + 1.3);
      const m = new THREE.Mesh(geo, mat);
      m.applyMatrix4(frameMatrix(fr, pos));
      if (side > 0) m.scale.x = -1;
      group.add(m);
    }
  });
  return group;
}

// Two red steel arches over the deck with vertical hangers.
function bridgeArches(track, a, b) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb3241e, metalness: 0.55, roughness: 0.4 });
  const cable = new THREE.MeshStandardMaterial({ color: 0xcfcac0, metalness: 0.7, roughness: 0.3 });
  const p = new THREE.Vector3();
  const fr = makeFrame();
  const len = (b - a) * track.ds;
  const rise = Math.min(34, len * 0.2);
  for (const side of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const s = (a + (k / 24) * (b - a)) * track.ds;
      track.pointAt(s, side * (HW + 2.2), WH + Math.sin((Math.PI * k) / 24) * rise, p, fr);
      pts.push(p.clone());
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.9, 8), mat);
    g.add(shadowed(tube));
    // hangers
    for (let k = 2; k <= 22; k += 2) {
      const s = (a + (k / 24) * (b - a)) * track.ds;
      const h = Math.sin((Math.PI * k) / 24) * rise;
      track.pointAt(s, side * (HW + 2.2), WH + h / 2, p, fr);
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h, 5), cable);
      hanger.applyMatrix4(frameMatrix(fr, p));
      g.add(hanger);
    }
  }
  // portal beams at both ends
  for (const i of [a, b]) {
    track.frameAt(i * track.ds, fr);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 6, 1.2, 1.2), mat);
    beam.applyMatrix4(frameMatrix(fr, fr.pos.clone().addScaledVector(fr.up, WH + 6)));
    g.add(shadowed(beam));
  }
  return g;
}

// Neon ring arches every few metres around RINGS sections – chase-light animated.
function neonRings(track) {
  const list = [];
  const fr = makeFrame();
  for (const [a, b] of ranges(track, TAG.RINGS)) {
    for (let i = a + 6; i <= b - 6; i += 12) {
      track.frameAt(i * track.ds, fr);
      list.push(frameMatrix(fr, fr.pos.clone().addScaledVector(fr.up, WH - 0.5)));
    }
  }
  if (!list.length) return null;
  const geo = new THREE.TorusGeometry(HW + 2.4, 0.35, 6, 32, Math.PI);
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  // torus lies in XY, arc over +Y: matches our frame (X right, Y up)
  list.forEach((m, k) => mesh.setMatrixAt(k, m));
  const palette = [new THREE.Color(3, 0.25, 0.3), new THREE.Color(0.3, 2.2, 3), new THREE.Color(3, 2.2, 0.4)];
  const col = new THREE.Color();
  const n = list.length;
  for (let k = 0; k < n; k++) mesh.setColorAt(k, palette[k % 3]);
  return {
    mesh,
    update(dt, t) {
      for (let k = 0; k < n; k++) {
        const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(k * 0.7 - t * 9)) ** 3;
        col.copy(palette[Math.floor(k / 4) % 3]).multiplyScalar(pulse);
        mesh.setColorAt(k, col);
      }
      mesh.instanceColor.needsUpdate = true;
    },
  };
}

function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2730';
  g.fillRect(0, 0, 512, 256);
  const cols = ['#c8202a', '#e9e1cf', '#2a4a8a', '#d9a521', '#3a7a3a', '#f0f0f0', '#7a3a7a'];
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    const y0 = (r * 256) / rows;
    g.fillStyle = '#4a4650';
    g.fillRect(0, y0 + 26, 512, 6);
    for (let x = 4; x < 512; x += 9 + Math.random() * 4) {
      if (Math.random() < 0.12) continue;
      g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      g.fillRect(x, y0 + 10 + Math.random() * 4, 6, 12);
      g.fillStyle = '#e0b090';
      g.beginPath();
      g.arc(x + 3, y0 + 7 + Math.random() * 3, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // occasional banners
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#c8202a' : '#f2ead8';
    g.fillRect(40 + i * 120, 120, 70, 22);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function grandstands(track, a, b) {
  const g = new THREE.Group();
  const crowd = crowdTexture();
  const standMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: crowd, emissiveIntensity: 0.15 });
  const concrete = new THREE.MeshStandardMaterial({ map: TX.concreteTexture('#7a756c'), roughness: 0.9, side: THREE.DoubleSide });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  const lo = Math.max(a, a + 4);
  const hi = Math.max(lo + 2, b - 4);
  for (const side of [-1, 1]) {
    const x0 = HW + 4;
    const tier = [[x0, 0.5], [x0 + 14, 11]].map(([x, y]) => [side * x, y]);
    const back = [[x0 + 14, 11], [x0 + 15, 11], [x0 + 15, -8], [x0, -8], [x0, 0.5]].map(([x, y]) => [side * x, y]);
    const roof = [[x0 - 2, 17], [x0 + 16, 19]].map(([x, y]) => [side * x, y]);
    const ordered = (p) => (side > 0 ? p : [...p].reverse());
    g.add(shadowed(new THREE.Mesh(extrude(track, ordered(tier), lo, hi, { vScale: 1 / 30 }), standMat)));
    g.add(shadowed(new THREE.Mesh(extrude(track, ordered(back), lo, hi, { vScale: 1 / 16 }), concrete)));
    g.add(shadowed(new THREE.Mesh(extrude(track, ordered(roof), lo, hi, { vScale: 1 / 16 }), roofMat)));
    // roof posts
    const fr = makeFrame();
    const p = new THREE.Vector3();
    for (let i = lo; i <= hi; i += 20) {
      track.pointAt(i * track.ds, side * (x0 + 14.5), 5, p, fr);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 28, 0.6), concrete);
      post.applyMatrix4(frameMatrix(fr, p));
      g.add(post);
    }
  }
  return g;
}
