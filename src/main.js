import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { installHeightFog, currentTime, SUN_DIR } from './world/atmosphere.js';
import { WEATHER, WEATHERS } from './fx/weather.js';
import { installRetro, retroifyObject, RETRO } from './fx/retro.js';
import { preloadRoadTextures } from './world/roadTextures.js';
import { preloadPhotoTextures } from './world/photoTextures.js';
import { loadBuildingAssets } from './world/assets.js';
import { PostFX, SpeedStreaks } from './fx/postfx.js';
import { FXWorld } from './fx/particles.js';

import { PRESETS, presetSpec, generateTrack } from './track/generator.js';
import { makeFrame } from './track/trackData.js';
import { loadCarModel, CAR_MODELS, LIVERIES } from './vehicle/carModel.js';
import { AudioEngine } from './audio/audioEngine.js';
import { Music, MUSIC_TRACKS } from './audio/music.js';
import { Input } from './game/input.js';
import { ChaseCamera } from './game/camera.js';
import { HUD, fmtTime } from './game/hud.js';
import { Race, TrackWorld } from './game/race.js';
import { MenuNav, optionRow } from './ui/nav.js';
import { Showroom } from './ui/showroom.js';
import { deaccent } from './ui/text.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// settings (needed before any shader compiles)
const settings = {
  laps: 3,
  opponents: 5,
  volume: 0.8, // sound effects + engines
  music: 0.6,
  bloom: true,
  style: 'psx', // 'psx' (32-bit arcade look) | 'modern'
  res: 480, // PSX internal vertical resolution
  car: 'polonez',
  livery: 0,
  weather: 'auto', // auto (per track) | clear | clouds | rain | storm | snow | fog
  v: 3,
};
try {
  const saved = JSON.parse(localStorage.getItem('spartakiada.settings') || '{}');
  // v2: the default PSX resolution went up from 360 to 480 lines
  if (!saved.v && saved.res <= 360) delete saved.res;
  Object.assign(settings, saved, { v: 3 });
} catch { /* ignore */ }
const saveSettings = () => localStorage.setItem('spartakiada.settings', JSON.stringify(settings));
{
  const qp = new URLSearchParams(location.search);
  if (qp.has('style')) settings.style = qp.get('style');
  if (qp.has('res')) settings.res = +qp.get('res');
  if (qp.has('car')) settings.car = qp.get('car');
  if (qp.has('weather')) settings.weather = qp.get('weather');
}
installRetro({ enabled: settings.style === 'psx', height: settings.res });

