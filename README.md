<div align="center">

# ✦ Astray

**a quiet universe where people draw planets and leave them for others to find**

[**enter the universe →**](https://go-astray.vercel.app)

*there are worlds out there.*

</div>

---

Astray is an ambient 3D universe you can wander. Draw a planet on a little
canvas, name it, and launch it — it sails off, finds a star, and starts to
orbit. Then it's just… there, quietly circling its sun, for anyone who drifts
by. No feed, no likes, no profiles. Just planets.

People make the planets. The universe makes the rest.

## The loop

**explore → make a planet → draw it → make it yours → name it → launch → discover**

- **Draw** — one honest brush, a curated palette, a few sizes, an eraser, undo/redo. The left and right edges wrap, so your art meets itself around the back of the sphere.
- **Make it yours** — pick a surface and a mood. Whether it gets rings, moons, or neither is the universe's call, not yours.
- **Launch** — your world glides from the camera out to its orbit around a real star; a quiet line tells you where it went.
- **Discover** — search the universe by name (every name is unique) and travel to any planet. Made one you love? Share its collectible card.

## What it feels like

- A **spacecraft-instrument HUD** — hairline strokes, condensed type, restrained amber — laid over a living 3D sky.
- **Real depth**: a world-fixed dust field and distant nebulae that drift and resolve as you cross the void, so travel actually *feels* like distance.
- Planets **lit by their own suns** (true day/night terminators), cratered moons, banded rings.
- A **generative soundscape** that responds to nearby suns, dense regions, and the occasional passing comet.
- **Made for phones too** — recomposed for touch, not shrunk from desktop.

## Anonymous by design

No accounts, no logins, no profiles, no tracking, no cookies. The only rules are quiet and fair:

- **One planet per network.** A single public IP can create one planet — enforced in the database via a one-way HMAC of the IP; the raw IP is never stored. It's per-*network*, not per-person: a VPN or a different network gets another, and people sharing a connection share a slot.
- **Community moderation.** A planet reported by **three different networks** is hidden. Reporter identities are one-way hashes; a creator never learns who reported.

Full, plain-English details in [`PRIVACY.md`](PRIVACY.md).

## Run it locally

```bash
npm install
npm run dev        # front end on :5173, proxies /api → :3000
vercel dev         # second terminal — serves the /api functions
```

> **Heads up:** `npm run dev` alone leaves `/api/*` unanswered — every call 500s and the universe boots empty. Run `vercel dev` alongside it for the backend.

```bash
npm test           # node --test
```

## Backend (optional — it runs local-only without it)

Persistence is a free **Supabase** project (Postgres + Storage) behind **Vercel**
serverless functions. The browser only ever talks to `/api/*`; the service-role
key stays server-side.

1. Create a Supabase project and run the migrations **in order** in the SQL editor:
   `001_initial_schema` → `002_star_capacity` → `003_unique_names_and_search` → `004_creator_ip_limit`.
2. Set the vars from [`.env.example`](.env.example): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REPORT_IP_SALT`.

Artwork (a small WebP) lives in a public Storage bucket; the database stores only
the path. Without the env vars the app still runs — everything regenerates from
the universe seed, planets just don't persist.

## How the universe works

- **Deterministic.** Stars, density regions, and the deep-space backdrop all
  derive from a single `UNIVERSE_SEED`, so space looks the same on every visit —
  only user planets are dynamic.
- **Server-authoritative placement.** The browser proposes nearby stars; the
  `assign_planet` Postgres function atomically picks the first with a free slot
  (locking per-star), computes a non-colliding orbit, and inserts the planet.
- **Stars fill up; the universe grows.** Capacity by type — blue 4 · white 6 ·
  orange 9 · yellow 12 · red 15. When every nearby star is full, a brand-new star
  is minted deterministically, far out, to home your world. Creation is never
  blocked for space.
- **Interstellar travel.** "Find my planet" from across the universe is a real
  journey: the camera arcs toward the destination, star-trails stretch by actual
  speed, the sky dims, and the system resolves beacon → star → orbits → planets
  on approach.

## Map of the code

```
src/
  galaxy/    universe seed · scene · animated stars · planets · deep-space environment
  ui/        creation flow (draw · make-it-yours · preview) · search · info · planet card
  main.js    wiring · the one-world gate · toasts
  travel.js  interstellar-journey director      focus.js   click-to-visit flights
  audio.js   generative soundscape              style.css  instrument UI + responsive layer
api/         create-planet · planets · report · search   (Vercel serverless)
lib/         db · name normalization · image validation · reports (IP→HMAC) · creation limit
supabase/    migrations 001–004
```

Built with vanilla [Three.js](https://threejs.org) + [Vite](https://vitejs.dev),
no framework. Made for the joy of it.

<div align="center"><sub>go plant something.</sub></div>
