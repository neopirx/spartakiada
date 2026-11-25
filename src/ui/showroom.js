// Car-select "showroom": a raw-concrete hall with a turntable, neon tubes,
// a propaganda banner and the selected craft idling on its hover engines.
// It is its own scene; main.js points the post-processing chain at it while
// the car-select screen is open.
import * as THREE from 'three';
import { createCarInstance } from '../vehicle/carModel.js';
import { CarFX } from '../fx/carFx.js';
import { FXWorld } from '../fx/particles.js';
import { retroifyObject, RETRO } from '../fx/retro.js';
import { concreteCanvas } from '../world/brutal.js';
import { makeFrame } from '../track/trackData.js';

const HOVER = 0.75;

function canvasTex(c, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}

function turntableTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1818';
  g.fillRect(0, 0, 512, 512);
  // radial red / cream segments with a dark hub
  const n = 24;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.moveTo(256, 256);
    g.arc(256, 256, 250, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
    g.closePath();
    g.fillStyle = i % 2 ? '#2a2626' : '#3a3434';
    g.fill();
  }
  g.lineWidth = 14;
  g.strokeStyle = '#b0141c';
  g.beginPath();
  g.arc(256, 256, 236, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.strokeStyle = '#e9e1cf';
  g.beginPath();
  g.arc(256, 256, 222, 0, Math.PI * 2);
  g.stroke();
  // big red star in the middle
  g.fillStyle = '#7a1018';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 46 : 110;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    g.lineTo(256 + Math.cos(a) * r, 256 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  return canvasTex(c);
}

function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b0141c';
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#e9e1cf';
  g.fillRect(0, 18, 1024, 6);
  g.fillRect(0, 232, 1024, 6);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '150px Propaganda, "Arial Black", sans-serif';
  g.fillStyle = '#1a0a0a';
  g.fillText('SPARTAKIADA', 518, 136);
  g.fillStyle = '#f1e8d4';
  g.fillText('SPARTAKIADA', 512, 130);
  return canvasTex(c);
}

function sloganTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e1cf';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#b0141c';
  g.fillRect(0, 0, 96, 128);
  g.textBaseline = 'middle';
  g.font = '64px Kremlin, "Arial Black", sans-serif';
  g.fillStyle = '#16120f';
  g.fillText(text, 112, 68);
  // white star on the red block
  g.fillStyle = '#f1e8d4';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 14 : 34;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    g.lineTo(48 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  return canvasTex(c);
}