// ---------------------------------------------------------------------------
// renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(RETRO.enabled ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !RETRO.enabled; // PSX: blob shadows only
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
installHeightFog(); // must run before any material compiles
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.7, 12000);
const post = new PostFX(renderer, scene, camera, { retro: RETRO.enabled, retroHeight: settings.res });
post.setSize(window.innerWidth, window.innerHeight);
const fx = new FXWorld(scene);
fx.camera = camera;
const streaks = new SpeedStreaks(scene);
let showroom = null; // created the first time the car-select screen opens

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  showroom?.resize(camera.aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// game state
const audio = new AudioEngine();
const music = new Music();
music.volume = settings.music;
const input = new Input();
const hud = new HUD();
const chase = new ChaseCamera(camera);
const nav = new MenuNav(audio);

const game = {
  // loading | title | main | tracks | cars | options | controls | race | paused | results
  state: 'loading',
  world: null,
  race: null,
  cars: {},
  selection: { kind: 'preset', index: 0 },
  spec: null,
  flyS: 0,
  time: 0,
  races: 0,
};
// dev-only handle for poking at the running game from the console / tests
if (import.meta.env.DEV) window.__spk = { game, camera };
// states that show the track fly-over behind the menu
const FLYOVER = new Set(['title', 'main', 'tracks', 'options', 'controls']);

// audio needs a user gesture; the title screen is that gesture
async function unlock() {
  await audio.init();
  audio.setVolume(settings.volume);
  music.attach(audio.ctx);
}
window.addEventListener('pointerdown', () => unlock());
window.addEventListener('keydown', () => unlock());

music.onTrack = (track) => {
  $('now-playing').textContent = `♪ ${deaccent(track.title)}`;
  if (game.state === 'race') hud.nowPlaying(track.title);
};

// ---------------------------------------------------------------------------
// track selection
function specForSelection() {
  const sel = game.selection;
  const spec = sel.kind === 'preset' ? presetSpec(PRESETS[sel.index]) : generateTrack(sel.seed);
  if (settings.weather !== 'auto' && WEATHERS[settings.weather]) spec.weather = settings.weather;
  return spec;
}

const TIME_LABEL = { day: 'dzień', dusk: 'zmierzch', night: 'noc' };

function loadWorld(spec) {
  if (game.world) game.world.dispose(audio);
  game.spec = spec;
  game.world = new TrackWorld(scene, spec);
  retroifyObject(game.world.mesh.group, { snap: false });
  retroifyObject(game.world.env.group, { snap: false });
  renderer.toneMappingExposure = currentTime().exposure;
  game.flyS = game.world.track.startS;
  updateTrackInfo();
}

function updateTrackInfo() {
  const t = game.world.track;
  const env = game.world.env;
  const kinds = {};
  t.tiles.forEach((x) => (kinds[x.type] = (kinds[x.type] || 0) + 1));
  const feats = [];
  if (kinds.loop) feats.push(`${kinds.loop}× pętla`);
  if (kinds.barrelRoll) feats.push(`${kinds.barrelRoll}× beczka`);
  if (kinds.tunnel) feats.push(`${kinds.tunnel}× tunel`);
  if (kinds.jump) feats.push(`${kinds.jump}× skocznia`);
  if (kinds.twist) feats.push(`${kinds.twist}× korkociąg`);
  if (kinds.wallRide) feats.push(`${kinds.wallRide}× ściana`);
  feats.push(`${t.boosts.length} dopalaczy`);
  const sel = game.selection;
  const blurb = sel.kind === 'preset' ? PRESETS[sel.index].blurb : `Tor losowy · ziarno ${sel.seed}`;
  $('track-info').innerHTML = `<div class="tname">${deaccent(t.name)}</div>
    <div class="facts"><b>${(t.length / 1000).toFixed(2)} km</b> · ${t.tiles.length} kafli<br>
    ${feats.join(' · ')}<br>
    ${TIME_LABEL[env.timeName] || env.timeName} · ${WEATHERS[env.weatherName]?.label || ''}</div>
    <i>${blurb}</i>`;
  drawTrackMap($('track-map'), t);
}

// track outline for the track-select card
function drawTrackMap(canvas, track) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  const b = track.bounds;
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const scale = (Math.min(W, H) - 36) / Math.max(sx, sz);
  const P = (i) => {
    const k = (i % track.count) * 3;
    return [W / 2 + (track.pos[k] - (b.min.x + sx / 2)) * scale, H / 2 + (track.pos[k + 2] - (b.min.z + sz / 2)) * scale, track.pos[k + 1]];
  };
  const path = () => {
    g.beginPath();
    for (let i = 0; i <= track.count; i += 3) {
      const [x, y] = P(i);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = 11;
  path();
  g.stroke();
  g.strokeStyle = '#e9e1cf';
  g.lineWidth = 5;
  path();
  g.stroke();
  // elevated sections in gold
  g.strokeStyle = '#ffd23a';
  g.lineWidth = 5;
  g.beginPath();
  let on = false;
  for (let i = 0; i <= track.count; i += 3) {
    const [x, y, h] = P(i);
    if (h > 4) {
      if (!on) g.moveTo(x, y);
      else g.lineTo(x, y);
      on = true;
    } else on = false;
  }
  g.stroke();
  const [x, y] = P(Math.round(track.startS / track.ds));
  g.fillStyle = '#d4202a';
  g.fillRect(x - 6, y - 6, 12, 12);
  g.strokeStyle = '#000';
  g.lineWidth = 2;
  g.strokeRect(x - 6, y - 6, 12, 12);
}

const randomSeed = () => Math.floor(Math.random() * 999999) + 1;

function buildTrackList() {
  const list = $('track-list');
  list.innerHTML = '';
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'mi';
    b.innerHTML = `<span class="display">${deaccent(p.name)}</span><small>${p.spec ? 'ręczny' : `ziarno ${p.seed}`}</small>`;
    b.onclick = () => selectTrack({ kind: 'preset', index: i });
    list.appendChild(b);
  });
  const r = document.createElement('button');
  r.className = 'mi';
  r.id = 'random-entry';
  r.innerHTML = '<span class="display">TOR LOSOWY</span><small>—</small>';
  r.onclick = () => selectTrack({ kind: 'random', seed: game.selection.kind === 'random' ? randomSeed() : game.lastRandom ?? randomSeed() });
  list.appendChild(r);
  updateTrackListSel();
}

