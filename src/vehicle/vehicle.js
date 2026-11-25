// Anti-grav vehicle physics in track space.
//
// The craft lives on the track surface: s = distance along the centerline,
// x = lateral offset (+ right), yaw = heading relative to the track tangent.
// Velocity is kept in the local (forward, right) plane. When the track turns
// under the craft, heading and velocity are counter-rotated – so the craft
// keeps its world direction (inertia) and the pilot must steer through
// corners. Loops and barrel rolls are "magnetic": gravity is ignored there.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeFrame, TAG } from '../track/trackData.js';

const G = 9.81;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _left = new THREE.Vector3();
const _fw = new THREE.Vector3();

export class Vehicle {
  constructor(track, { s = 0, x = 0, name = 'Gracz', isPlayer = false, skill = 1, handling = null } = {}) {
    this.track = track;
    // per-car multipliers on CONFIG.car (see CAR_MODELS.handling)
    this.hd = { thrust: 1, drag: 1, steer: 1, grip: 1, ...(handling || {}) };
    this.name = name;
    this.isPlayer = isPlayer;
    this.skill = skill; // thrust multiplier for AI variety
    this.s = track.wrapS(s);
    this.dist = 0; // unwrapped distance travelled since spawn (for laps)
    this.x = x;
    this.vF = 0;
    this.vX = 0;
    this.yaw = 0;
    this.yawRate = 0;
    this.h = CONFIG.car.hover;
    this.phase = Math.random() * 10;
    this.boostTimer = 0;
    this.padCooldown = 0;
    this.steer = 0;
    this.throttle = 0;
    this.airL = 0;
    this.airR = 0;
    this.brake = 0;
    this.accel = 0;
    this.scrape = 0;
    this.tags = 0;
    this.airborne = false;
    this.airLift = 0;
    this.frame = makeFrame();
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.events = []; // {type:'impact'|'boost'|'bump', strength}
    this.locked = true; // true during countdown
    this.finished = false;
    this._lastPos = null;
  }

  get speed() {
    return Math.hypot(this.vF, this.vX);
  }

  update(dt, input, time) {
    const c = CONFIG.car;
    const tr = this.track;
    const HW = tr.width / 2;

    // --- inputs -----------------------------------------------------------------
    const k = Math.min(1, dt * 9);
    this.steer += ((input.steer || 0) - this.steer) * k;
    this.throttle += ((input.throttle || 0) - this.throttle) * Math.min(1, dt * 6);
    this.airL += ((input.airL ? 1 : 0) - this.airL) * k;
    this.airR += ((input.airR ? 1 : 0) - this.airR) * k;
    this.brake = input.brake ? 1 : 0;
    if (this.locked) {
      this.vF *= Math.exp(-dt * 4);
      this.vX *= Math.exp(-dt * 4);
      this._place(time);
      return;
    }

    const tags = (this.tags = tr.tagsAt(this.s));
    const magnetic = (tags & TAG.MAGNET) !== 0;
    const inAir = (tags & TAG.AIR) !== 0;
    if (this.airborne && !inAir) this.events.push({ type: 'land', strength: Math.min(1, this.speed / 120) });
    this.airborne = inAir;
    this.airLift += ((inAir ? 1.4 : 0) - this.airLift) * Math.min(1, dt * (inAir ? 3 : 12));
    const fr = tr.frameAt(this.s, this.frame);
    const kappa = tr.kappaAt(this.s);

    const ch = Math.cos(this.yaw);
    const sh = Math.sin(this.yaw);
    let vLong = this.vF * ch + this.vX * sh;
    let vLat = -this.vF * sh + this.vX * ch;
    const speed = Math.abs(vLong);
    const vTop = 125;

    // --- longitudinal ------------------------------------------------------------
    const hd = this.hd;
    let a = c.thrust * hd.thrust * this.skill * this.throttle;
    a -= (c.dragLin * vLong + c.dragQuad * vLong * Math.abs(vLong)) * hd.drag;
    if (this.boostTimer > 0) a += c.boostAccel * Math.max(0, 1 - vLong / (vTop + c.boostMaxExtra));
    if (this.brake) a -= vLong > 1 ? c.brake : vLong > -12 ? 12 : 0;
    const air = this.airL + this.airR;
    a -= 0.11 * air * 0.5 * vLong;
    if (!magnetic) a -= G * c.slopeGravity * fr.fwd.dot(WORLD_UP);
    vLong += a * dt;
    this.accel = a;

    // --- lateral grip --------------------------------------------------------------
    const grip = c.grip * hd.grip + air * 0.5 * c.airbrakeGrip;
    vLat *= Math.exp(-grip * dt);

    this.vF = vLong * ch - vLat * sh;
    this.vX = vLong * sh + vLat * ch;
    // banked / tilted surfaces push the craft downhill
    if (!magnetic) this.vX += -G * 0.8 * fr.right.dot(WORLD_UP) * dt;

    // --- steering ---------------------------------------------------------------------
    const vn = Math.min(1, speed / vTop);
    const rate = (c.steerRateLow + (c.steerRateHigh - c.steerRateLow) * vn) * hd.steer;
    const targetYawRate = this.steer * rate * (this.airborne ? 0.35 : 1) + (this.airR - this.airL) * c.airbrakeYaw * Math.min(1, speed / 25);
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1, dt * 7);

