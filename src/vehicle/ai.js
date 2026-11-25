// AI pilot: produces the same input object a human would.
import { CONFIG } from '../config.js';

export class AIPilot {
  constructor(vehicle, track, { aggression = 0.5, lineOffset = 0, reaction = 1 } = {}) {
    this.v = vehicle;
    this.track = track;
    this.aggression = aggression;
    this.lineOffset = lineOffset;
    this.reaction = reaction;
    this.wobble = Math.random() * 100;
    this.input = { throttle: 0, steer: 0, airL: false, airR: false, brake: false };
  }

  update(dt, others, time) {
    const v = this.v;
    const tr = this.track;
    const speed = Math.max(5, v.speed);
    const HW = tr.width / 2 - 2.2;

    // racing line: drift towards the inside of upcoming curvature
    const look = 25 + speed * 0.7;
    let kAhead = 0;
    let wsum = 0;
    for (let d = 10; d <= look * 2; d += 8) {
      const w = 1 / (1 + d / look);
      kAhead += tr.kappaAt(v.s + d) * w;
      wsum += w;
    }
    kAhead /= wsum;
    let targetX = Math.max(-HW, Math.min(HW, kAhead * 750)) + this.lineOffset + Math.sin(time * 0.3 + this.wobble) * 2;

    // go for booster pads ahead
    for (const b of tr.boosts) {
      const d = tr.deltaS(v.s, b.s);
      if (d > 5 && d < 90 && Math.abs(b.x - v.x) < 12) {
        targetX = b.x;
        break;
      }
    }
    // avoid cars just ahead
    for (const o of others) {
      if (o === v) continue;
      const d = tr.deltaS(v.s, o.s);
      if (d > 0 && d < 22 && Math.abs(o.x - targetX) < 3.5) {
        targetX = o.x + (o.x > 0 ? -5 : 5) * (0.6 + this.aggression * 0.4);
      }
    }
    targetX = Math.max(-HW, Math.min(HW, targetX));

    // desired heading relative to the track + curvature feed-forward
    const k = tr.kappaAt(v.s + speed * 0.15);
    const desiredYaw = Math.atan2(targetX - v.x, Math.max(18, speed * 0.55));
    const c = CONFIG.car;
    const vn = Math.min(1, speed / 125);
    const rate = c.steerRateLow + (c.steerRateHigh - c.steerRateLow) * vn;
    const ff = (k * v.vF) / rate;
    let steer = (desiredYaw - v.yaw) * 2.6 * this.reaction + ff - v.vX * 0.02;
    const need = Math.abs(steer);
    steer = Math.max(-1, Math.min(1, steer));

    // airbrake when steering is saturated
    let airL = false;
    let airR = false;
    if (need > 1.05) {
      if (steer > 0) airR = true;
      else airL = true;
    }

    // speed planning: max speed the yaw rate allows through upcoming curves
    let throttle = 1;
    let brake = false;
    const yawCap = c.steerRateHigh + c.airbrakeYaw * 0.9;
    let vMax = 999;
    for (let d = 0; d < 160; d += 10) {
      const kk = Math.abs(tr.kappaAt(v.s + d));
      if (kk > 1e-4) vMax = Math.min(vMax, yawCap / kk + d * 0.5);
    }
    if (speed > vMax * 1.04) {
      throttle = 0.3;
      airL = airR = true;
    }
    if (speed > vMax * 1.2) brake = true;

    Object.assign(this.input, { throttle, steer, airL, airR, brake });
    return this.input;
  }
}
