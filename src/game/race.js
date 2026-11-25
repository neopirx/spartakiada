// A race session: builds the track world, spawns racers, runs countdown,
// laps, positions, audio hooks and results.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { TrackData, TAG } from '../track/trackData.js';
import { buildTrackMesh } from '../track/trackMesh.js';
import { Environment } from '../world/environment.js';
import { Vehicle, resolveCollisions } from '../vehicle/vehicle.js';
import { AIPilot } from '../vehicle/ai.js';
import { createCarInstance, LIVERIES } from '../vehicle/carModel.js';
import { roadTheme } from '../world/roadTextures.js';
import { CarFX } from '../fx/carFx.js';

const AI_NAMES = ['Kowalski', 'Nowak', 'Wiśniewska', 'Zieliński', 'Lewandowska', 'Kamiński', 'Wójcik', 'Szymańska'];

// Track + scenery, reusable between the menu preview and the race.
export class TrackWorld {
  constructor(scene, spec) {
    this.scene = scene;
    this.track = new TrackData(spec);
    this.mesh = buildTrackMesh(this.track, { road: roadTheme(spec.theme ?? spec.seed ?? 0) });
    scene.add(this.mesh.group);
    this.env = new Environment(scene, this.track, spec.seed || 1, { time: spec.time, city: spec.city, weather: spec.weather });
    if (this.env.weather.W.wet) this.mesh.setWet(1);
    else if (this.env.weather.W.snow) this.mesh.setWet(0.4);
  }

  update(dt, t) {
    this.mesh.update(dt, t);
    this.env.update(dt, t);
  }

  dispose(audio) {
    this.scene.remove(this.mesh.group);
    this.mesh.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.env.dispose(audio);
  }
}

export class Race {
  constructor({ world, scene, carTemplate, carTemplates, audio, hud, chase, laps, opponents, onFinish, fx, onHit, livery = 0 }) {
    this.fx = fx;
    this.onHit = onHit;
    this.world = world;
    this.track = world.track;
    this.scene = scene;
    this.audio = audio;
    this.hud = hud;
    this.chase = chase;
    this.laps = laps ?? CONFIG.race.laps;
    this.onFinish = onFinish;
    this.time = 0;
    this.raceTime = 0;
    this.state = 'countdown';
    this.countdown = 3.999;
    this.lastCount = 4;
    this.racers = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    const tr = this.track;
    const n = 1 + (opponents ?? CONFIG.race.opponents);
    // grid: two columns, staggered rows behind the start line. Player starts last-but-one.
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    const playerSlot = Math.max(0, n - 2);
    order.splice(order.indexOf(0), 1);
    order.splice(playerSlot, 0, 0);
    order.forEach((who, slot) => {
      const row = Math.floor(slot / 2);
      const col = slot % 2;
      const s = tr.startS - 8 - row * 11 - col * 4;
      const x = col ? 5.5 : -5.5;
      const isPlayer = who === 0;
      // opponents alternate between the available models
      const pool = carTemplates ? Object.values(carTemplates).filter(Boolean) : [carTemplate];
      const others = pool.filter((t) => t !== carTemplate);
      const tpl = isPlayer || !others.length ? carTemplate : who % 2 ? others[(who >> 1) % others.length] : carTemplate;
      const v = new Vehicle(tr, { s, x, isPlayer, name: isPlayer ? 'TY' : AI_NAMES[(who - 1) % AI_NAMES.length], skill: isPlayer ? 1 : 0.93 + ((who * 37) % 10) / 100, handling: tpl.def?.handling });
      v.startOffset = tr.deltaS(s, tr.startS); // distance to the line
      // rivals never wear the player's livery
      let liv = isPlayer ? livery : who % LIVERIES.length;
      if (!isPlayer && liv === livery % LIVERIES.length) liv = (liv + 1) % LIVERIES.length;
      const car = createCarInstance(tpl, liv);
      this.group.add(car.root);
      const carFx = fx ? new CarFX(car, fx, { player: isPlayer }) : null;
      const racer = { v, car, carFx, isPlayer, lap: 0, lapStart: 0, lapTimes: [], finishTime: null, id: `car${who}`, character: (tpl.def?.voice ?? 1) * (isPlayer ? 1 : 0.9 + ((who * 13) % 7) * 0.04) };
      if (!isPlayer) racer.ai = new AIPilot(v, tr, { aggression: Math.random(), lineOffset: (Math.random() - 0.5) * 6, reaction: 0.85 + Math.random() * 0.3 });
      this.racers.push(racer);
      v._place(0);
    });
    this.player = this.racers.find((r) => r.isPlayer);
    this.vehicles = this.racers.map((r) => r.v);
    this.best = null;
    hud.setupMap(tr);
    this._lights(0);
    hud.show(true);
    // camera distance follows the player's car size (Fiat 126p is ~3 m long)
    chase.scale = Math.min(1.1, Math.max(0.75, (this.player.car.bounds.length || 4.3) / 4.3));
    chase.snap();
    audio.startRace(n - 1, { character: carTemplate.def?.voice ?? 1 });
  }

