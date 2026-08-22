<div align="center">

# ✦ ASTRAY

### a quiet universe where people draw planets and leave them for others to find 🌌

[![enter the universe](https://img.shields.io/badge/▶%20enter%20the%20universe-go--astray.vercel.app-ff7a2f?style=for-the-badge&labelColor=0b0e14)](https://go-astray.vercel.app)

[![stars](https://img.shields.io/github/stars/Antara-Paul04/Planets?style=flat-square&labelColor=0b0e14&color=ffd479)](https://github.com/Antara-Paul04/Planets/stargazers)
[![forks](https://img.shields.io/github/forks/Antara-Paul04/Planets?style=flat-square&labelColor=0b0e14&color=88bbee)](https://github.com/Antara-Paul04/Planets/network/members)
[![last commit](https://img.shields.io/github/last-commit/Antara-Paul04/Planets?style=flat-square&labelColor=0b0e14)](https://github.com/Antara-Paul04/Planets/commits)
![three.js](https://img.shields.io/badge/three.js-r170-000?style=flat-square&labelColor=0b0e14)
![vite](https://img.shields.io/badge/vite-6-646CFF?style=flat-square&labelColor=0b0e14)
![accounts](https://img.shields.io/badge/accounts-zero-c4f24a?style=flat-square&labelColor=0b0e14)

*there are worlds out there.*

<!-- 📸 SCREENSHOTS: drop a PNG in docs/ and uncomment (see the README note for the shot list)
<img src="docs/universe.png" alt="a star and its hand-drawn worlds" width="92%">
-->

</div>

---

You **draw a planet** on a little canvas, **name it**, and **launch it** — it sails
off, finds a star, and starts to orbit. Then it's just… *there*, quietly circling
its sun, for anyone who drifts by. 🪐

No feed. No likes. No profiles. **Just planets.**

## ✨ the loop

> 🔭 explore → 🎨 draw → 🌈 make it yours → ✍️ name → 🚀 launch → 🔎 discover

- 🎨 **draw** — one honest brush, a curated palette, an eraser. Your art wraps around the back of the sphere.
- 🌈 **make it yours** — pick a surface and a mood. Rings? Moons? *The universe decides.*
- 🚀 **launch** — your world glides out to orbit a real star; a quiet line whispers where it went.
- 🔎 **discover** — search by name (every one is unique) and travel there. Love it? Share its collectible card.

## 🌌 what makes it feel alive

- 🛰️ a **spacecraft-instrument HUD** over a living 3D sky — hairline strokes, condensed type, a whisper of amber
- 🌫️ **real depth** — a world-fixed dust field + distant nebulae that drift and resolve as you cross the void
- ☀️ planets **lit by their own suns** (true day/night terminators), cratered moons, banded rings
- 🎧 a **generative soundscape** that answers to nearby suns, dense regions, and the odd passing comet
- 📱 **built for phones too** — recomposed for touch, not shrunk from desktop

## 🕵️ anonymous by design

no accounts · no logins · no tracking · no cookies — just two quiet, fair rules:

- 🪐 **one planet per network** — a public IP can make one planet, enforced in the database via a one-way hash of the IP (the raw IP is never stored). it's per-*network*, not per-person.
- 🚩 **community moderation** — a planet reported by **3 different networks** is hidden; reporter identities are one-way hashes, and a creator never learns who reported.

→ the full, plain-English story lives in [`PRIVACY.md`](PRIVACY.md).

## 🚀 run it

```bash
npm install
npm run dev        # front end on :5173, proxies /api → :3000
vercel dev         # second terminal — serves the /api functions
```

> ⚠️ `npm run dev` **alone** leaves `/api/*` unanswered — every call 500s and the universe boots empty. Run `vercel dev` alongside it.

```bash
npm test           # 67 tests · node --test
```

## 🛠️ under the hood

Vanilla **Three.js** + **Vite**, no framework. Persistence is a free **Supabase**
project (Postgres + Storage) behind **Vercel** serverless functions — the browser
only ever talks to `/api/*`, and the service-role key stays server-side. The whole
universe is **deterministic from one seed**, so space looks the same on every
visit; only your planets are dynamic. Stars fill by type (blue 4 · white 6 ·
orange 9 · yellow 12 · red 15) and when they're full the universe **mints a
brand-new star** to home your world — creation never gets blocked for space.

<details>
<summary>🗺️ &nbsp;map of the code</summary>

```
src/galaxy/   universe seed · scene · animated stars · planets · deep-space environment
src/ui/       creation flow (draw · make-it-yours · preview) · search · info · planet card
src/          main (wiring) · travel · focus · audio · style.css (instrument UI + responsive)
api/          create-planet · planets · report · search          (Vercel serverless)
lib/          db · name & image validation · reports (IP→HMAC) · creation limit
supabase/     migrations 001–004
```
</details>

<div align="center">

### [▶ go plant something →](https://go-astray.vercel.app)

<sub>built with 🩷 for the joy of it 🌠</sub>

</div>