    // --- track curvature (world inertia) ------------------------------------------------
    const sDot = this.vF / Math.max(0.35, 1 - kappa * this.x);
    const turn = kappa * sDot * dt;
    this.yaw += this.yawRate * dt - turn;
    const ct = Math.cos(turn);
    const st = Math.sin(turn);
    const nvF = this.vF * ct + this.vX * st;
    this.vX = -this.vF * st + this.vX * ct;
    this.vF = nvF;
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    this.s = tr.wrapS(this.s + sDot * dt);
    this.dist += sDot * dt;
    this.x += this.vX * dt;

    // --- walls --------------------------------------------------------------------------
    const lim = HW - c.halfWidth;
    this.scrape = Math.max(0, this.scrape - dt * 4);
    if (Math.abs(this.x) > lim) {
      const side = Math.sign(this.x);
      this.x = side * lim;
      const impact = this.vX * side;
      if (impact > 0) {
        this.vX = -side * impact * 0.3;
        this.vF *= 1 - Math.min(0.35, impact * 0.012);
        if (impact > 4) this.events.push({ type: 'impact', strength: Math.min(1, impact / 30), side });
      }
      // turn the nose away from the wall
      if (this.yaw * side > 0) this.yaw *= Math.exp(-dt * 10);
      this.vF *= Math.exp(-dt * 0.35);
      this.scrape = Math.min(1, Math.abs(this.vF) / 90 * (0.35 + Math.abs(Math.sin(this.yaw)) * 3));
    }

    // --- booster pads ---------------------------------------------------------------------
    this.padCooldown -= dt;
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.padCooldown <= 0) {
      for (const b of tr.boosts) {
        const d = tr.deltaS(b.s, this.s);
        if (Math.abs(d) < b.length / 2 && Math.abs(this.x - b.x) < b.width / 2 + 0.6) {
          this.boostTimer = c.boostTime;
          this.padCooldown = 0.35;
          this.events.push({ type: 'boost' });
          break;
        }
      }
    }

    this._place(time);
  }

  // Compute world transform from track-space state.
  _place(time) {
    const fr = this.track.frameAt(this.s, this.frame);
    this.h = CONFIG.car.hover + Math.sin(time * 2.3 + this.phase) * 0.07 + this.airLift;
    const prev = this._lastPos ? this._lastPos.copy(this.position) : (this._lastPos = new THREE.Vector3());
    this.position.copy(fr.pos).addScaledVector(fr.right, this.x).addScaledVector(fr.up, this.h);
    _fw.copy(fr.fwd).multiplyScalar(Math.cos(this.yaw)).addScaledVector(fr.right, Math.sin(this.yaw));
    this.heading.copy(_fw);
    _left.crossVectors(fr.up, _fw);
    _m.makeBasis(_left, fr.up, _fw);
    this.quaternion.setFromRotationMatrix(_m);
    if (this._hadPos) this.velocity.subVectors(this.position, prev).multiplyScalar(1 / Math.max(1e-3, this._dt || 1 / 60));
    this._hadPos = true;
  }

  applyTo(car, time, dt) {
    this._dt = dt;
    car.root.position.copy(this.position);
    car.root.quaternion.copy(this.quaternion);
    // visual body motion
    const b = car.body;
    const lean = this.steer * 0.32 + (this.airR - this.airL) * 0.12;
    b.rotation.z += (lean - b.rotation.z) * Math.min(1, dt * 6);
    const pitch = -THREE.MathUtils.clamp(this.accel * 0.004, -0.08, 0.08);
    b.rotation.x += (pitch - b.rotation.x) * Math.min(1, dt * 4);
    car.animate(this, time);
  }
}

// Simple car-vs-car separation in track space.
export function resolveCollisions(vehicles, track) {
  const len = 4.8;
  const wid = 2.5;
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const ds = track.deltaS(a.s, b.s);
      const dx = b.x - a.x;
      if (Math.abs(ds) < len && Math.abs(dx) < wid) {
        const ox = wid - Math.abs(dx);
        const os = len - Math.abs(ds);
        if (ox < os) {
          const dir = Math.sign(dx) || 1;
          a.x -= (dir * ox) / 2;
          b.x += (dir * ox) / 2;
          const rv = b.vX - a.vX;
          if (rv * dir < 0) {
            a.vX += rv * 0.6;
            b.vX -= rv * 0.6;
          }
          const st = Math.min(1, Math.abs(rv) / 20);
          if (st > 0.1) {
            a.events.push({ type: 'bump', strength: st, other: b });
            b.events.push({ type: 'bump', strength: st, other: a });
          }
        } else {
          // rear-end: swap part of the forward speed
          const front = ds > 0 ? b : a;
          const back = ds > 0 ? a : b;
          const push = os / 2;
          back.s = track.wrapS(back.s - push);
          back.dist -= push;
          front.s = track.wrapS(front.s + push);
          front.dist += push;
          const rv = back.vF - front.vF;
          if (rv > 0) {
            back.vF -= rv * 0.6;
            front.vF += rv * 0.4;
            const st = Math.min(1, rv / 25);
            if (st > 0.08) {
              a.events.push({ type: 'bump', strength: st, other: b });
              b.events.push({ type: 'bump', strength: st, other: a });
            }
          }
        }
      }
    }
  }
}
