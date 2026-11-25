// Soundtrack player for the mp3s in assets/music.
//
// Each track is an <audio> element routed through Web Audio
// (MediaElementSource -> track gain -> music bus -> destination). The music
// bus skips the master compressor, so the engines never pump the music.
// Crossfades between tracks; in a race the tracks play as a playlist.
import { MUSIC_FILES } from './musicFiles.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// "Concrete Motorik.mp3", "Concrete Motorik (1).mp3" … -> titled tracks
export const MUSIC_TRACKS = Object.entries(MUSIC_FILES)
  .map(([path, url]) => {
    const file = decodeURIComponent(path.split('/').pop()).replace(/\.mp3$/i, '');
    const m = file.match(/^(.*?)\s*\((\d+)\)$/);
    const base = m ? m[1] : file;
    const n = m ? +m[2] : 0;
    return { base, n, url };
  })
  .sort((a, b) => a.base.localeCompare(b.base) || a.n - b.n)
  .map((t, i, all) => {
    const same = all.filter((o) => o.base === t.base);
    const title = same.length > 1 ? `${t.base} ${ROMAN[same.indexOf(t)] || t.n + 1}` : t.base;
    return { id: i, title, url: t.url };
  });

export class Music {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.duckLevel = 1;
    this.current = null; // { el, gain, track }
    this.playlist = null; // array of track ids when playing as a playlist
    this.onTrack = null; // callback(track) when a new track starts
    this._els = new Map();
  }

  // Connect to the game's AudioContext (call after it was created by a user gesture).
  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = this.volume * this.duckLevel;
    this.bus.connect(ctx.destination);
    if (this._pending) {
      const p = this._pending;
      this._pending = null;
      this.play(p.id, p.opts);
    }
  }

  setVolume(v) {
    this.volume = v;
    this._applyBus(0.1);
  }

  // 0..1 multiplier on top of the volume (pause menu, results)
  duck(level = 1, time = 0.4) {
    this.duckLevel = level;
    this._applyBus(time);
  }

  _applyBus(tc) {
    if (!this.bus) return;
    this.bus.gain.setTargetAtTime(this.volume * this.duckLevel, this.ctx.currentTime, tc);
  }

  _element(track) {
    let e = this._els.get(track.id);
    if (e) return e;
    const el = new Audio();
    el.src = track.url;
    el.preload = 'auto';
    const src = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.bus);
    e = { el, gain, track };
    el.addEventListener('ended', () => {
      if (this.current === e) this._next();
    });
    this._els.set(track.id, e);
    return e;
  }

  /**
   * Start a track (crossfading from the current one).
   * @param {number} id track index
   * @param {{loop?: boolean, fade?: number, restart?: boolean}} opts
   */
  play(id, { loop = false, fade = 1.2, restart = false } = {}) {
    const track = MUSIC_TRACKS[((id % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length];
    if (!track) return;
    if (!this.ctx) {
      this._pending = { id, opts: { loop, fade, restart } };
      return;
    }
    const next = this._element(track);
    next.el.loop = loop;
    if (this.current === next && !restart) {
      if (next.el.paused) next.el.play().catch(() => {});
      return;
    }
    this._fadeOut(this.current, fade);
    const t = this.ctx.currentTime;
    next.gain.gain.cancelScheduledValues(t);
    next.gain.gain.setValueAtTime(0.0001, t);
    next.gain.gain.exponentialRampToValueAtTime(1, t + Math.max(0.05, fade));
    if (restart || next.el.ended) next.el.currentTime = 0;
    next.el.play().catch(() => {});
    this.current = next;
    this.onTrack?.(track);
  }

  // Play the tracks one after another, starting at `first`.
  playlistFrom(first, opts = {}) {
    this.playlist = MUSIC_TRACKS.map((_, i) => (first + i) % MUSIC_TRACKS.length);
    this._plIndex = 0;
    this.play(this.playlist[0], { ...opts, loop: false, restart: true });
  }

  _next() {
    if (this.playlist) {
      this._plIndex = (this._plIndex + 1) % this.playlist.length;
      this.play(this.playlist[this._plIndex], { fade: 0.3, restart: true });
    } else if (this.current) {
      this.current.el.currentTime = 0;
      this.current.el.play().catch(() => {});
    }
  }

  _fadeOut(e, fade) {
    if (!e) return;
    const t = this.ctx.currentTime;
    e.gain.gain.cancelScheduledValues(t);
    e.gain.gain.setValueAtTime(Math.max(0.0001, e.gain.gain.value), t);
    e.gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    const el = e.el;
    setTimeout(() => {
      if (this.current !== e) el.pause();
    }, fade * 1000 + 80);
  }

  // menu music: a single looping track
  menu(id = 0) {
    this.playlist = null;
    this.play(id, { loop: true, fade: 1.5 });
  }

  pause() {
    this.current?.el.pause();
  }

  resume() {
    if (this.current && this.current.el.paused) this.current.el.play().catch(() => {});
  }
}
