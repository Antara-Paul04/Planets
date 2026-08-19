# planets — a quiet universe (prototype)

People make planets. The universe makes the rest.

An ambient 3D universe of user-created planets: draw on a 2D canvas, style it,
name it, launch it — and if you're near a sun when you launch, your planet
joins that solar system. Leave the page open and the universe keeps going:
the camera drifts, comets pass, stars burn, meteor showers come and go.

No backend, no accounts. Your latest planet is remembered in localStorage
("find my planet"); everything else regenerates deterministically from the
universe seed.

## Run

    npm install
    npm run dev

## The loop

explore → make a planet → draw → make it yours → name → preview → launch → explore

- **Drawing toy**: pencil / pen / marker / brush / highlighter / eraser / fill /
  line / box / circle / blob / stamps (13 hand-drawn) / patterns / text (4 fonts),
  5 curated palettes + free color, brush sizes, ink opacity, symmetry (mirror /
  flip / kaleidoscope), doodle helpers, background layer, undo/redo (⌘Z / ⌘⇧Z).
  Strokes draw thrice (x±width) so artwork tiles seamlessly around the seam.
- **Make it yours**: surface type (material), atmosphere (+color), optional vibe.
  Rings, moons, aurora, placement, orbits: the universe decides.
- **Launch**: the planet sails from the camera to its spot; a quiet toast says
  where it went ("now circling a sun" if it joined a system).

## Architecture

- `src/galaxy/universe.js` — universe seed + density regions (future galaxy/cluster hook)
- `src/galaxy/scene.js` — renderer, camera, controls, base lighting
- `src/galaxy/environment.js` — seeded backdrop & events: background/twinkle stars,
  major suns, nebulae, asteroid fields (InstancedMesh), drifting motes, and the
  rare-event director (comets, meteor showers, solar flares) with long cooldowns
- `src/galaxy/stars.js` — major stars: animated plasma shader + limb corona,
  LOD + click proxies, 5 star types, extent-aware orbit assignment with
  per-system planes (`star → solar system → planets`), shared orbit-path lines
- `src/galaxy/planets.js` — PlanetField: LOD planets (full / low-poly / tinted far),
  pooled materials, procedural rings/moons/aurora, vibes, orbits, travel/spawn anims
- `src/galaxy/textures.js` — procedural 256×128 surfaces for seeded planets
- `src/galaxy/atmosphere.js` — per-pixel bell-falloff rim glow (no halo ring)
- `src/ui/creator.js` + `src/ui/painter.js` + `src/ui/stamps.js` — creation flow,
  two-layer paint engine, live wrap preview, rotatable final preview
- `src/ambient.js` — idle-triggered procedural camera drift (organic legs, no loops),
  UI fade; any interaction returns control instantly
- `src/travel.js` — interstellar travel director (orient → cruise → settle),
  GPU star-streak field, sky dimming, exposure/FOV swell, Escape-cancel
- `src/audio.js` — optional generative WebAudio soundscape (hum/pad/air layers +
  soft lone tones) that responds to suns, dense regions, comets, meteors, flares
- `src/focus.js` — click-to-visit camera flight (sunlit-side approach, follows
  orbiting planets), minimal name label
- `src/perf.js` — fps/draw-call readout + 50–1000 planet stress buttons (press `p`)

## Star capacity (v15)

Every star supports a maximum number of USER planets, derived deterministically
from its type (no storage, no randomness): blue 4, white 6, orange 9, yellow 12,
red 15 — ordered by the type's characteristic size. Assignment is
server-authoritative and atomic: the browser proposes candidate stars
(nearest-first); the `assign_planet` Postgres RPC picks the first with a free
slot — locking per-star so simultaneous creators can't overflow a system —
computes a fresh non-colliding orbital band, and inserts the planet. Capacity
counts ALL rows for a star (hidden included: hiding never frees a slot). If
every candidate is full, a new star is minted deterministically (id >=
1,000,000, position/type derived from an id hash) far out and persisted;
existing deterministic stars (ids 0..N) and their positions/planets never
change. Capacity is invisible — no meters, no "4/6" UI. Only user planets
exist; nothing is auto-populated. Migration `002_star_capacity.sql`.

## Backend: Supabase persistence + reporting (v13-v14)

