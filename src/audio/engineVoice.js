// Synthesised anti-grav engine: a big, low, chesty voice. Think a
// big-block V8 bolted to a jet turbine, not a buzzing wasp.
//
// Layers (player / "full" quality):
//   core    – custom periodic wave with a V8-style "half-order" spectrum
//             (strong f0/2, f0, 1.5·f0, 2·f0) played twice, slightly
//             detuned for width. Saturated through a soft tanh and two
//             gentle low-passes that never open into the fizzy 3–6 kHz band.
//             Amplitude-modulated at the firing rate: burbly at idle,
//             smooth at speed.
//   sub     – sine one octave down + triangle two octaves down: the girth.
//   rumble  – brown noise under 160 Hz, pulsed by the firing LFO: throat.
//   turbine – a quiet sine at 3·f0, only there to sell speed.
//   intake  – low band-passed noise that opens with throttle.
//   burner  – afterburner roar (low saw + brown noise) while boosting.
//   tone    – low-shelf boost, a cut at 2.8 kHz and a high-shelf cut on
//             the voice output, so nothing in it is shrill.
// Opponents use the "lite" quality (core + sub + tone) with 3D panning and
// manual Doppler.

const ln2 = Math.log(2);

function shaperCurve(k = 2.6, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // slightly asymmetric: even harmonics read as "warm"
    c[i] = Math.tanh(k * x + 0.15 * x * x) / norm;
  }
  return c;
}

let CURVE = null;
const WAVES = new WeakMap(); // ctx -> PeriodicWave

// V8-ish spectrum. The oscillator runs at f0/2 (one cycle = two firing
// pulses on a cross-plane V8), so harmonic n sits at n/2 · f0.
function v8Wave(ctx) {
  if (WAVES.has(ctx)) return WAVES.get(ctx);
  const N = 32;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  const amp = [0, 0.55, 1.0, 0.62, 0.78, 0.34, 0.42, 0.2, 0.26, 0.12, 0.14];
  for (let n = 1; n <= N; n++) {
    const a = n < amp.length ? amp[n] : 0.6 / Math.pow(n, 1.35);
    const ph = (n * 2.39996) % (Math.PI * 2); // fixed "random" phases -> pulse-y shape
    real[n] = a * Math.cos(ph);
    imag[n] = a * Math.sin(ph);
  }
  const w = ctx.createPeriodicWave(real, imag);
  WAVES.set(ctx, w);
  return w;
}

