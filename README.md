# SPARTAKIADA — Antygrawitacyjne Mistrzostwa PRL

Browser 3D anti-grav racer inspired by the Wipeout series: retro-futurist People's Republic of Poland, era cars turned into hover craft, tracks assembled from tiles.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (relative paths, host anywhere)
```

URL parameters: `?track=huta|zeran|spodek|trening`, `?seed=12345` (random track), `&autostart`, `&car=polonez|fiat`, `&style=psx|modern`, `&res=240|360|480|540|720`, `&weather=clear|clouds|rain|storm|snow|fog`, `&screen=main|tracks|cars|options|controls` (open a menu screen directly), `&assets=0..1` (share of hand-made models in the street rows; `0` shows only generated buildings).

## Menus

Title screen → main menu (**Wyścig**, **Opcje**, **Sterowanie**) → track select → car select → race. Everything is driven by keyboard (↑↓ move, ←→ change an option, Enter confirm, Esc back), gamepad (d-pad, A, B, Start) or mouse (`src/ui/nav.js`).

- **Track select**: preset and random tracks (Enter on "Tor losowy" rolls a new seed, or type one in), a map of the circuit with elevated sections in gold, length / features / time of day / weather, and the race options (laps, rivals, weather). The fly-over behind the menu shows the selected track.
- **Car select** (`src/ui/showroom.js`): the car idles on a turntable in a raw-concrete hall with its hover engines running, and revs when selected. ←→ switch cars; the card shows the stat bars and the livery picker. Cars differ in handling (`stats` / `handling` in `CAR_MODELS`): the Polonez has the higher top speed, the Fiat 126p accelerates and turns better.
- **Options**: music and effects volume, glow, graphics style and PSX resolution (style / resolution changes reload the game when you leave the screen).

The display fonts are in `assets/fonts/`: **Propaganda** for the logo, **Kremlin** for headings, menus and HUD numbers, **Mockery** for the countdown. None of them has Polish diacritics (and Kremlin draws nothing for `/ · — ( ) % + #`), so text set in them goes through `deaccent()` (`src/ui/text.js`), the way arcade machines of the era wrote it.

## Music

`src/audio/music.js` plays every mp3 in `assets/music/` (files named `X.mp3`, `X (1).mp3`, … become "X I", "X II", …). The first track loops in the menus; a race plays the others as a playlist, starting on a different one each race, and the HUD shows "♪ title" when a track starts. The music runs on its own bus that skips the master compressor, so the engines never pump it; pausing ducks it. Volume is separate from the sound effects (Options).

## Controls

| Key | Action |
|---|---|
| ↑ / W / Space | thrust |
| ← → / A D | steer |
| ↓ / S | brake / reverse |
| Q / E | left / right airbrake (tighter turns, needed at top speed) |
| V | camera (chase / far / bumper) |
| Esc / P | pause |
| Gamepad | RT thrust, LT brake, LB/RB airbrakes, Y camera, Start pause |

Holding thrust when the lights go green gives a launch boost.

## Project layout

```
src/
  config.js              tuning (track size, car physics)
  track/
    tiles.js             tile library – straights, curves, hills, waves, chicane,
                         tunnel, ramps, barrel roll, loop
    generator.js         procedural circuit generator + preset tracks
    trackData.js         chains tiles, resamples centerline, builds frames/curvature
    trackMesh.js         road, walls, hull, tunnels, pillars, boost pads, start gantry
  world/
    environment.js       sky, city, background skyline, landmarks, neon, billboards, parks
    skyPainter.js        painted panoramic sky (cumulus, cirrus, hills, distant PRL skyline)
    brutal.js            brutalist concrete façade textures for the generated buildings
    assets.js            hand-made buildings (glTF) + PS1 tree pack (FBX), real-world scale
    photoFacades.js      lit-window night maps for the hand-made models (+ photo façade loader)
    textures.js          procedural canvas textures
    photoTextures.js     photo textures from assets/textures/other (ground, pavements, grass, fences, graffiti)
  vehicle/
    carModel.js          FBX loading/normalising, liveries (hue shift), thruster FX
    vehicle.js           track-space hover physics, walls, boost pads, collisions
    ai.js                AI pilots
  audio/
    audioEngine.js       Web Audio graph, environment layers, one-shot SFX, 3D opponents, car-select engine rev
    engineVoice.js       synthesised engine voice
    music.js             soundtrack player (assets/music)
  ui/
    nav.js               keyboard / gamepad / mouse menu navigation, option rows
    showroom.js          car-select 3D scene
    text.js              deaccent() for the display fonts
  game/
    race.js              race session (countdown, laps, positions, results)
    camera.js, hud.js, input.js
  main.js                renderer, menus, main loop
  fx/weather.js          rain, storm (lightning + thunder), snow, fog
tools/model-viewer.html  quick viewer for checking a car model's orientation
tools/asset-viewer.html  building / tree sheets: ?mode=sides (find a model's front), ?mode=lineup (scale check)
```