export class Showroom {
  constructor(envTexture) {
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x07060a);
    scene.environment = envTexture;
    scene.environmentIntensity = 0.25;
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.3, 200);
    this.fx = new FXWorld(scene);
    this.fx.camera = this.camera;
    this.time = 0;
    this.spin = 0.6;
    this.revT = -1;
    this.dir = 1;
    this._build();
    retroifyObject(this.hall, { snap: false });
  }

  _build() {
    const hall = (this.hall = new THREE.Group());
    this.scene.add(hall);
    const conc = canvasTex(concreteCanvas(256, 256, 7, 150), [6, 2]);
    const concFloor = canvasTex(concreteCanvas(256, 256, 9, 120), [8, 8]);

    // floor + back wall + side walls (board-marked concrete)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: concFloor, roughness: 0.55, metalness: 0.1, color: 0x8a8682 }));
    floor.rotation.x = -Math.PI / 2;
    hall.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.95, color: 0x9a948c });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), wallMat);
    back.position.set(0, 10, -11);
    hall.add(back);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), wallMat);
      side.position.set(sx * 18, 10, 6);
      side.rotation.y = -sx * Math.PI / 2;
      hall.add(side);
    }
    // ribbed concrete columns along the back wall
    const colMat = new THREE.MeshStandardMaterial({ map: canvasTex(concreteCanvas(64, 256, 3, 170), [1, 2]), roughness: 0.9, color: 0xb0aaa2 });
    for (const x of [-13, -6.5, 6.5, 13]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 20, 1.4), colMat);
      c.position.set(x, 10, -10.3);
      hall.add(c);
    }
    // ceiling beams
    for (let z = -8; z <= 12; z += 5) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 0.8), colMat);
      b.position.set(0, 12, z);
      hall.add(b);
    }

    // banner + slogans
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshBasicMaterial({ map: bannerTexture(), color: 0xb8b0a8 }));
    banner.position.set(0, 7.8, -10.9);
    hall.add(banner);
    const slogans = ['SZYBCIEJ', 'WYZEJ', 'DALEJ'];
    slogans.forEach((t, i) => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: sloganTexture(t), color: 0xa8a098 }));
      s.position.set(-17.9, 6.5 - i * 1.6, 2 + i * 0.6);
      s.rotation.y = Math.PI / 2;
      hall.add(s);
    });

    // neon tubes (bright, bloom picks them up)
    const neon = (color, x, y, z, w, h) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), toneMapped: false }));
      m.position.set(x, y, z);
      hall.add(m);
      return m;
    };
    this.neons = [
      neon([3.2, 0.25, 0.3], -9.8, 4, -10.8, 0.14, 7),
      neon([3.2, 0.25, 0.3], 9.8, 4, -10.8, 0.14, 7),
      neon([0.35, 1.6, 3.0], 0, 10.4, -10.8, 17, 0.14),
      neon([0.35, 1.6, 3.0], 0, 5.3, -10.8, 17, 0.1),
    ];

    // turntable
    this.table = new THREE.Group();
    hall.add(this.table);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.3, 48), [
      new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.5, metalness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: turntableTexture(), roughness: 0.45, metalness: 0.2 }),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    ]);
    top.position.y = 0.15;
    this.table.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.45, 0.06, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.35), toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    hall.add(ring);

    // light cones from the ceiling (additive, era-style fake volumetrics)
    const coneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.045, 0.04, 0.034), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const x of [-2.6, 2.6]) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 3.4, 11.5, 24, 1, true), coneMat);
      cone.position.set(x, 6.1, 0.4);
      hall.add(cone);
    }

    // lights
    this.scene.add(new THREE.HemisphereLight(0x8a90b0, 0x302020, 0.5));
    const key = new THREE.SpotLight(0xfff0dc, 150, 40, 0.5, 0.5, 1.6);
    key.position.set(4, 11, 7);
    key.target.position.set(0, 0.6, 0);
    this.scene.add(key, key.target);
    const key2 = new THREE.SpotLight(0xffe8d0, 70, 40, 0.55, 0.6, 1.6);
    key2.position.set(-6, 10, 3);
    key2.target.position.set(0, 0.6, 0);
    this.scene.add(key2, key2.target);
    const rim = new THREE.PointLight(0xff3040, 60, 18, 2);
    rim.position.set(0, 3, -7);
    this.scene.add(rim);
    const fill = new THREE.PointLight(0x4080ff, 30, 16, 2);
    fill.position.set(-7, 2, 6);
    this.scene.add(fill);
  }

  /**
   * Put a car on the turntable.
   * @param {object} template from loadCarModel
   * @param {number} livery
   */
  setCar(template, livery = 0) {
    if (this.car) {
      this.carFx?.dispose();
      this.car.root.removeFromParent();
    }
    const car = createCarInstance(template, livery);
    car.root.position.y = 0.3 + HOVER;
    this.table.add(car.root);
    this.car = car;
    this.carFx = new CarFX(car, this.fx, { player: true });
    retroifyObject(car.root);
    car.animate({ h: HOVER });
    // a vehicle-shaped stub for CarFX.update
    if (!this.stub) {
      this.stub = {
        throttle: 0.15, boostTimer: 0, speed: 0, steer: 0, brake: 0, h: HOVER, scrape: 0, airborne: false, x: 0,
        frame: makeFrame(), velocity: new THREE.Vector3(), heading: new THREE.Vector3(0, 0, 1), position: new THREE.Vector3(),
      };
      this.stub.frame.up.set(0, 1, 0);
      this.stub.frame.right.set(1, 0, 0);
      this.stub.frame.fwd.set(0, 0, 1);
    }
    // frame the car: the Fiat is much smaller than the Polonez
    const L = template.bounds.length || 4.3;
    this.dist = 6.2 + L * 1.55;
    this.time = 0;
  }

  // engine blip, mirrors AudioEngine.preview()
  rev() {
    this.revT = 0;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.table.rotation.y += dt * 0.45;
    // camera: low three-quarter view, slow drift
    const a = 0.75 + Math.sin(t * 0.25) * 0.12;
    const d = this.dist || 12;
    this.camera.position.set(Math.sin(a) * d, 2.3 + Math.sin(t * 0.3) * 0.2, Math.cos(a) * d);
    // aim left of the car so it sits in the right half (the info card is on the left)
    const side = d * 0.16;
    this.camera.lookAt(-Math.cos(a) * side, 0.9, Math.sin(a) * side);
    this.camera.fov = 30;
    this.camera.updateProjectionMatrix();
    // flickering neon (smooth)
    const k = 0.92 + 0.08 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
    this.neons[0].material.color.setRGB(3.2 * k, 0.25 * k, 0.3 * k);

    if (!this.car) return;
    // throttle follows the engine blip
    let thr = 0.15;
    if (this.revT >= 0) {
      this.revT += dt;
      const r = this.revT;
      if ((r > 0.15 && r < 0.75) || (r > 1.05 && r < 1.75)) thr = 1;
      if (r > 3.4) this.revT = -1;
    }
    const s = this.stub;
    s.throttle += (thr - s.throttle) * Math.min(1, dt * 8);
    this.car.root.updateMatrixWorld(true);
    s.position.setFromMatrixPosition(this.car.root.matrixWorld);
    this.car.body.position.y = Math.sin(t * 2.3) * 0.06;
    this.car.body.rotation.x = -s.throttle * 0.04;
    this.carFx.update(s, dt, 1);
    this.fx.setViewport(RETRO.enabled ? RETRO.height : window.innerHeight, this.camera.fov);
    this.fx.update(dt);
  }
}