export class EngineVoice {
  /**
   * @param {import('./audioEngine.js').AudioEngine} audio
   * @param {{quality?: 'full'|'lite', output: AudioNode, character?: number}} opts
   */
  constructor(audio, { quality = 'full', output, character = 1 } = {}) {
    const ctx = (this.ctx = audio.ctx);
    this.audio = audio;
    this.quality = quality;
    this.character = character; // base pitch multiplier – gives each craft its own voice
    this.rpm = 0;
    this.prevThrottle = 0;
    this.overshoot = 0;
    this.base = 42 * character; // firing frequency at idle (a V8 at ~650 rpm)
    if (!CURVE) CURVE = shaperCurve();
    const full = quality === 'full';

    const now = ctx.currentTime;
    const out = (this.out = ctx.createGain());
    out.gain.value = 0;

    // --- tone shaping on the whole voice -------------------------------------------
    const chest = ctx.createBiquadFilter();
    chest.type = 'lowshelf';
    chest.frequency.value = 140;
    chest.gain.value = 4;
    // "body": the growl band small speakers can still reproduce
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 220;
    body.Q.value = 0.8;
    body.gain.value = 4;
    const bite = ctx.createBiquadFilter();
    bite.type = 'peaking';
    bite.frequency.value = 2800;
    bite.Q.value = 0.9;
    bite.gain.value = -6;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 4500;
    air.gain.value = -10;
    const voice = (this.voice = ctx.createGain());
    voice.connect(chest).connect(body).connect(bite).connect(air).connect(out);
    out.connect(output);

    // --- core ------------------------------------------------------------------------
    const wave = v8Wave(ctx);
    this.c1 = ctx.createOscillator();
    this.c1.setPeriodicWave(wave);
    this.c2 = ctx.createOscillator();
    this.c2.setPeriodicWave(wave);
    const pre = (this.pre = ctx.createGain());
    pre.gain.value = 0.6;
    const c2g = ctx.createGain();
    c2g.gain.value = full ? 0.7 : 0;
    this.c1.connect(pre);
    this.c2.connect(c2g).connect(pre);
    const shaper = ctx.createWaveShaper();
    shaper.curve = CURVE;
    shaper.oversample = full ? '4x' : 'none';
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.9;
    this.lp2 = ctx.createBiquadFilter(); // fixed ceiling: no fizz, ever
    this.lp2.type = 'lowpass';
    this.lp2.frequency.value = 3000;
    this.lp2.Q.value = 0.5;
    this.am = ctx.createGain();
    this.am.gain.value = 0.7;
    this.coreGain = ctx.createGain();
    this.coreGain.gain.value = 0.3;
    pre.connect(shaper).connect(this.lp).connect(this.lp2).connect(this.am).connect(this.coreGain).connect(voice);

    // firing-rate AM ("burble")
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.3;
    this.lfo.connect(this.lfoDepth).connect(this.am.gain);

    // --- sub ---------------------------------------------------------------------------
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub2 = ctx.createOscillator();
    this.sub2.type = 'triangle';
    const sub2g = ctx.createGain();
    sub2g.gain.value = 0.35;
    const subLP = ctx.createBiquadFilter();
    subLP.type = 'lowpass';
    subLP.frequency.value = 180;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.5;
    this.sub.connect(subLP);
    this.sub2.connect(sub2g).connect(subLP);
    subLP.connect(this.subGain).connect(voice);

    this.oscs = [this.c1, this.c2, this.lfo, this.sub, this.sub2];
    this.noises = [];

    if (full) {
      // rumble: low brown noise pulsed with the firing LFO
      this.rumble = audio.noiseSource('brown');
      const rLP = ctx.createBiquadFilter();
      rLP.type = 'lowpass';
      rLP.frequency.value = 160;
      rLP.Q.value = 0.8;
      this.rumbleAM = ctx.createGain();
      this.rumbleAM.gain.value = 0.5;
      this.lfoRumble = ctx.createGain();
      this.lfoRumble.gain.value = 0.4;
      this.lfo.connect(this.lfoRumble).connect(this.rumbleAM.gain);
      this.rumbleGain = ctx.createGain();
      this.rumbleGain.gain.value = 0;
      this.rumble.connect(rLP).connect(this.rumbleAM).connect(this.rumbleGain).connect(voice);
      this.noises.push(this.rumble);

      // turbine: one quiet sine, low Q
      this.turb = ctx.createOscillator();
      this.turb.type = 'sine';
      this.turbGain = ctx.createGain();
      this.turbGain.gain.value = 0;
      this.turb.connect(this.turbGain).connect(voice);
      this.oscs.push(this.turb);

      // intake noise
      this.intake = audio.noiseSource('pink');
      this.intakeBP = ctx.createBiquadFilter();
      this.intakeBP.type = 'bandpass';
      this.intakeBP.Q.value = 0.8;
      this.intakeGain = ctx.createGain();
      this.intakeGain.gain.value = 0;
      this.intake.connect(this.intakeBP).connect(this.intakeGain).connect(voice);
      this.noises.push(this.intake);

      // afterburner
      this.burnSaw = ctx.createOscillator();
      this.burnSaw.type = 'sawtooth';
      const burnShaper = ctx.createWaveShaper();
      burnShaper.curve = CURVE;
      this.burnNoise = audio.noiseSource('brown');
      this.burnLP = ctx.createBiquadFilter();
      this.burnLP.type = 'lowpass';
      this.burnLP.frequency.value = 500;
      this.burnLP.Q.value = 0.7;
      this.burnGain = ctx.createGain();
      this.burnGain.gain.value = 0;
      const burnMix = ctx.createGain();
      burnMix.gain.value = 0.7;
      this.burnSaw.connect(burnShaper).connect(burnMix);
      const bn = ctx.createGain();
      bn.gain.value = 3;
      this.burnNoise.connect(bn).connect(burnMix);
      burnMix.connect(this.burnLP).connect(this.burnGain).connect(voice);
      this.oscs.push(this.burnSaw);
      this.noises.push(this.burnNoise);
    }

    for (const o of this.oscs) o.start(now);
    this.setRpm(0, 0, 0);
  }