  // autopilot input for the player (demo mode / automated tests)
  autoInput() {
    if (!this._auto) this._auto = new AIPilot(this.player.v, this.track, { aggression: 0.5 });
    return this._auto.update(1 / 60, this.vehicles, this.time);
  }

  progress(r) {
    return r.v.dist - r.v.startOffset; // 0 at the start line
  }

  update(dt, input) {
    this.time += dt;
    const tr = this.track;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this.lastCount) {
        this.lastCount = c;
        if (c > 0) {
          this.hud.big(String(c), 0.9);
          this.audio.countdown(false);
        }
        this._lights(4 - c);
      }
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.hud.big('START!', 1.2, 'go');
        this.audio.countdown(true);
        this._lights(5);
        for (const v of this.vehicles) v.locked = false;
        // launch boost if the player is already on the throttle
        if (input.throttle > 0.5) {
          this.player.v.boostTimer = 0.6;
          this.hud.message('DOBRY START!', 1.5);
        }
      }
    }
    if (this.state !== 'countdown') this.raceTime += dt;

    // --- vehicles ---------------------------------------------------------------
    for (const r of this.racers) {
      let inp;
      if (r.isPlayer && r.finishTime == null) inp = input;
      else if (r.ai) inp = r.ai.update(dt, this.vehicles, this.time);
      else {
        // finished player -> autopilot
        r.ai = new AIPilot(r.v, tr, { aggression: 0.2 });
        inp = r.ai.update(dt, this.vehicles, this.time);
      }
      if (this.state === 'countdown') {
        // revving on the grid
        r.v.throttle = r.isPlayer ? input.throttle : 0.3 + 0.3 * Math.sin(this.time * 3 + r.v.phase);
      }
      r.v.update(dt, inp, this.time);
    }
    resolveCollisions(this.vehicles, tr);
    const camPos = this.chase.camera.position;
    for (const r of this.racers) {
      r.v.applyTo(r.car, this.time, dt);
      if (r.carFx) {
        const d = r.v.position.distanceTo(camPos);
        r.carFx.update(r.v, dt, r.isPlayer ? 1 : Math.max(0, Math.min(1, 1.4 - d / 120)));
      }
    }
    // AI events -> fx only
    for (const r of this.racers) {
      if (r.isPlayer || !r.carFx) continue;
      for (const e of r.v.events) {
        if (e.type === 'boost') r.carFx.boostBurst(r.v);
        if (e.type === 'impact') r.carFx.impact(r.v, e.strength);
      }
    }

    // --- laps -----------------------------------------------------------------------
    for (const r of this.racers) {
      if (r.finishTime != null) continue;
      const p = this.progress(r);
      const lapNow = p >= 0 ? Math.floor(p / tr.length) + 1 : 0; // lap being driven
      if (lapNow > r.lap) {
        // crossed the line (going forwards; r.lap only ever increases)
        if (r.lap >= 1) {
          const lt = this.raceTime - r.lapStart;
          r.lapTimes.push(lt);
          if (r.isPlayer && (this.best == null || lt < this.best)) this.best = lt;
        }
        r.lap = lapNow;
        r.lapStart = this.raceTime;
        if (r.lap > this.laps) {
          r.finishTime = this.raceTime;
          if (r.isPlayer) this._playerFinished();
        } else if (r.isPlayer && r.lap >= 2) {
          const final = r.lap === this.laps;
          this.audio.lap(final);
          this.hud.message(final ? 'OSTATNIE OKRĄŻENIE!' : `OKRĄŻENIE ${r.lap}`, 2.2);
        }
      }
    }

    // --- positions ----------------------------------------------------------------------
    const ranked = [...this.racers].sort((a, b) => {
      if (a.finishTime != null && b.finishTime != null) return a.finishTime - b.finishTime;
      if (a.finishTime != null) return -1;
      if (b.finishTime != null) return 1;
      return this.progress(b) - this.progress(a);
    });
    ranked.forEach((r, i) => (r.position = i + 1));

    // --- player events -> audio / camera ----------------------------------------------------
    const pv = this.player.v;
    for (const e of pv.events) {
      if (e.type === 'boost') {
        this.audio.boostPickup();
        this.player.carFx?.boostBurst(pv);
        this.chase.fovKick = 1;
        this.hud.message('DOPALACZ!', 0.8);
      } else if (e.type === 'impact') {
        this.audio.impact(e.strength, e.side * 0.7);
        this.player.carFx?.impact(pv, e.strength);
        this.onHit?.(e.strength);
        this.chase.shake = Math.max(this.chase.shake, e.strength);
      } else if (e.type === 'land') {
        this.audio.impact(0.25 + e.strength * 0.4, 0);
        this.chase.shake = Math.max(this.chase.shake, 0.3 + e.strength * 0.5);
      } else if (e.type === 'bump') {
        this.audio.bump(e.strength);
        this.chase.shake = Math.max(this.chase.shake, e.strength * 0.5);
      }
    }
    for (const v of this.vehicles) v.events.length = 0;

    // --- camera + audio ------------------------------------------------------------------------
    this.chase.update(dt, pv);
    this.world.env.follow(pv.position);
    this.player.car.root.visible = this.chase.mode !== 2;
    const cam = this.chase.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    this.audio.setListener(cam.position, fwd, cam.up);
    const tags = pv.tags;
    this.audio.updatePlayer({
      speedNorm: pv.speed / 125,
      throttle: pv.throttle,
      boost: pv.boostTimer > 0 ? 1 : 0,
      airL: pv.airL,
      airR: pv.airR,
      scrape: pv.scrape,
      scrapeSide: Math.sign(pv.x),
      tunnel: (tags & TAG.TUNNEL) !== 0,
      magnetic: (tags & TAG.MAGNET) !== 0,
      dt,
    });
    const listener = { position: cam.position, velocity: this.chase.velocity };
    for (const r of this.racers) {
      if (r.isPlayer) continue;
      this.audio.updateOpponent(r.id, {
        position: r.v.position,
        velocity: r.v.velocity,
        speedNorm: r.v.speed / 125,
        throttle: r.v.throttle,
        boost: r.v.boostTimer > 0 ? 1 : 0,
        character: r.character,
        dt,
      }, listener);
    }

    // --- HUD -------------------------------------------------------------------------------------
    const pr = this.player;
    this.hud.update(dt, {
      speed: pv.speed,
      lap: Math.max(1, pr.lap),
      laps: this.laps,
      position: pr.position,
      racers: this.racers.length,
      time: pr.finishTime ?? (this.state === 'countdown' ? 0 : this.raceTime),
      lapTimes: pr.lapTimes,
      best: this.best,
      boost: pv.boostTimer > 0,
      wrongWay: this.state === 'racing' && Math.abs(pv.yaw) > 2.1 && pv.vF < -2,
    });
    this.hud.drawMap(this.vehicles, pv);

    if (this.state === 'finished') {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0 && !this.resultsShown) {
        this.resultsShown = true;
        this.onFinish?.(this.results());
      }
    }
  }

  _lights(n) {
    const lights = this.world.mesh.startLights;
    lights.forEach((l, i) => {
      if (n >= 5) l.material.color.setRGB(0.2, 3, 0.4);
      else l.material.color.setRGB(i < n ? 4 : 0.15, 0, 0);
    });
  }

  _playerFinished() {
    this.state = 'finished';
    this.finishTimer = 4;
    const pos = this.player.position;
    this.hud.big(pos === 1 ? 'ZWYCIĘSTWO!' : `META · ${pos}. MIEJSCE`, 3.5, 'go');
    this.audio.fanfare(pos <= 3);
  }

  results() {
    // estimate finish times for AI still racing
    const est = this.racers.map((r) => {
      if (r.finishTime != null) return { r, t: r.finishTime, done: true };
      const remaining = this.laps * this.track.length - this.progress(r);
      return { r, t: this.raceTime + remaining / Math.max(40, r.v.speed), done: false };
    });
    est.sort((a, b) => a.t - b.t);
    return {
      trackName: this.track.name,
      best: this.best,
      lapTimes: this.player.lapTimes,
      table: est.map((e, i) => ({ pos: i + 1, name: e.r.v.name, time: e.t, est: !e.done, player: e.r.isPlayer })),
    };
  }

  dispose() {
    for (const r of this.racers) r.carFx?.dispose();
    this.fx?.glow.clear();
    this.fx?.smoke.clear();
    this.scene.remove(this.group);
    this.audio.stopRace();
    this.hud.show(false);
  }
}