User-created planets persist in Supabase (free plan): a `planets` table
(UUID, name, birth date, star relationship, 3D position, orbit parameters,
moons-XOR-rings config, visibility status), a `stars` table (deterministic
suns; zero-planet stars are fine), and `planet_reports`. Artwork lives in
the public-read `planet-artwork` Storage bucket (512x256 PNG, ~30-80KB,
capped at 300KB) — the DB stores only `artwork_path`. The browser talks
only to `/api/*` (Vercel functions); the service-role key is server-only;
RLS is enabled with anon read access limited to visible planets and stars.

The whole moderation rule: **three DIFFERENT IP addresses report a planet
and it becomes hidden** — enforced atomically in the `report_planet()`
Postgres function with a `(planet_id, reporter_ip_hash)` unique constraint.
Reporter IPs are stored only as server-side HMAC digests; the client can
never supply its own IP (trusted proxy headers only — Vercel overwrites
`x-real-ip`/`x-forwarded-for`). Hidden planets keep their row and artwork
but never leave the database through public queries. No accounts, no
identities, nothing personal anywhere.

Setup: create a free Supabase project, run
`supabase/migrations/001_initial_schema.sql` in the SQL editor, then set
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`REPORT_IP_SALT` (see `.env.example`). Without them the app runs exactly
as before, local-only. World state is written once per creation; orbital
motion stays client-side (no per-frame writes).

## Identity & satellites (v10-v11)

Every planet carries a permanent `created_at` — seeded worlds are born at a
deterministic moment in the universe's past; user planets at launch; the
focus label shows it as "born · 19 August 2026". Satellites are exclusive:
a planet has moons, or rings, or neither (~70/20/10) — enforced in the data
model, with persisted conflicts resolved deterministically (moons win) and
written back once. Rings are banded dusty debris (radial shader with grain
and a gap, per-planet seed) in the planet's equatorial plane; moons orbit in
their own tilted planes. The soundscape gained planet-proximity and
interstellar-emptiness layers, a quiet birth chime on launch, slow
irrational-period drifts so nothing loops, and distance-attenuated events.
Camera feel: interruptible focus flights (grab mid-flight to take over),
free-space pivot re-anchoring, livelier rotate/pan, and a lag-following
near-sky layer for parallax.

## Interstellar travel (v9)

"Find my planet" from another system is a continuous physical journey, not a
teleport: the camera turns toward the destination, pulls back half a step,
then accelerates along a slightly-arced path. A GPU streak field (one
LineSegments draw call, 420 segments, scrolling-corridor shader) stretches
star-trails along the actual travel direction, scaled by actual camera speed —
so acceleration and deceleration read naturally. The decorative sky dims at
speed, exposure and FOV swell slightly, and the soundscape (if on) rises like
space itself changing. Duration scales with real distance (~4s near, capped
8.5s across the universe). The destination resolves the same way any system
does — beacon → star → orbit lines → planets — and the sequence hands off to
the normal planet-focus flight. Escape decelerates smoothly and returns
control; controls, planet clicks, and creation are locked while traveling;
ambient mode is suspended and resumes after arrival inactivity.

## Spatial scale (v8)

Solar systems span ~50-200 units; neighboring stars sit 2,600-18,000 apart —
the universe is mostly empty space. From interstellar range a whole system
collapses into a single warm point of light (a clamped-size "beacon"); planets
vanish entirely (empty LOD level) long before their star does. Click a distant
beacon to cross the void — the system reveals itself progressively on approach.
The decorative sky (background stars, nebulae, motes) follows the camera; the
real universe does not. Zoom is multiplicative, so it is scale-aware by nature.

## Performance (measured, forced GPU sync)

- 64 planets + full environment: ~5 ms/frame
- 1000 planets, camera inside a system: ~8 ms/frame, ~140 draw calls
- planets beyond visibility are frozen: no rotation, no orbit advance, no
  per-frame matrix recomposition (≈880 of 1000 frozen at any moment)

Techniques: shared geometry, pooled materials/textures (ring geometry cache
quantized to stay bounded), THREE.LOD with a vanish level, frozen matrices on
every static object, instanced asteroids, two shared star point-lights that
follow the nearest suns, one shared unit-circle geometry + one line material
per system for all orbit paths (faded and hidden by distance), no
post-processing, pixelRatio capped at 2.

## Data model (backend-ready, not yet wired)

    stars { id, position, type, radius, seed }        ← deterministic from universe seed
    solar_systems ≡ star.id
    planets { id, solarSystemId?, orbit?, position, name, artwork(dataURL), look, createdAt }

`localStorage['planets.myPlanet.v1']` holds the user's latest planet in exactly
this shape; swapping in Supabase later means persisting the same objects.