  // Normalised revs -> firing frequency. A narrow range keeps it deep:
  // 0 -> ~42 Hz, 1 -> ~177 Hz, 1.35 (boost) -> ~290 Hz
  freqFor(rpm) {
    return this.base * Math.exp(rpm * 2.08 * ln2);
  }

  setRpm(rpm, throttle, boost, pitchMul = 1) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tc = 0.05;
    const f0 = this.freqFor(rpm) * pitchMul * (1 + boost * 0.05);
    this.c1.frequency.setTargetAtTime(f0 * 0.5, t, tc);
    this.c2.frequency.setTargetAtTime(f0 * 0.5 * 1.004, t, tc);
    this.sub.frequency.setTargetAtTime(f0, t, tc);
    this.sub2.frequency.setTargetAtTime(f0 * 0.5, t, tc);
    this.lfo.frequency.setTargetAtTime(f0 * 0.25, t, tc);

    const r = Math.min(rpm, 1.4);
    const load = 0.3 + 0.7 * throttle;
    // the voice opens up with load, but tops out around 2 kHz
    const cutoff = 160 + 1500 * Math.pow(r, 1.15) * load + boost * 700;
    this.lp.frequency.setTargetAtTime(cutoff, t, 0.05);
    this.pre.gain.setTargetAtTime(0.5 + throttle * 1.1 + boost * 0.6, t, 0.06);

    // burbly at idle, smooth at speed
    const depth = 0.42 * (1 - Math.min(1, r * 1.1)) + 0.06;
    this.lfoDepth.gain.setTargetAtTime(depth, t, 0.1);
    this.am.gain.setTargetAtTime(1 - depth, t, 0.1);

    this.subGain.gain.setTargetAtTime((0.36 - 0.1 * Math.min(r, 1)) * (0.75 + 0.25 * throttle) + boost * 0.08, t, 0.06);
    this.coreGain.gain.setTargetAtTime(0.17 + 0.09 * throttle + boost * 0.03, t, 0.06);

    if (this.quality === 'full') {
      this.lfoRumble.gain.setTargetAtTime(0.5 * depth + 0.1, t, 0.1);
      this.rumbleGain.gain.setTargetAtTime((0.14 + 0.16 * throttle) * (0.6 + 0.5 * Math.min(r, 1)) + boost * 0.15, t, 0.08);
      this.turb.frequency.setTargetAtTime(f0 * 3, t, tc);
      this.turbGain.gain.setTargetAtTime(0.012 + 0.035 * r * r, t, 0.1);
      this.intakeBP.frequency.setTargetAtTime(180 + 700 * r, t, 0.06);
      this.intakeGain.gain.setTargetAtTime(0.09 * throttle * (0.3 + r), t, 0.06);
      this.burnSaw.frequency.setTargetAtTime(f0 * 0.25, t, tc);
      this.burnLP.frequency.setTargetAtTime(260 + boost * 520 + r * 160, t, 0.06);
      this.burnGain.gain.setTargetAtTime(boost * 0.32, t, boost ? 0.04 : 0.4);
    }
  }

  /**
   * Called every frame.
   * @param {object} s { speedNorm, throttle, boost (0..1), dt, pitchMul, volume }
   */
  update(s) {
    const { speedNorm, throttle, boost = 0, dt, pitchMul = 1, volume = 1 } = s;
    // revs: mostly road speed, a bit of free-revving with throttle
    if (throttle - this.prevThrottle > 0.35 && this.rpm < 0.8) this.overshoot = 0.12;
    this.overshoot = Math.max(0, this.overshoot - dt * 0.5);
    const target = Math.min(1.45, speedNorm * 0.86 + throttle * 0.16 + this.overshoot);
    const rate = target > this.rpm ? 4 : 2.2;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);

    // lift-off crackle
    if (this.quality === 'full' && this.prevThrottle > 0.7 && throttle < 0.25 && this.rpm > 0.35) {
      this.audio.crackle(3 + Math.floor(Math.random() * 5), this.out);
    }
    this.prevThrottle = throttle;
    this.setRpm(this.rpm, throttle, boost, pitchMul);
    this.out.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      for (const o of this.oscs) {
        try { o.stop(); } catch { /* already stopped */ }
      }
      for (const n of this.noises) {
        try { n.stop(); } catch { /* ignore */ }
      }
      this.out.disconnect();
    }, 400);
  }
}