function updateTrackListSel() {
  const btns = [...$('track-list').children];
  const sel = game.selection;
  btns.forEach((b, i) => b.classList.toggle('sel', (sel.kind === 'preset' && sel.index === i) || (sel.kind === 'random' && i === PRESETS.length)));
  if (sel.kind === 'random') $('random-entry').querySelector('small').textContent = `ziarno ${sel.seed} · Enter: nowe`;
}

function selectTrack(sel) {
  game.selection = sel;
  if (sel.kind === 'random') {
    game.lastRandom = sel.seed;
    $('seed-input').value = sel.seed;
  }
  updateTrackListSel();
  audio.ui('select');
  loadWorld(specForSelection());
}

$('seed-input').addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10);
  if (v > 0) selectTrack({ kind: 'random', seed: v });
});

// race options on the track card
const WEATHER_VALUES = [{ v: 'auto', label: 'wg toru' }, ...Object.entries(WEATHERS).map(([k, w]) => ({ v: k, label: w.label.toLowerCase() }))];
function buildRaceOptions() {
  const box = $('race-opts');
  box.innerHTML = '';
  box.append(
    optionRow({ label: 'Okrążenia', sub: 'laps', values: [1, 2, 3, 5, 7].map((v) => ({ v, label: String(v) })), get: () => settings.laps, set: (v) => { settings.laps = v; saveSettings(); } }),
    optionRow({ label: 'Rywale', sub: 'rivals', values: [0, 3, 5, 7].map((v) => ({ v, label: String(v) })), get: () => settings.opponents, set: (v) => { settings.opponents = v; saveSettings(); } }),
    optionRow({
      label: 'Pogoda', sub: 'weather', values: WEATHER_VALUES, get: () => settings.weather,
      set: (v) => {
        settings.weather = v;
        saveSettings();
        clearTimeout(game._weatherT);
        // rebuilding the world takes a moment: wait until the player stops cycling
        game._weatherT = setTimeout(() => loadWorld(specForSelection()), 350);
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// car select
const CAR_IDS = Object.keys(CAR_MODELS);
const STAT_LABEL = { speed: 'Prędkość', accel: 'Przyspieszenie', handling: 'Sterowność', weight: 'Masa' };
const liveryCss = (L) => {
  // approximate swatch of the hue-shifted orange livery
  if (L.sat === 0) return '#b8bcc4';
  const base = new THREE.Color('#e0702a');
  const hsl = {};
  base.getHSL(hsl);
  return `#${new THREE.Color().setHSL((hsl.h + L.hue / (Math.PI * 2)) % 1, Math.min(1, hsl.s * L.sat), hsl.l).getHexString()}`;
};

function buildCarOptions() {
  const box = $('car-opts');
  box.innerHTML = '';
  box.append(
    optionRow({ label: 'Pojazd', sub: 'vehicle', values: CAR_IDS.map((id) => ({ v: id, label: CAR_MODELS[id].name })), get: () => settings.car, set: (v) => setCar(v) }),
    optionRow({ label: 'Lakier', sub: 'livery', values: LIVERIES.map((L, i) => ({ v: i, label: L.name })), get: () => settings.livery, set: (v) => setLivery(v) }),
  );
}

function updateCarCard() {
  const def = CAR_MODELS[settings.car];
  $('car-name').textContent = deaccent(def.name);
  $('car-full').textContent = def.full || def.name;
  $('car-blurb').textContent = def.blurb || '';
  $('car-stats').innerHTML = Object.entries(def.stats || {})
    .map(([k, v]) => `<span>${deaccent(STAT_LABEL[k] || k)}</span><span class="bar">${'<i class="on"></i>'.repeat(v)}${'<i></i>'.repeat(5 - v)}</span>`)
    .join('');
  const L = LIVERIES[settings.livery % LIVERIES.length];
  const row = $('car-opts').children[1];
  if (row) row.querySelector('.v').innerHTML = `<span class="swatch" style="background:${liveryCss(L)}"></span>${L.name}`;
  for (const r of $('car-opts').children) if (r !== row) r._render?.();
}

function setCar(id, { rev = true } = {}) {
  settings.car = id;
  saveSettings();
  showroom?.setCar(game.cars[id] || game.cars.polonez, settings.livery);
  updateCarCard();
  if (rev) {
    audio.preview(CAR_MODELS[id].voice ?? 1);
    showroom?.rev();
  }
}

function setLivery(i) {
  settings.livery = i;
  saveSettings();
  showroom?.setCar(game.cars[settings.car] || game.cars.polonez, settings.livery);
  updateCarCard();
}

function stepCar(dir) {
  const i = CAR_IDS.indexOf(settings.car);
  setCar(CAR_IDS[(i + dir + CAR_IDS.length) % CAR_IDS.length]);
  return true;
}
$('car-prev').onclick = () => stepCar(-1);
$('car-next').onclick = () => stepCar(1);

// ---------------------------------------------------------------------------
// options
const initialGfx = { style: settings.style, res: settings.res };
const VOL = Array.from({ length: 11 }, (_, i) => ({ v: i / 10, label: String(i) }));
const snap10 = (x) => Math.round(x * 10) / 10;
function buildOptions() {
  const box = $('options-list');
  box.innerHTML = '';
  box.append(
    optionRow({ label: 'Muzyka', sub: 'music', bar: true, values: VOL, get: () => snap10(settings.music), set: (v) => { settings.music = v; music.setVolume(v); saveSettings(); } }),
    optionRow({ label: 'Efekty', sub: 'sound fx', bar: true, values: VOL, get: () => snap10(settings.volume), set: (v) => { settings.volume = v; audio.setVolume(v); saveSettings(); audio.ui('select'); } }),
    optionRow({ label: 'Poswiata', sub: 'glow / bloom', values: [{ v: true, label: 'tak' }, { v: false, label: 'nie' }], get: () => settings.bloom, set: (v) => { settings.bloom = v; saveSettings(); } }),
    optionRow({ label: 'Grafika', sub: 'style', values: [{ v: 'psx', label: '32-bit arcade' }, { v: 'modern', label: 'nowoczesna' }], get: () => settings.style, set: (v) => { settings.style = v; saveSettings(); optionsNote(); } }),
    optionRow({ label: 'Rozdzielczosc', sub: 'psx lines', values: [240, 360, 480, 540, 720].map((v) => ({ v, label: `${v}p` })), get: () => settings.res, set: (v) => { settings.res = v; saveSettings(); optionsNote(); } }),
  );
  optionsNote();
}
const gfxChanged = () => settings.style !== initialGfx.style || settings.res !== initialGfx.res;
function optionsNote() {
  $('options-note').textContent = gfxChanged() ? 'Zmiana grafiki zadziała po wyjściu z opcji (gra przeładuje się).' : 'Grafika i rozdzielczość: zmiana wymaga przeładowania gry.';
}

// ---------------------------------------------------------------------------
// screens
const SCREENS = ['loading', 'title', 'main', 'tracks', 'cars', 'options', 'controls', 'pause', 'results'];
function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
}

function goto(state) {
  const prev = game.state;
  game.state = state;
  show(state);
  if (prev === 'cars' && state !== 'cars') {
    audio.stopPreview();
    post.setView(scene, camera);
  }
  if (state === 'title') nav.set($('title'), {});
  if (state === 'main') nav.set($('main'), { onBack: () => goto('title') });
  if (state === 'tracks') {
    nav.set($('tracks'), { onBack: () => goto('main') });
    updateTrackListSel();
  }
  if (state === 'cars') {
    if (!showroom) {
      showroom = new Showroom(scene.environment);
      showroom.resize(camera.aspect);
    }
    post.setView(showroom.scene, showroom.camera);
    nav.set($('cars'), { onBack: () => goto('tracks'), onLeftRight: stepCar, focus: $('btn-start') });
    setCar(settings.car);
  }
  if (state === 'options') nav.set($('options'), { onBack: leaveOptions });
  if (state === 'controls') nav.set($('controls'), { onBack: () => goto('main') });
}

function leaveOptions() {
  if (gfxChanged()) location.reload();
  else goto('main');
}

for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => {
  audio.ui('select');
  goto(b.dataset.go);
});
for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => {
  audio.ui('back');
  nav.opts.onBack?.();
});

async function enterMenu() {
  if (game.state !== 'title') return;
  await unlock();
  audio.ui('select');
  music.duck(1);
  music.menu(0);
  goto('main');
}
$('btn-press').onclick = enterMenu;
$('title').addEventListener('pointerdown', (e) => {
  if (e.target === $('title') || e.target.closest('.title-block')) enterMenu();
});

function toMenu() {
  if (game.race) {
    game.race.dispose();
    game.race = null;
  }
  audio.mute(false);
  music.duck(1);
  music.menu(0);
  goto('main');
}

async function startRace() {
  await unlock();
  audio.ui('select');
  audio.stopPreview();
  if (game.race) game.race.dispose();
  if (!game.world) loadWorld(specForSelection());
  post.setView(scene, camera);
  game.race = new Race({
    world: game.world,
    scene,
    carTemplate: game.cars[settings.car] || game.cars.polonez,
    carTemplates: game.cars,
    livery: settings.livery,
    audio,
    hud,
    chase,
    laps: settings.laps,
    opponents: settings.opponents,
    onFinish: (res) => showResults(res),
    fx,
    onHit: (s) => (post.hit = Math.max(post.hit, s)),
  });
  retroifyObject(game.race.group);
  game.state = 'race';
  show(null);
  nav.clear();
  audio.mute(false);
  music.duck(1);
  // the race playlist starts on the next track each race (the menu theme is track 0)
  const n = MUSIC_TRACKS.length;
  if (n) music.playlistFrom(n > 1 ? 1 + (game.races % (n - 1)) : 0, { fade: 0.8 });
  game.races++;
}
$('btn-start').onclick = startRace;

function showResults(res) {
  game.state = 'results';
  $('res-track').textContent = res.trackName;
  $('res-table').innerHTML = res.table
    .map((r) => `<tr class="${r.player ? 'me' : ''}"><td>${r.pos}.</td><td>${r.name}</td><td class="${r.est ? 'est' : ''}">${r.est ? '~' : ''}${fmtTime(r.time)}</td></tr>`)
    .join('');
  $('res-best').textContent = res.best ? `Najlepsze okrążenie: ${fmtTime(res.best)}  ·  ${res.lapTimes.map(fmtTime).join('  ')}` : '';
  show('results');
  nav.set($('results'), { onBack: toMenu, focus: 0 });
}

function pause(on) {
  if (on && game.state === 'race') {
    game.state = 'paused';
    show('pause');
    nav.set($('pause'), { onBack: () => pause(false), focus: 0 });
    audio.mute(true);
    music.duck(0.3);
  } else if (!on && game.state === 'paused') {
    game.state = 'race';
    show(null);
    nav.clear();
    audio.mute(false);
    music.duck(1);
  }
}

for (const el of document.querySelectorAll('[data-act]')) {
  el.addEventListener('click', () => {
    const a = el.dataset.act;
    if (a === 'resume') pause(false);
    if (a === 'restart') startRace();
    if (a === 'menu') toMenu();
  });
}

// ---------------------------------------------------------------------------
// main loop
const clock = new THREE.Clock();
const fr = makeFrame();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const sunScreen = new THREE.Vector3();

function menuCamera(dt) {
  const t = game.world.track;
  game.flyS = t.wrapS(game.flyS + dt * 42);
  t.pointAt(game.flyS, Math.sin(game.time * 0.2) * 6, 9, tmpA, fr);
  const up = fr.up.clone();
  t.pointAt(game.flyS + 45, 0, 3, tmpB, fr);
  camera.position.lerp(tmpA, 1 - Math.exp(-dt * 4));
  camera.up.lerp(up, 1 - Math.exp(-dt * 3)).normalize();
  camera.lookAt(tmpB);
  camera.fov = 72;
  camera.updateProjectionMatrix();
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 25);
  game.time += dt;
  const inp = input.poll();

  // menus
  if (game.state === 'title') {
    if (input.pressed.size) enterMenu();
  } else if (game.state !== 'race' && game.state !== 'loading') nav.update(input);
  if (input.wasPressed('Escape', 'KeyP', 'Pad9') && game.state === 'race') pause(true);
  if (input.wasPressed('KeyV', 'Pad3') && game.state === 'race') chase.cycle();

  const inShowroom = game.state === 'cars' && showroom;
  if (game.world && game.state !== 'paused' && !inShowroom) game.world.update(dt, game.time);
  if (FLYOVER.has(game.state) && game.world) menuCamera(dt);
  if ((game.state === 'race' || game.state === 'results') && game.race) game.race.update(dt, inp);

  // particles, streaks
  const racing = (game.state === 'race' || game.state === 'results') && game.race;
  const pv = racing ? game.race.player.v : null;
  if (game.state !== 'paused' && !inShowroom) {
    fx.setViewport(RETRO.enabled ? post.grade.uniforms.uRes.value.y : renderer.domElement.height, camera.fov);
    fx.update(dt);
    if (pv) streaks.update(dt, camera, pv.velocity, pv.speed / 125, pv.boostTimer > 0 ? 1 : 0);
    else streaks.lines.visible = false;
  }
  if (FLYOVER.has(game.state) && game.world) game.world.env.follow(camera.position);
  // weather (rain / snow around the camera, lightning) + lens effects
  if (inShowroom) {
    showroom.update(dt);
    post.setLens({ flare: 0, rain: 0, flash: 0 });
  } else if (game.world && game.state !== 'paused') {
    game.world.env.weather.update(dt, camera, {
      velocity: pv ? pv.velocity : null,
      vehicle: pv,
      fx: pv ? fx : null,
      audio: audio.enabled && racing ? audio : null,
      viewportH: RETRO.enabled ? post.grade.uniforms.uRes.value.y : renderer.domElement.height,
    });
    sunScreen.copy(SUN_DIR).multiplyScalar(5000).add(camera.position).project(camera);
    const T = currentTime();
    const front = sunScreen.z < 1 && sunScreen.z > -1;
    const flare = front ? Math.max(0, WEATHER.flare) * (T.lamps > 1.1 ? 0.25 : 1) : 0;
    post.setLens({ sunX: sunScreen.x * 0.5 + 0.5, sunY: sunScreen.y * 0.5 + 0.5, flare, rain: racing ? WEATHER.rain : 0, flash: WEATHER.flash });
  }

  if (game.state !== 'loading') {
    post.bloom.enabled = settings.bloom;
    if (settings.bloom || RETRO.enabled) post.render(dt, { speed: pv ? Math.min(1.3, pv.speed / 125) : 0, boost: pv && pv.boostTimer > 0 ? 1 : 0 });
    else if (inShowroom) renderer.render(showroom.scene, showroom.camera);
    else renderer.render(scene, camera);
  }
  input.endFrame();
}

// ---------------------------------------------------------------------------
// boot
(async () => {
  const prog = { polonez: 0, fiat: 0 };
  const onProg = (id) => (p) => {
    prog[id] = p;
    $('load-fill').style.width = `${Math.round(((prog.polonez + prog.fiat) / 2) * 90)}%`;
  };
  const [polonez, fiat] = await Promise.all([
    loadCarModel('polonez', onProg('polonez')),
    loadCarModel('fiat', onProg('fiat')),
    // display fonts are drawn into canvases (showroom banner) too
    Promise.all(['Propaganda', 'Kremlin', 'Mockery'].map((f) => document.fonts.load(`64px ${f}`).catch(() => null))),
  ]);
  game.cars = { polonez, fiat };
  if (!game.cars[settings.car]) settings.car = 'polonez';
  $('load-text').textContent = 'Tekstury nawierzchni…';
  await Promise.all([
    preloadRoadTextures(renderer.capabilities.getMaxAnisotropy(), RETRO.enabled),
    preloadPhotoTextures(renderer.capabilities.getMaxAnisotropy(), RETRO.enabled),
  ]);
  $('load-text').textContent = 'Budynki i drzewa…';
  await loadBuildingAssets();
  $('load-text').textContent = 'Budowanie toru…';
  $('load-fill').style.width = '95%';
  await new Promise((r) => setTimeout(r, 30));
  buildTrackList();
  buildRaceOptions();
  buildCarOptions();
  buildOptions();
  const params = new URLSearchParams(location.search);
  if (params.has('seed')) game.selection = { kind: 'random', seed: +params.get('seed') };
  if (params.has('track')) game.selection = { kind: 'preset', index: Math.max(0, PRESETS.findIndex((p) => p.id === params.get('track'))) };
  loadWorld(specForSelection());
  updateTrackListSel();
  goto('title');
  frame();
  if (params.has('autostart')) startRace();
  else if (params.has('screen')) goto(params.get('screen')); // debugging: jump straight to a menu screen
  // debug handles (used by automated tests)
  window.__game = game;
  window.__dbg = { post, fx, streaks, renderer, scene, camera, settings, music, get showroom() { return showroom; } };
  window.__nav = nav;
  window.__sim = (seconds, inputOverride) => {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps && game.race; i++) game.race.update(1 / 60, inputOverride || game.race.autoInput());
  };
})();