## Track tiles

The world is a grid of `CONFIG.track.cell` (160 m) cells. Every tile fills one or two cells, starts in the middle of a cell edge heading +Z, and leaves through another cell edge either straight on or turned 90°. So any tile sequence that walks a closed path on the grid forms a closed circuit.

| Tile | Cells | Notes |
|---|---|---|
| `start` | 1 | start/finish line, gantry with countdown lights, grandstands |
| `straight`, `boost` | 1 | `boost` carries booster pads (`params.boosts: [{f, x}]`) |
| `rampUp`, `rampDown` | 1 | ±18 m elevation |
| `hill`, `valley`, `wave` | 1 | vertical bumps/dips (`wave` with `bumps: 2, amp: 10` = roller-coaster crests) |
| `chicane`, `doubleChicane` | 1 | lateral S-bends |
| `jump` | 1 | kicker, a real gap in the road, landing; the craft floats over it |
| `tunnel` | 1 | covered section; the audio adds reverb inside. Curves accept `tunnel: true` too |
| `barrelRoll` | 1 | 360° roll |
| `twist` | 1 | half roll, upside-down stretch, then half roll on through 360° |
| `wallRide` | 1 | rolls up to ~70° onto a "wall" and back |
| `loop` | 2 | vertical loop with a sideways offset so the exit clears the entry |
| `bridge` | 1 | straight with red suspension arches (the generator uses it on elevated sections) |
| `neonRings` | 1 | straight under animated chase-light neon arches |
| `stadium` | 1 | straight between grandstands, with a centre boost pad |
| `curveL`, `curveR` | 1 | 90°, optional `bank` (radians), `dy` (climbing curve), `boosts`, `tunnel` |

The rolling tiles (`barrelRoll`, `twist`, `wallRide`, `loop`) are magnetic rails: gravity and in-plane curvature are ignored there.

Road surfaces come from `assets/textures/roads/`. Each track picks one with `theme` (0 = lane lines, 1 = concrete, 2 = worn, mirrored because that photo isn't tileable). The photos are rotated to run along the track, softened (a little blur and less contrast, so pixel-sized grit doesn't strobe at speed) and get red/white kerbs painted on; in the modern style the same image drives the bump and roughness maps.

**Adding a tile:** write a factory in `tiles.js` that returns `pos(u)`, and optionally `roll(u)`, `up(u)` and `tags(u)`, then register it in `TILE_FACTORIES`. Its exit has to land on a cell edge.

**Generator** (`generateTrack(seed, opts)`):
1. Grows a random simple loop on a coarse grid ("bump-out" growth), then upscales it 2× so turns are always separated by straights.
2. Puts in loops where there are two straight cells in a row, then picks the rest of the straights from a weighted table. Turns become flat or banked curves.
3. Adds elevation ramps in pairs so the height always gets back to zero, plus booster pads.

Options: `cells` (track length), `loops`, `features` (0–1 density of special tiles), `ramps`, `maxSpan`.

**Hand-made tracks** use the same spec format. See `Tor Treningowy OSP` in `generator.js`:

```js
{ name: 'My track', tiles: [{ type: 'start' }, { type: 'loop', params: { dir: -1 } }, { type: 'curveR', params: { bank: 0.35 } }, …] }
```

If a hand-made track doesn't close, `TrackData` prints a warning with the size of the gap.

## Look: 32-bit arcade ("PSX" style, default)

The default graphics style aims at mid-90s arcade/console racers: the scene renders at a low internal resolution (240–720 lines, menu option, default 480) and is upscaled with a "sharp bilinear" filter (crisp pixels, anti-aliased pixel edges). Textures are point-sampled up close and trilinear-filtered in the distance (no shimmer), cars and props snap their vertices to a grid at twice the internal resolution (subtle polygon wobble), and the final pass quantises to 15-bit colour with a light 4×4 ordered dither (`src/fx/retro.js`, `PsxShader` in `src/fx/postfx.js`). There are no shadow maps, only blob shadows.

Road flicker: the road is the surface you stare at, so it is exempt from the retro tricks that made it shimmer while driving. The world (track, city, ground) doesn't vertex-snap (`retroifyObject(…, { snap: false })`), the road texture is bilinear up close (like the Namco System 22 arcade boards) with full anisotropy, there is no per-texel roughness in the PSX style, the low-resolution target has 4× MSAA, and nothing that lights the road or moves the camera uses per-frame random noise (underglow / exhaust lights and camera rumble use smooth noise). The old look is still available as "nowoczesna" (modern). Switching style reloads the page because the snapping is compiled into the shaders.

Each track has a time of day (`time: 'day' | 'dusk' | 'night'` in `src/world/atmosphere.js`) that drives sky, fog, lights, lit windows, street lamps and neon.

## Weather and lens effects

Each track has a weather (`weather` in the preset / spec, menu "Pogoda", or derived from the seed): `clear`, `clouds`, `rain`, `storm`, `snow`, `fog` (`src/fx/weather.js`). Weather changes the time-of-day preset (overcast sky, darker and denser cloud cover, thicker fog, dimmer sun) and adds:

- **rain**: streaks around the camera that stretch with its motion, splash crowns on the road, spray thrown up behind the cars, drops on the lens that refract the picture, a wet glossy road, rain noise;
- **storm**: heavier rain, lightning that lights the cloud deck and the scene, thunder;
- **snow**: chunky square flakes that drift and swirl, wind noise;
- **fog**: the classic draw-distance fog.

The sky is a **painted panorama** (`src/world/skyPainter.js`), the way 32-bit arcade racers did it: one wide texture wrapped around the horizon, painted per track from the time-of-day colours and the weather, with posterised cumulus (flat shading bands, a hard lit rim on the sun side, silver linings when back-lit), high cirrus streaks, a hazy ridge of hills and a distant PRL skyline (blocks, steelworks chimneys with smoke, a TV mast, red aviation lights, sodium sky-glow at night). Overcast weathers paint layered stratus decks and keep the procedural cloud deck overhead; fog paints no cumulus. The post pass draws an era-style **lens flare** (sun glow, anamorphic streak, hexagon and ring ghosts through the screen centre) whenever the sun disc is actually visible in the frame.

## Photo textures

