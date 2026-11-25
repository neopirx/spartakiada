// Chase camera that follows the craft and rolls with the track (loops!).
import * as THREE from 'three';
import { makeFrame } from '../track/trackData.js';

const _fr = makeFrame();
const _p = new THREE.Vector3();

const MODES = [
  { name: 'chase', back: 7.2, up: 2.4, look: 8, lookUp: 1.1, fov: 68 },
  { name: 'far', back: 12, up: 4.0, look: 10, lookUp: 1.2, fov: 64 },
  { name: 'bumper', back: -1.2, up: 1.35, look: 20, lookUp: 1.1, fov: 78 },
];

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.fovKick = 0;
    this.initialised = false;
    this.scale = 1; // set per car (camera distance / height)
    this.velocity = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this.t = 0;
  }

  cycle() {
    this.mode = (this.mode + 1) % MODES.length;
    this.initialised = false;
  }

  snap() {
    this.initialised = false;
  }

  // Keep `p` at least `minH` above the road surface at track distance s
  // (and inside the walls) – stops the camera dipping under the road at the
  // bottom of ramps, hills, jumps and loops.
  _keepAboveRoad(p, track, s, minH) {
    track.frameAt(s, _fr);
    _p.subVectors(p, _fr.pos);
    const h = _p.dot(_fr.up);
    if (h < minH) p.addScaledVector(_fr.up, minH - h);
    const x = _p.dot(_fr.right);
    const lim = track.width / 2 + 0.5;
    if (Math.abs(x) > lim) p.addScaledVector(_fr.right, Math.sign(x) * lim - x);
  }

  update(dt, v) {
    const base = MODES[this.mode];
    const k = this.scale;
    const m = base.name === 'bumper' ? base : { ...base, back: base.back * k, up: base.up * (0.4 + 0.6 * k), lookUp: base.lookUp * k };
    const fr = v.frame;
    const heading = v.heading;
    // follow the craft's heading, but keep some of the track direction for stability
    const dir = new THREE.Vector3().copy(heading).lerp(fr.fwd, 0.35).normalize();
    const target = new THREE.Vector3().copy(v.position).addScaledVector(dir, -m.back).addScaledVector(fr.up, m.up);
    const look = new THREE.Vector3().copy(v.position).addScaledVector(heading, m.look).addScaledVector(fr.up, m.lookUp);

    if (!this.initialised) {
      this.pos.copy(target);
      this.look.copy(look);
      this.up.copy(fr.up);
      this._prev.copy(target);
      this.initialised = true;
    }
    const stiff = m.name === 'bumper' ? 1 : 1 - Math.exp(-dt * 12);
    this.pos.lerp(target, stiff);
    this.look.lerp(look, m.name === 'bumper' ? 1 : 1 - Math.exp(-dt * 18));
    this.up.lerp(fr.up, 1 - Math.exp(-dt * 6)).normalize();
    if (m.name !== 'bumper') this._keepAboveRoad(this.pos, v.track, v.s - m.back, m.up * 0.6);

    const cam = this.camera;
    cam.position.copy(this.pos);
    // Shake and rumble use smooth noise (sums of sines), never per-frame
    // random offsets: a camera that jumps every frame makes the whole road
    // texture strobe.
    this.t += dt;
    const t = this.t;
    const n1 = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.7 + 1.3) * 0.4;
    const n2 = Math.sin(t * 31.3 + 2.1) * 0.6 + Math.sin(t * 19.9 + 0.4) * 0.4;
    const n3 = Math.sin(t * 29.3 + 4.2) * 0.6 + Math.sin(t * 41.9 + 2.7) * 0.4;
    if (this.shake > 0) {
      const s = this.shake * 0.3;
      cam.position.x += n1 * s;
      cam.position.y += n2 * s;
      cam.position.z += n3 * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    // high-speed rumble: a slow, low-amplitude bob
    const sp = Math.min(1.3, v.speed / 125);
    const rumble = Math.max(0, sp - 0.7) * 0.025;
    cam.position.addScaledVector(fr.up, (Math.sin(t * 13.0) * 0.6 + Math.sin(t * 7.3 + 1.0) * 0.4) * rumble);

    cam.up.copy(this.up);
    cam.lookAt(this.look);

    this.fovKick = Math.max(0, this.fovKick - dt * 1.5);
    const fov = m.fov + sp * 11 + (v.boostTimer > 0 ? 6 : 0) + this.fovKick * 8;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();

    this.velocity.subVectors(cam.position, this._prev).multiplyScalar(1 / Math.max(dt, 1e-3));
    this._prev.copy(cam.position);
  }
}
