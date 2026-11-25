// Procedural sound engine – everything is synthesised with the Web Audio API.
//
//   master ── compressor ── destination
//     ├─ engineBus  (player engine, opponents via 3D panners)
//     ├─ fxBus      (wind, airbrakes, scrape, one-shots)
//     └─ reverb     (convolver with generated IR; send level rises in tunnels)
//
// The race calls `updatePlayer(state)` and `updateOpponent(...)` each frame.
import { EngineVoice } from './engineVoice.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.8;
    this.opponents = new Map();
  }

  // Must be called from a user gesture.
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.8);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.9;
    this.reverb.connect(this.reverbOut).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.12;
    this.reverbSend.connect(this.reverb);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.9;
    this.engineBus.connect(this.master);
    this.engineBus.connect(this.reverbSend);
    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = 1;
    this.fxBus.connect(this.master);
    this.fxBus.connect(this.reverbSend);
    // menu sounds skip the master gain, so they stay audible while paused
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.6 * this.volume;
    this.uiBus.connect(ctx.destination);

    this._buffers = {
      white: this._noiseBuffer('white'),
      pink: this._noiseBuffer('pink'),
      brown: this._noiseBuffer('brown'),
    };
    this.enabled = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    if (this.uiBus) this.uiBus.gain.setTargetAtTime(0.6 * v, this.ctx.currentTime, 0.05);
  }

  // pause menu: silence engines / effects (the music has its own bus)
  mute(on) {
    this.muted = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------------------
  // building blocks
  _noiseBuffer(kind) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  noiseSource(kind = 'white') {
    const src = this.ctx.createBufferSource();
    src.buffer = this._buffers[kind];
    src.loop = true;
    src.loopStart = Math.random() * 2;
    src.start(this.ctx.currentTime, Math.random() * 2);
    return src;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections + diffuse tail
        const er = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + er) * 0.6;
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Race session: player engine + environmental layers
  startRace(opponentCount = 0, { character = 1 } = {}) {
    if (!this.enabled) return;
    this.stopRace();
    this.stopPreview();
    const ctx = this.ctx;
    this.player = new EngineVoice(this, { quality: 'full', output: this.engineBus, character });

    // wind / air rush
    this.wind = this.noiseSource('pink');
    this.windLP = ctx.createBiquadFilter();
    this.windLP.type = 'lowpass';
    this.windBP = ctx.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.Q.value = 3;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windWhistle = ctx.createGain();
    this.windWhistle.gain.value = 0;
    this.wind.connect(this.windLP).connect(this.windGain).connect(this.fxBus);
    this.wind.connect(this.windBP).connect(this.windWhistle).connect(this.fxBus);

    // airbrakes (stereo hiss)
    this.air = [];
    for (const pan of [-0.7, 0.7]) {
      const n = this.noiseSource('white');
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const pk = ctx.createBiquadFilter();
      pk.type = 'peaking';
      pk.frequency.value = 3400;
      pk.gain.value = 3;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      n.connect(hp).connect(pk).connect(g).connect(p).connect(this.fxBus);
      this.air.push({ n, g });
    }

    // wall scrape: noise + ring-modulated metal
    const sn = this.noiseSource('white');
    this.scrapeBP = ctx.createBiquadFilter();
    this.scrapeBP.type = 'bandpass';
    this.scrapeBP.frequency.value = 1800;
    this.scrapeBP.Q.value = 3;
    const m1 = ctx.createOscillator();
    m1.type = 'square';
    m1.frequency.value = 870;
    const m2 = ctx.createOscillator();
    m2.type = 'square';
    m2.frequency.value = 1313;
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const m2g = ctx.createGain();
    m2g.gain.value = 0.5;
    m1.connect(ring);
    m2.connect(m2g).connect(ring.gain);
    const ringBP = ctx.createBiquadFilter();
    ringBP.type = 'bandpass';
    ringBP.frequency.value = 2400;
    ringBP.Q.value = 2;
    const ringG = ctx.createGain();
    ringG.gain.value = 0.25;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.scrapePan = ctx.createStereoPanner();
    sn.connect(this.scrapeBP).connect(this.scrapeGain);
    ring.connect(ringBP).connect(ringG).connect(this.scrapeGain);
    this.scrapeGain.connect(this.scrapePan).connect(this.fxBus);
    m1.start();
    m2.start();
    this._scrapeNodes = [sn, m1, m2];

    // magnetic strip hum (loops / barrel rolls)
    const h1 = ctx.createOscillator();
    h1.type = 'sawtooth';
    h1.frequency.value = 50;
    const h2 = ctx.createOscillator();
    h2.type = 'square';
    h2.frequency.value = 100.7;
    const hLP = ctx.createBiquadFilter();
    hLP.type = 'lowpass';
    hLP.frequency.value = 420;
    const trem = ctx.createOscillator();
    trem.frequency.value = 9;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.5;
    this.magGain = ctx.createGain();
    this.magGain.gain.value = 0;
    const magAM = ctx.createGain();
    magAM.gain.value = 0.5;
    trem.connect(tremG).connect(magAM.gain);
    h1.connect(hLP);
    h2.connect(hLP);
    hLP.connect(magAM).connect(this.magGain).connect(this.fxBus);
    for (const o of [h1, h2, trem]) o.start();
    this._magNodes = [h1, h2, trem];

    this.session = true;
  }

  stopRace() {
    if (!this.session) return;
    this.player?.stop();
    for (const v of this.opponents.values()) v.voice.stop();
    this.opponents.clear();
    const kill = (n) => { try { n.stop(); } catch { /* ignore */ } };
    kill(this.wind);
    this.air.forEach((a) => kill(a.n));
    this._scrapeNodes.forEach(kill);
    this._magNodes.forEach(kill);
    this.session = false;
  }

  /**
   * @param {object} st { speedNorm, throttle, boost, airL, airR, scrape, scrapeSide,
   *                      tunnel, magnetic, dt }
   */
  updatePlayer(st) {
    if (!this.session) return;
    const t = this.ctx.currentTime;
    this.player.update({ speedNorm: st.speedNorm, throttle: st.throttle, boost: st.boost, dt: st.dt, volume: 1 });

    const sp = Math.min(1.4, st.speedNorm);
    const gust = 0.85 + 0.15 * Math.sin(t * 1.7) * Math.sin(t * 0.63);
    this.windLP.frequency.setTargetAtTime(250 + 3800 * sp, t, 0.1);
    this.windGain.gain.setTargetAtTime(0.42 * sp * sp * gust, t, 0.1);
    this.windBP.frequency.setTargetAtTime(700 + 1600 * sp, t, 0.2);
    this.windWhistle.gain.setTargetAtTime(0.06 * Math.max(0, sp - 0.6) * gust, t, 0.2);

    this.air[0].g.gain.setTargetAtTime(st.airL * (0.05 + 0.25 * sp), t, 0.04);
    this.air[1].g.gain.setTargetAtTime(st.airR * (0.05 + 0.25 * sp), t, 0.04);

    const sc = st.scrape;
    this.scrapeGain.gain.setTargetAtTime(sc * (0.35 + Math.random() * 0.4), t, 0.02);
    this.scrapeBP.frequency.setTargetAtTime(1200 + Math.random() * 1800, t, 0.015);
    this.scrapePan.pan.setTargetAtTime(st.scrapeSide * 0.8, t, 0.05);

    this.magGain.gain.setTargetAtTime(st.magnetic ? 0.09 + 0.05 * sp : 0, t, 0.15);
    this.reverbSend.gain.setTargetAtTime(st.tunnel ? 0.7 : 0.1, t, 0.15);
  }

  // Opponent engines are positional (PannerNode) with manual Doppler.
  updateOpponent(id, { position, velocity, speedNorm, throttle, boost, character, dt }, listener) {
    if (!this.session) return;
    let o = this.opponents.get(id);
    if (!o) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 7;
      panner.rolloffFactor = 1.3;
      panner.maxDistance = 2000;
      panner.connect(this.engineBus);
      const voice = new EngineVoice(this, { quality: 'lite', output: panner, character });
      o = { panner, voice };
      this.opponents.set(id, o);
    }
    const t = this.ctx.currentTime;
    const p = o.panner;
    if (p.positionX) {
      p.positionX.setTargetAtTime(position.x, t, 0.02);
      p.positionY.setTargetAtTime(position.y, t, 0.02);
      p.positionZ.setTargetAtTime(position.z, t, 0.02);
    } else p.setPosition(position.x, position.y, position.z);

    // Doppler: f' = f * (c + v_listener) / (c - v_source) along line of sight
    const dx = position.x - listener.position.x;
    const dy = position.y - listener.position.y;
    const dz = position.z - listener.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const vs = velocity.x * nx + velocity.y * ny + velocity.z * nz; // + = moving away
    const vl = listener.velocity.x * nx + listener.velocity.y * ny + listener.velocity.z * nz; // + = moving toward source
    const C = 343;
    const doppler = Math.max(0.5, Math.min(2, (C + vl) / (C + vs)));
    o.voice.update({ speedNorm, throttle, boost, dt, pitchMul: doppler, volume: 0.55 });
  }

  setListener(pos, forward, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02);
      L.positionY.setTargetAtTime(pos.y, t, 0.02);
      L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(forward.x, t, 0.02);
      L.forwardY.setTargetAtTime(forward.y, t, 0.02);
      L.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02);
      L.upY.setTargetAtTime(up.y, t, 0.02);
      L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  // ---------------------------------------------------------------------------
  // one-shots
  _env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _tone(type, freq, t, dur, peak, dest = this.fxBus, freqEnd = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.005, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  _noiseBurst(t, dur, peak, { type = 'lowpass', freq = 1200, freqEnd = null, q = 0.8, dest = this.fxBus, kind = 'white', pan = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._buffers[kind];
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, 0.004, peak, dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(dest);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  // exhaust pops after lifting off the throttle
  crackle(count, dest) {
    if (!this.enabled) return;
    const t0 = this.ctx.currentTime + 0.05;
    for (let i = 0; i < count; i++) {
      const t = t0 + Math.random() * 0.7;
      // deep pops: a low noise thud plus a falling sine "bang"
      this._noiseBurst(t, 0.05 + Math.random() * 0.06, 0.3 + Math.random() * 0.3, {
        type: 'lowpass', freq: 500 + Math.random() * 400, freqEnd: 140, q: 1.2, dest: dest || this.fxBus, kind: 'pink',
      });
      this._tone('sine', 85 + Math.random() * 35, t, 0.07, 0.3, dest || this.fxBus, 42);
    }
  }

  boostPickup() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, 0.9, 0.5, { type: 'bandpass', freq: 300, freqEnd: 5000, q: 2.5, kind: 'pink' });
    this._tone('sine', 55, t, 0.45, 0.6, this.fxBus, 38);
    [880, 1109, 1319, 1760].forEach((f, i) => this._tone('triangle', f, t + i * 0.045, 0.35, 0.12, this.fxBus));
  }

  impact(strength = 0.5, pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0.15, Math.min(1, strength));
    this._tone('sine', 150, t, 0.3, 0.9 * s, this.fxBus, 38);
    this._noiseBurst(t, 0.35, 0.8 * s, { freq: 1600, freqEnd: 200, pan, kind: 'pink' });
    [523, 1247, 2183, 3311].forEach((f, i) => this._tone('sine', f * (0.97 + Math.random() * 0.06), t, 0.4 + i * 0.1, 0.12 * s, this.fxBus));
  }

  // Weather ambience: a looping band-passed noise bed for rain, gusts of
  // wind for snow / storm. level 0..1.
  setWeather({ rain = 0, wind = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    if (!this._wx) {
      const mk = (kind, type, freq, q) => {
        const src = this.noiseSource(kind);
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.master);
        return { g, f };
      };
      this._wx = { rain: mk('white', 'bandpass', 3800, 0.6), hiss: mk('pink', 'highpass', 1200, 0.5), wind: mk('brown', 'lowpass', 420, 1.2) };
    }
    const t = ctx.currentTime;
    this._wx.rain.g.gain.setTargetAtTime(rain * 0.09, t, 0.5);
    this._wx.hiss.g.gain.setTargetAtTime(rain * 0.05, t, 0.5);
    this._wx.wind.g.gain.setTargetAtTime(wind * 0.35, t, 0.8);
  }

  windGust(amount) {
    if (!this._wx) return;
    this._wx.wind.f.frequency.setTargetAtTime(300 + amount * 500, this.ctx.currentTime, 0.6);
  }

  // distant thunder: low rumble with a crack for close strikes
  thunder(near = 0.5) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime + 0.3 + (1 - near) * 2.2;
    this._noiseBurst(t, 2.8, 0.9 * (0.5 + near * 0.5), { freq: 320, freqEnd: 60, kind: 'brown' });
    this._noiseBurst(t + 0.15, 1.8, 0.5, { freq: 160, freqEnd: 40, kind: 'brown' });
    if (near > 0.6) this._noiseBurst(t - 0.2, 0.4, 0.6, { freq: 2600, freqEnd: 400, kind: 'pink' });
  }

  bump(strength = 0.3) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 110, t, 0.18, 0.5 * strength, this.fxBus, 50);
    this._noiseBurst(t, 0.12, 0.4 * strength, { freq: 900, kind: 'pink' });
  }

  countdown(final = false) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    if (final) {
      this._tone('square', 880, t, 0.7, 0.18, this.uiBus);
      this._tone('square', 1760, t, 0.7, 0.06, this.uiBus);
    } else this._tone('square', 440, t, 0.25, 0.18, this.uiBus);
  }

  lap(final = false) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const notes = final ? [659, 659, 659, 880] : [523, 659, 784];
    notes.forEach((f, i) => this._tone('square', f, t + i * 0.12, 0.18, 0.12, this.uiBus));
    if (final) notes.forEach((f, i) => this._tone('sawtooth', f / 2, t + i * 0.12, 0.18, 0.06, this.uiBus));
  }

  fanfare(win = true) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const seq = win
      ? [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.75], [1047, 0.9]]
      : [[392, 0], [349, 0.2], [330, 0.4], [262, 0.6]];
    for (const [f, d] of seq) {
      this._tone('sawtooth', f, t + d, 0.4, 0.1, this.uiBus);
      this._tone('square', f / 2, t + d, 0.4, 0.05, this.uiBus);
    }
  }

  // Car-select screen: start the engine and blip the throttle twice.
  preview(character = 1) {
    if (!this.enabled) return;
    this.stopPreview();
    const v = new EngineVoice(this, { quality: 'full', output: this.engineBus, character });
    const t0 = performance.now();
    // [time s, rpm, throttle]
    const keys = [[0, 0.02, 0], [0.15, 0.02, 0.2], [0.35, 0.75, 1], [0.6, 0.85, 1], [0.8, 0.3, 0], [1.05, 0.12, 0], [1.25, 0.95, 1], [1.55, 1.0, 1], [1.8, 0.25, 0], [2.4, 0.08, 0], [3.4, 0.06, 0]];
    const at = (t) => {
      for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i][0]) {
          const [ta, ra, ha] = keys[i - 1];
          const [tb, rb, hb] = keys[i];
          const k = (t - ta) / (tb - ta);
          return [ra + (rb - ra) * k, ha + (hb - ha) * k];
        }
      }
      return keys[keys.length - 1].slice(1);
    };
    let liftDone = false;
    this._preview = {
      voice: v,
      timer: setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        const [rpm, thr] = at(t);
        v.setRpm(rpm, thr, 0);
        v.out.gain.setTargetAtTime(t < 3.2 ? 0.9 : 0, this.ctx.currentTime, 0.08);
        if (!liftDone && t > 1.6) {
          liftDone = true;
          this.crackle(4, v.out);
        }
        if (t > 3.6) this.stopPreview();
      }, 30),
    };
  }

  stopPreview() {
    if (!this._preview) return;
    clearInterval(this._preview.timer);
    this._preview.voice.stop();
    this._preview = null;
  }

  ui(kind = 'move') {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    if (kind === 'move') this._tone('square', 1200, t, 0.04, 0.06, this.uiBus);
    else if (kind === 'back') this._tone('square', 700, t, 0.08, 0.08, this.uiBus, 350);
    else if (kind === 'tick') this._tone('triangle', 1600, t, 0.03, 0.06, this.uiBus);
    else this._tone('square', 660, t, 0.08, 0.1, this.uiBus, 1320);
  }
}