`src/world/photoTextures.js` loads the photos in `assets/textures/other/` at start-up (softened a little and filtered bilinear, like the road, so they don't shimmer at speed). Each entry in `PHOTO` has the real-world size one repeat covers.

- `concrete_floor`: the ground plane (large concrete slabs), tinted by the time of day's ground colour.
- `concrete_sidewalk`: the pavements along the track (50 cm slabs).
- `grass_sidewalk`: runs of pavement with a grass verge on the building side (more of them in leafy city themes).
- `grass`: lawns under the clumps of park trees in the background.
- `concrete_wall`: PRL precast "jumbo" fences that close off some side streets and vacant lots (more often in the `huta` theme).
- `concrete_graffiti`: some of those fences, and ~40 % of the outer side faces of the track hull (in 60 m chunks).
- `concrete_wall_advertistmens`: fences covered in pasted-up posters.

If a photo fails to load, the old procedural texture is used.

## Hand-made assets

`src/world/assets.js` loads the Blockbench buildings from `assets/buildings/*.gltf` and the PS1-style tree pack from `assets/ps1-style tree pack/`. Each model is turned so its street front faces +Z and scaled to its real height (a RUCH kiosk is 2.7 m tall, panel blocks 28–33 m, point blocks 40–44 m, trees 6–11 m). The registry (`BUILDINGS`, `TREES`, `GRASS`) holds height, front direction and kind (`block`, `tower`, `office`, `shop`, `hall`, `kiosk`). The city fills part of each row with these models (`assets` / `kinds` in `CITY_THEMES`), puts kiosks on the corners of side streets and trees with grass tufts along the pavements and in the side streets; the background gets clumps of park trees. Every model and tree type is one instanced draw call per part. At dusk and night the building textures get lit-window emissive maps made from the texture itself.

The generated buildings are brutalist (see below); the photo façades in `assets/textures/buildings/` are no longer used for them.

## Trackside city

`src/world/city.js` lines both edges of the track with continuous rows of buildings behind a narrow pavement, the way old arcade street circuits do, so the road reads as a street through a city:

- Generated buildings are **brutalist**. Textures (`src/world/brutal.js`): raw béton brut with board-marked formwork, tie holes and rain streaks; windows sunk deep into the concrete; styles `waffle` (deep concrete grid), `ribbon` (ribbon windows under heavy spandrels), `fins` (vertical concrete fins), `panel` (precast panels with loggias), `blank` (ribbed stair cores) and `hall` (ribbed industrial wall with a clerestory), plus glazed / solid ground floors. Massing forms (`forms` in `TYPES`): `plain` slabs with heavy parapets, `pilotis` (upper floors on columns over a recessed glazed ground floor), `inverted` (upper floors cantilevered over a narrower base), `stepped` terraces, and `core` (ribbed stair towers rising past the roof); towers sit on waffle podiums. The type names (`blok`, `kamienica`, `socrealizm`, `wiezowiec`, `hala`, `pawilon`, `futuro`) are kept so the city themes still work. Everything is tinted per building with vertex colours. The background skyline and the tunnel gateway buildings use the same concrete.
- Each row follows the track. Every footprint is checked against the centreline (spatial hash) and against the other buildings (occupancy grid). On tight inside corners a building shrinks or steps back. Next to elevated sections, buildings grow taller so the canyon walls stay above the road.
- Tunnels become gateway buildings with an arched portal that the road dives through. Footbridges with slogan banners span the road on straights. Side-street gaps show the background skyline.
- Street furniture: lamp posts (they glow at night), red/white flags, lime trees, rooftop neon signs, murals.
- City themes (`CITY_THEMES`): `centrum`, `huta`, `nocna`, `futuro`. Presets set `time` and `city`; random tracks derive both from the seed.
- Everything is batched per material, so the whole city is a few dozen draw calls.

## Visual effects

- **Engines** (`src/fx/engineFx.js`): an anti-grav jet in the style of futuristic racers. Each nozzle has a white-hot core with a coloured rim, a flare with a horizontal streak, and a tight jet plume with shock diamonds on boost. Behind it, a light-trail ribbon in world space grows with speed and fades near the camera. Lifting off the throttle flashes the nozzle. Jet colours are set per car (`engine` in `CAR_MODELS`).
- **Car FX** (`src/fx/carFx.js`): the car models already have their four downward hover engines where the wheels were, so the code adds no hardware, only the exhaust: a white-hot nozzle glow with a coloured rim at the bottom of each engine, a small flare, and a short hot jet down to the road that gimbals back under throttle and sideways when steering. There is a faint heat glow on the road under each, plus wash particles. Each car has a blue underglow point light, and the player's exhaust also casts light. Wall scrapes throw sparks, and boost pads and jump landings get bursts.
- **Particles** (`src/fx/particles.js`): world-space, CPU-simulated, one draw call each for additive and alpha blending. Particle profiles define colour and size over the particle's life.
- **Atmosphere** (`src/world/atmosphere.js`): a gradient sky dome with the painted panorama around the horizon, stars, a striped retro sun at dusk and (overcast only) an fbm cloud deck overhead. Every built-in material gets exponential height fog that glows toward the sun. The sun light casts shadows and its shadow frustum follows the player.
- **Post** (`src/fx/postfx.js`): 4× MSAA HDR target, bloom, a grade pass (vignette, chromatic aberration that grows with speed, radial blur on boost, red flash on impacts, film grain), and speed streaks around the camera.
- **Camera**: always kept above the road surface and inside the walls, so it can't dip under the track at the bottom of ramps.

Anchor points for the thrusters and exhaust are set per car in `CAR_MODELS` (`anchors.pods`, `anchors.exhausts`).

## Physics model

Craft are simulated in track space: distance `s`, lateral offset `x`, and heading `yaw` relative to the track. When the track curves, heading and velocity are counter-rotated by the curvature, so a craft keeps its world direction and you have to steer through corners. Lateral grip, airbrakes, banking gravity and slope gravity are layered on top. Loops and barrel rolls are flagged `MAGNET`, which turns gravity off there. Because the craft is bound to the track parameterisation, loops and rolls need no special collision handling.

## Sound engine

All sound effects are synthesised; the only sample files are the music tracks.

- **Engine voice** (`src/audio/engineVoice.js`): deep and chesty, a big-block V8 bolted to a jet rather than a buzzing turbine. The core is a custom periodic wave with a V8-style "half-order" spectrum, played twice slightly detuned, through a soft asymmetric tanh saturation and two gentle low-passes (the load-dependent one tops out around 2 kHz, a fixed one at 3 kHz). Triangle AM at the firing rate makes it burble at idle and smooth at speed. Under it: a sine sub on the firing frequency plus a triangle an octave lower, and brown-noise rumble below 160 Hz pulsed by the same AM. On top: a quiet turbine sine at 3× f0, low intake noise, and an afterburner roar (low saw + brown noise) while boosting. The voice ends in a low-shelf boost, a +4 dB "growl" peak at 220 Hz (so it stays big on small speakers), a −6 dB cut at 2.8 kHz and a −10 dB high shelf. The firing frequency runs from about 42 Hz (idle) to about 177 Hz (top speed) and about 290 Hz on boost. Each car has its own pitch (`voice` in `CAR_MODELS`: the Fiat is higher).
- **Reacting to the situation.** Revs overshoot when you stab the throttle, the exhaust pops (low thuds) when you lift off, wind and whistle rise with speed, the airbrakes hiss in stereo, and wall scrapes are noise plus ring-modulated metal panned to the wall's side. There's also a magnetic hum in loops and rolls, convolution reverb that swells in tunnels, impact/bump thumps, and a boost-pad whoosh with a chime.
- **Opponents.** Lighter engine voices, each with its own pitch character. They are positioned with `PannerNode`s, with Doppler worked out by hand from the relative velocity.

## Adding a car

Drop the model into `assets/cars/` and register it in `CAR_MODELS` (`src/vehicle/carModel.js`). Cars use their real lengths (Polonez 4.27 m, Fiat 126p 3.05 m), and the chase camera scales with the player's car. It then shows up in the menu's vehicle picker, and opponents alternate between the registered models. Set `rotation` so the model ends up Y-up with its nose on +Z, and set `anchors` for the 4 hover pods and the exhaust pipe(s), in model units after rotation, plus optional `length` (m), `engine` (`size`, `color`, `boostColor`), `voice` (engine pitch), `stats` (1–5 bars for the car-select card) and `handling` (multipliers for thrust, drag, steer and grip). `tools/model-viewer.html?file=/assets/cars/x.fbx` helps check both. The loader centres the model, puts its bottom at y = 0 and scales it to `CONFIG.car.length`. Opponent liveries are hue shifts of the original texture.

## Ideas / next steps

- More era models (Fiat 125p, Syrena, Warszawa, Nysa…)
- Announcer
- Time-trial mode with ghost, saved best laps
- Track editor UI on top of the tile spec format
- Weapons and shields (left out on purpose for now)
