import * as THREE from 'three';
import { createScene } from './galaxy/scene.js';
import { Environment } from './galaxy/environment.js';
import { PlanetField, orbitExtentOf, normalizeLook } from './galaxy/planets.js';
import { FocusController } from './focus.js';
import { createPerfPanel } from './perf.js';
import { createCreator } from './ui/creator.js';
import { AmbientDirector } from './ambient.js';
import { IntroDirector } from './intro.js';
import { createInfoSheet } from './ui/info.js';
import { TravelDirector } from './travel.js';
import { createPlanetRemote, fetchSharedPlanets, reportPlanetRemote, loadArtworkCanvas, searchPlanets, fetchPlanetByName } from './backend/client.js';
import { createSearch } from './ui/search.js';
import { createPlanetCard } from './ui/planetCard.js';
import { createArrival } from './ui/arrival.js';
import { normalizeNameKey } from '../lib/name.js';
import { nameFromSlug, slugForName } from '../lib/song.js';
import { assignOrbit, orbitPosition, claimOrbitRadius } from './galaxy/stars.js';
import { Soundscape } from './audio.js';

const STORAGE_KEY = 'planets.myPlanet.v1';

const { renderer, scene, camera, controls, sun } = createScene(document.getElementById('app'));

// ---- arriving by a planet's link: /p/<slug> (or ?p=<slug> from the OG shell) ----
// The visitor is flown to that planet as soon as the universe has loaded; the
// flight itself is the intro. Nothing else about boot changes.
function parseLanding() {
  const m = /^\/p\/([^/]+)\/?$/.exec(window.location.pathname);
  const q = new URLSearchParams(window.location.search).get('p');
  const slug = m ? m[1] : q;
  if (!slug) return null;
  let raw = slug;
  try { raw = decodeURIComponent(slug); } catch { /* keep as-is */ }
  const keys = [...new Set([normalizeNameKey(raw), normalizeNameKey(nameFromSlug(slug))].filter(Boolean))];
  return { slug, keys };
}
const landing = parseLanding();

const env = new Environment(scene, camera);
const field = new PlanetField(scene, env.suns);
// Stars are procedural; planets are user-generated. The universe starts with
// its deterministic stars and ZERO planets — only worlds persisted in
// Supabase (loaded below) ever appear as planets.

const focus = new FocusController(camera, controls, document.getElementById('planet-label'));

// the universe is enormous now — start the visitor inside a solar system,
// not floating in the void at the origin. On a first visit the intro drifts
// the camera in from far out; returning visitors land here immediately.
let intro = null;
{
  const home0 = env.stars[0];
  const restingPos = new THREE.Vector3();
  const restingTarget = new THREE.Vector3();
  if (home0) {
    const span = Math.max(home0.influence, 120);
    restingPos.copy(home0.position).add(new THREE.Vector3(span * 0.55, span * 0.4, span * 1.15));
    restingTarget.copy(home0.position);
  } else {
    restingPos.set(0, 14, 85);
  }
  camera.position.copy(restingPos);
  controls.target.copy(restingTarget);
  intro = new IntroDirector({
    camera, controls, restingPos, restingTarget,
    lineEl: document.getElementById('intro-line'),
    onReveal: () => document.body.classList.remove('intro'),
  });
}

// ---- my planet: kept in localStorage so "find my planet" survives refresh ----
let myPlanet = null;
const findBtn = document.getElementById('find-btn');

function saveMyPlanet(spec, canvas, derived) {
  try {
    const small = document.createElement('canvas');
    small.width = 512;
    small.height = 256;
    small.getContext('2d').drawImage(canvas, 0, 0, 512, 256);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 1,
      name: spec.name,
      remoteId: spec.remoteId || null,
      createdAt: spec.createdAt,
      position: spec.position.toArray(),
      orbit: spec.orbit
        ? { starId: spec.orbit.starId, radius: spec.orbit.radius, angle: spec.orbit.angle, speed: spec.orbit.speed, incl: spec.orbit.incl, node: spec.orbit.node || 0 }
        : null,
      solarSystemId: spec.solarSystemId,
      song: spec.song || null,
      message: spec.message || null,
      derived: {
        look: derived.look,
        type: derived.type,
        scale: derived.scale,
        rotationSpeed: derived.rotationSpeed,
        tilt: derived.tilt,
        emissive: derived.emissive,
        radiusMult: derived.radiusMult,
        aurora: derived.aurora,
      },
      dataURL: small.toDataURL('image/png'),
    }));
  } catch (err) {
    console.warn('could not save planet locally', err);
  }
}

function restoreMyPlanet() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch { /* corrupted — start fresh */ }
  if (!saved || saved.v !== 1) return;
  // migrations: a permanent birth date, and moons-XOR-rings exclusivity —
  // resolved once, written back, never re-rolled
  let migrated = false;
  if (!saved.createdAt) {
    saved.createdAt = Date.now();
    migrated = true;
  }
  const lk = saved.derived && saved.derived.look;
  if (lk && (lk.moon || (lk.rings && lk.moons && lk.moons.length))) {
    normalizeLook(lk); // migrates legacy single-moon saves and resolves conflicts
    migrated = true;
  }
  if (migrated) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* fine */ }
  }
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    canvas.getContext('2d').drawImage(img, 0, 0, 1024, 512);
    let orbit = null;
    let position = new THREE.Vector3().fromArray(saved.position);
    const savedStar = saved.orbit ? env.getStar(saved.orbit.starId) : null;
    if (savedStar) {
      const star = savedStar;
      const radius = claimOrbitRadius(star, saved.orbit.radius, orbitExtentOf(saved.derived.scale, saved.derived.look));
      orbit = { ...saved.orbit, radius, center: star.position.clone() };
      // if the radius was nudged, keep the speed law consistent with it
      if (radius !== saved.orbit.radius) {
        orbit.speed = (2.6 / Math.pow(radius, 0.85)) * Math.sign(saved.orbit.speed || 1);
      }
      position = orbitPosition(orbit, new THREE.Vector3());
    } else {
      // planet saved before solar systems existed: the nearest sun adopts it
      const star = [...env.stars].sort(
        (a, b) => a.position.distanceTo(position) - b.position.distanceTo(position)
      )[0];
      if (star) {
        orbit = assignOrbit(star, Math.random, 0, orbitExtentOf(saved.derived.scale, saved.derived.look));
        position = orbitPosition(orbit, new THREE.Vector3());
        saved.solarSystemId = star.id;
        // write the adoption back so the planet stays put across reloads
        saved.orbit = { starId: star.id, radius: orbit.radius, angle: orbit.angle, speed: orbit.speed, incl: orbit.incl, node: orbit.node };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* fine */ }
      }
    }
    myPlanet = field.addUserPlanet({
      name: saved.name,
      canvas,
      derived: saved.derived,
      position,
      orbit,
      solarSystemId: saved.solarSystemId ?? (orbit ? orbit.starId : null),
      createdAt: saved.createdAt,
    });
    if (saved.remoteId) myPlanet.remoteId = saved.remoteId;
    myPlanet.song = saved.song || null;
    myPlanet.message = saved.message || null;
    findBtn.classList.remove('gone');
  };
  img.src = saved.dataURL;
}
restoreMyPlanet();

findBtn.addEventListener('click', () => {
  if (!myPlanet || travel.active || creator.isOpen()) return;
  const dist = camera.position.distanceTo(myPlanet.position);
  if (dist < 800) {
    // already in the neighborhood — the ordinary focus flight is enough
    focus.focus(myPlanet);
    return;
  }
  focus.clear();
  const destStar = env.getStar(myPlanet.solarSystemId) ?? [...env.stars].sort(
    (a, b) => a.position.distanceTo(myPlanet.position) - b.position.distanceTo(myPlanet.position)
  )[0];
  if (!travel.begin(myPlanet, destStar)) focus.focus(myPlanet);
});

// ---- optional soundscape (created early: the creator chimes through it) ----
const audio = new Soundscape();

// ---- launch ----
const toast = document.getElementById('toast');
let toastTimer = null;
const planetCard = createPlanetCard();

const creator = createCreator({
  onPreview: () => audio.tick(),
  async onLaunch({ name, canvas, derived, song = null, message = null }) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const start = camera.position.clone().addScaledVector(dir, 14);
    const extent = orbitExtentOf(derived.scale, derived.look);

    // propose candidate stars nearest-first; the SERVER decides the final home
    // and orbit (capacity is enforced there, never trusted from the browser).
    const candidates = [...env.stars]
      .sort((a, b) => a.position.distanceTo(camera.position) - b.position.distanceTo(camera.position))
      .map((s) => ({
        id: s.id, type: s.type, seed: s.seed,
        x: s.position.x, y: s.position.y, z: s.position.z,
        radius: s.radius, plane_incl: s.plane.incl, plane_node: s.plane.node,
      }));

    const clientRef = crypto.randomUUID();
    const remote = await createPlanetRemote({ clientRef, name, canvas, candidates, extent, derived, song, message });
    if (remote.nameTaken) return { nameTaken: true }; // the creator asks for another name
    if (remote.planetLimitReached) return { planetLimitReached: true }; // one planet per network
    if (remote.unavailable) {
      universeStatus.classList.add('show');
      return { failed: true, unavailable: true }; // nothing spawns, drawing kept
    }
    if (remote.error) {
      return { failed: true }; // creator shows a gentle message, drawing kept
    }
    universeStatus.classList.remove('show'); // the universe answered

    let homeStar; let orbit; let createdAt; let remoteId = null;
    if (remote.ok) {
      // server-authoritative: use the star + orbit the universe assigned,
      // materializing a freshly-minted star if every existing one was full
      const a = remote.planet;
      homeStar = env.getStar(a.star.id) || env.addDynamicStar(a.star);
      orbit = {
        starId: homeStar.id, center: homeStar.position.clone(),
        radius: a.orbit.radius, angle: a.orbit.angle, speed: a.orbit.speed,
        incl: a.orbit.incl, node: a.orbit.node,
      };
      createdAt = Date.parse(a.createdAt);
      remoteId = a.id;
      claimOrbitRadius(homeStar, orbit.radius, extent); // keep local bookkeeping in sync
    } else {
      // dev fallback (no backend configured): assign locally, as before
      homeStar = env.getStar(candidates[0].id) || env.stars[0];
      orbit = assignOrbit(homeStar, Math.random, derived.extraGap || 0, extent);
      orbit.incl = homeStar.plane.incl + Math.max(-0.18, Math.min(0.18, orbit.incl - homeStar.plane.incl));
    }
    const end = orbitPosition(orbit, new THREE.Vector3());
    const wasNear = homeStar && camera.position.distanceTo(homeStar.position) < homeStar.influence;

    myPlanet = field.addUserPlanet({
      name, canvas, derived,
      position: end,
      orbit,
      solarSystemId: homeStar.id,
      travelFrom: start,
      createdAt,
    });
    if (remoteId) myPlanet.remoteId = remoteId;
    myPlanet.song = song || null;
    myPlanet.message = message || null;
    saveMyPlanet(myPlanet, canvas, derived);
    findBtn.classList.remove('gone');
    refreshCreationGate(); // this browser has planted its one world
    audio.birth(); // something has just come into existence

    // a keepsake to screenshot/share, once the creator overlay has closed
    setTimeout(() => planetCard.show({ name, createdAt: createdAt || Date.now(), artworkCanvas: canvas, message, song }), 420);

    // let it sail away, then whisper where it went
    clearTimeout(toastTimer);
    setTimeout(() => {
      toast.querySelector('.toast-name').textContent = name;
      toast.querySelector('.toast-sub').textContent = wasNear
        ? 'now circling this sun'
        : 'now circling a distant sun';
      toast.classList.add('show');
      toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
    }, 2300);
    return { ok: true };
  },
});

// ---- one planet a day (soft, localStorage-only mirror of the server rule) ----
// A gentle "your world is out there" once this browser has made a planet
// TODAY. The server enforces one per network per day; this just saves a
// visitor from drawing a second one only to be told to come back tomorrow.
const createBtn = document.getElementById('create-btn');
const utcDay = (ts) => new Date(ts).toISOString().slice(0, 10);
function hasOwnPlanet() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return !!(saved && saved.v === 1 && saved.createdAt && utcDay(saved.createdAt) === utcDay(Date.now()));
  } catch { return false; }
}
function refreshCreationGate() {
  const planted = hasOwnPlanet();
  createBtn.classList.toggle('planted', planted);
  createBtn.textContent = planted ? 'your world is out there · another tomorrow' : 'make a planet';
}
refreshCreationGate();

createBtn.addEventListener('click', () => {
  if (travel.active || hasOwnPlanet()) return;
  focus.clear();
  creator.open();
});

// ---- the info sheet: opened only by choice, never blocks the universe ----
const info = createInfoSheet();
document.getElementById('info-btn').addEventListener('click', () => {
  if (info.isOpen()) info.close();
  else info.open();
});

// ---- idle mode: the UI recedes when you stop (the camera stays put) ----
let search = null; // the search panel is created after travel exists (below)
const ambient = new AmbientDirector({
  isBusy: () => creator.isOpen() || travel.active || !!focus.anim || (intro && intro.active) || info.isOpen() || (search && search.isOpen()) || (arrival && arrival.holds()),
  onEnter: () => {
    focus.clear();
    document.body.classList.add('ambient');
  },
  onExit: () => document.body.classList.remove('ambient'),
});

// ---- soundscape controls ----
const audioBtn = document.getElementById('audio-btn');
const audioVol = document.getElementById('audio-vol');
audioVol.value = Math.round(audio.pref.vol * 100);

function syncAudioUI() {
  audioBtn.classList.toggle('on', audio.enabled);
  audioBtn.title = audio.enabled ? 'sound off' : 'sound on';
}
audioBtn.addEventListener('click', () => {
  audio.enabled ? audio.disable() : audio.enable();
  syncAudioUI();
});
audioVol.addEventListener('input', () => audio.setVolume(Number(audioVol.value) / 100));
// remembered preference — browsers require a gesture before audio can start
if (audio.pref.on) {
  const arm = () => {
    audio.enable();
    syncAudioUI();
    window.removeEventListener('pointerdown', arm);
  };
  window.addEventListener('pointerdown', arm);
}
syncAudioUI();

// ---- interstellar travel for "find my planet" ----
const travel = new TravelDirector({ camera, controls, renderer, scene, env, focus, audio });

// ---- the arrival: what greets you at a planet that carries something ----
let arriveMode = 'click'; // 'link' for the flight that a planet's address starts
const arrival = createArrival({
  onMakeOne: () => {
    if (travel.active) return;
    if (hasOwnPlanet()) {
      clearTimeout(toastTimer);
      toast.querySelector('.toast-name').textContent = 'one planet a day';
      toast.querySelector('.toast-sub').textContent = 'yours is out there · make another tomorrow';
      toast.classList.add('show');
      toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
      return;
    }
    arrival.hide();
    focus.clear();
    creator.open();
  },
  onSongState: (state) => audio.duck(state === 'playing' || state === 'loading'),
});
focus.liftFor = (planet) => arriveMode === 'link' || !!(planet && (planet.song || planet.message));
focus.onArrive = (planet) => {
  arrival.show(planet, { mode: arriveMode });
  arriveMode = 'click';
};
focus.onLeave = () => arrival.hide();

// ---- jump to the nearest star: hop to a neighbouring system ----
// A meaningful interstellar distance so we never bounce between two adjacent
// suns. The universe places stars 2,600-18,000 apart, so ~1,500 comfortably
// excludes "you're basically already there" without excluding real neighbours.
const MIN_JUMP = 1500;
const recentStars = []; // ids of the last couple of stars we jumped from — never bounce back into a short cycle

// Choose the destination ONCE, at trigger time. The travel director then locks
// it for the whole journey — no "nearest star" is re-evaluated mid-flight, so
// the camera can never oscillate toward a star that drifts closer en route.
function chooseJumpTarget() {
  if (!env.stars.length) return null;
  const cam = camera.position;
  const facing = camera.getWorldDirection(new THREE.Vector3()).normalize();

  // the star we're essentially sitting in (if any) — never pick it
  const nearest = [...env.stars].sort(
    (a, b) => a.position.distanceTo(cam) - b.position.distanceTo(cam)
  )[0];
  const span = nearest.orbits.length ? Math.max(...nearest.orbits.map((o) => o.r)) : nearest.influence;
  const here = cam.distanceTo(nearest.position) < Math.max(nearest.influence, span * 1.8) ? nearest : null;

  // candidates: not the current star, not one of the last couple we visited,
  // and far enough to be a real journey. The exclusions guarantee we never
  // oscillate back and forth between the same few neighbours.
  const exclude = (s) => s === here || recentStars.includes(s.id);
  const usable = env.stars.filter((s) => !exclude(s) && cam.distanceTo(s.position) >= MIN_JUMP);
  let pool = usable;
  if (!pool.length) pool = env.stars.filter((s) => !exclude(s));                 // relax distance
  if (!pool.length) pool = env.stars.filter((s) => s !== here && s.id !== recentStars[recentStars.length - 1]); // keep only the immediate-previous exclusion
  if (!pool.length) pool = env.stars.filter((s) => s !== here);                  // last resort
  if (!pool.length) return null;

  const scored = pool.map((s) => {
    const to = s.position.clone().sub(cam);
    return { s, d: to.length(), align: to.normalize().dot(facing) };
  });
  // prefer the nearest star roughly in front of us; else just the nearest
  const forward = scored.filter((c) => c.align > 0.2).sort((a, b) => a.d - b.d);
  const chosen = (forward[0] || scored.sort((a, b) => a.d - b.d)[0]).s;

  // remember where we left from (keep the last 2, so cycles shorter than ~4 can't form)
  const leftFrom = here ? here.id : nearest.id;
  recentStars.push(leftFrom);
  while (recentStars.length > 2) recentStars.shift();
  return chosen;
}

document.getElementById('jump-btn').addEventListener('click', () => {
  if (travel.active || creator.isOpen()) return;
  const dest = chooseJumpTarget();
  if (!dest) return;
  focus.clear();
  // travel locks `dest` for the whole flight; short hops use the focus glide
  if (!travel.begin(null, dest)) focus.focusStar(dest);
});

// ---- search the universe: find any planet by name, then fly there ----
// Search runs on the server. In dev (no backend) it falls back to the loaded
// field so the panel is still usable. Selecting a result reuses the existing
// interstellar travel — you actually fly there, never teleport.
async function runSearch(q) {
  const { results } = await searchPlanets(q);
  if (results.length || import.meta.env.PROD) return { results };
  const key = normalizeNameKey(q);
  const local = field.planets
    .filter((p) => normalizeNameKey(p.name).includes(key))
    .slice(0, 8)
    .map((p) => ({ name: p.name, createdAt: p.createdAt, starId: p.solarSystemId }));
  return { results: local };
}

function travelToPlanet(planet) {
  const dist = camera.position.distanceTo(planet.position);
  if (dist < 800) { focus.focus(planet); return; }
  focus.clear();
  const destStar = env.getStar(planet.solarSystemId) ?? [...env.stars].sort(
    (a, b) => a.position.distanceTo(planet.position) - b.position.distanceTo(planet.position)
  )[0];
  if (!travel.begin(planet, destStar)) focus.focus(planet);
}

search = createSearch({
  query: runSearch,
  onSelect: (r) => {
    if (travel.active || creator.isOpen()) return;
    // the searched planet is (almost always) already loaded — fly to it
    const key = normalizeNameKey(r.name);
    const planet = field.planets.find((p) => normalizeNameKey(p.name) === key);
    if (planet) { travelToPlanet(planet); return; }
    // fallback: the planet isn't loaded here — fly to its star system
    const star = env.getStar(r.starId);
    if (star) { focus.clear(); if (!travel.begin(null, star)) focus.focusStar(star); }
  },
});
document.getElementById('search-btn').addEventListener('click', () => {
  if (travel.active) return;
  search.isOpen() ? search.close() : search.open();
});

// ---- click (not drag) to focus a planet ----
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downPos = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = [e.clientX, e.clientY];
  if (travel.active) travel.cancel(); // touch-friendly cancel, decelerates smoothly
  else focus.interrupt(); // grabbing mid-flight hands control back
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  if (travel.active) { downPos = null; return; }
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 6) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(field.raycastables(), false);
  if (hits.length) {
    focus.focus(hits[0].object.userData.planet);
    return;
  }
  // no planet? maybe a distant sun — click a light, cross the void
  const starHits = raycaster.intersectObjects(env.stars.map((s) => s.proxy), false);
  if (starHits.length) {
    const star = env.stars.find((s) => s.proxy === starHits[0].object);
    focus.focusStar(star);
  } else {
    focus.clear();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (travel.active) travel.cancel();
    else if (creator.isOpen()) creator.close();
    else focus.clear();
  }
});

// ---- the shared universe: planets other people have launched ----
// One fetch at boot; hidden planets never arrive (excluded server-side).
// In production, an unreachable backend shows the minimal unavailable state.
const universeStatus = document.getElementById('universe-status');
fetchSharedPlanets().then(async ({ planets: rows, stars: dynStars, unavailable }) => {
  if (unavailable) universeStatus.classList.add('show');
  // materialize any dynamically-minted stars before placing planets around them
  for (const s of (dynStars || [])) env.addDynamicStar(s);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* fine */ }
  for (const row of rows) {
    if (saved && saved.remoteId && row.id === saved.remoteId) { adoptMineRow(row); continue; } // mine spawns locally
    if (!row.artworkUrl) continue;
    const star = env.getStar(row.starId);
    try {
      const orbit = row.orbit && star ? {
        ...row.orbit,
        starId: row.starId,
        center: star.position.clone(),
      } : null;
      // planets store no absolute position (they orbit) — derive the spawn
      // point from the orbit; only fall back to a stored position for old rows
      const position = orbit
        ? orbitPosition(orbit, new THREE.Vector3())
        : (row.position && row.position.x != null
          ? new THREE.Vector3(row.position.x, row.position.y, row.position.z)
          : null);
      if (!position) continue;
      const canvas = await loadArtworkCanvas(row.artworkUrl);
      const sc = row.satelliteConfig || {};
      const spec = field.addUserPlanet({
        name: row.name,
        canvas,
        derived: {
          look: { atmo: sc.atmo || null, rings: sc.rings || null, moons: sc.moons || [] },
          type: row.surfaceType || 'soft',
          scale: row.scale || 2.4,
          rotationSpeed: row.rotationSpeed || 0.12,
          tilt: row.tilt || 0.25,
          emissive: 0x000000,
        },
        position,
        orbit,
        solarSystemId: row.starId,
        createdAt: Date.parse(row.createdAt),
      });
      spec.remoteId = row.id;
      spec.song = row.song || null;
      spec.message = row.message || null;
      if (orbit && star) {
        claimOrbitRadius(star, orbit.radius, orbitExtentOf(spec.scale, spec.look));
      }
    } catch { /* one bad row must not break the universe */ }
  }
  if (landing) landAt(landing);
}).catch(() => { if (landing) landAt(landing); });

// my planet's song title lives on the server (fetched at creation); the local
// copy predates it, so take it from the shared row once that arrives
function adoptMineRow(row) {
  const apply = () => {
    if (!myPlanet) return false;
    if (row.song) myPlanet.song = row.song;
    if (row.message && !myPlanet.message) myPlanet.message = row.message;
    return true;
  };
  if (apply()) return;
  let tries = 0;
  const iv = setInterval(() => { if (apply() || ++tries > 40) clearInterval(iv); }, 150);
}

// ---- fly a visitor to the planet whose address they opened ----
// The camera is placed well outside the planet's system first so the arrival
// is always a real flight: streaks, the sun resolving, orbit lines, then the
// planet itself and whatever was left on it.
function planetByKeys(keys) {
  return field.planets.find((p) => keys.includes(normalizeNameKey(p.name))) || null;
}
async function landAt({ slug, keys }) {
  // the visitor's own planet restores asynchronously; give it a moment
  let planet = planetByKeys(keys);
  for (let i = 0; !planet && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    planet = planetByKeys(keys);
  }
  if (!planet) {
    // not in the loaded field: gone (hidden/removed), never existed, or the
    // universe is unavailable. Say so quietly and leave the visitor in the sky.
    const looked = await fetchPlanetByName(nameFromSlug(slug));
    clearTimeout(toastTimer);
    toast.querySelector('.toast-name').textContent = looked.unavailable ? 'the universe is temporarily unavailable' : 'that world isn’t here';
    toast.querySelector('.toast-sub').textContent = looked.unavailable ? 'try the link again in a moment' : 'it may have drifted away · make one instead';
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 5200);
    if (!looked.unavailable) window.history.replaceState(null, '', '/');
    return;
  }
  if (travel.active || creator.isOpen()) return;
  window.history.replaceState(null, '', `/p/${slugForName(planet.name)}`);
  const star = env.getStar(planet.solarSystemId) ?? [...env.stars].sort(
    (a, b) => a.position.distanceTo(planet.position) - b.position.distanceTo(planet.position)
  )[0];
  focus.clear();
  if (star) {
    // approach from far out, from a side that keeps the sun off-axis
    const away = new THREE.Vector3(0.62, 0.28, 0.73).normalize();
    camera.position.copy(star.position).addScaledVector(away, 5200);
    controls.target.copy(star.position);
  }
  arriveMode = 'link';
  if (!star || !travel.begin(planet, star)) focus.focus(planet);
}

// dev-only diagnostic (fps / draw calls / tris) — never shown to real visitors
const perf = import.meta.env.DEV ? createPerfPanel({ renderer, field }) : { tick() {} };

// reporting: three DIFFERENT people reporting a planet removes it.
// The server derives the reporter identity; nothing personal is collected.
document.querySelector('#planet-label .label-report').addEventListener('click', async () => {
  const planet = focus.current;
  if (!planet) return;
  clearTimeout(toastTimer);
  if (planet.remoteId) {
    // a report only reads as successful once it is actually recorded
    const out = await reportPlanetRemote(planet.remoteId);
    if (out && out.ok) {
      toast.querySelector('.toast-name').textContent = 'reported';
      toast.querySelector('.toast-sub').textContent = 'thanks';
      if (out.hidden) {
        focus.clear();
        field.removePlanet(planet); // quietly gone — no celebration
      }
    } else {
      toast.querySelector('.toast-name').textContent = 'the universe is temporarily unavailable';
      toast.querySelector('.toast-sub').textContent = 'try again in a moment';
      if (out && out.unavailable) universeStatus.classList.add('show');
    }
  } else {
    // procedural worlds have nothing to record — the quiet ack is honest
    toast.querySelector('.toast-name').textContent = 'reported';
    toast.querySelector('.toast-sub').textContent = 'thanks';
  }
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
});

setTimeout(() => document.getElementById('hint').classList.add('faded'), 8000);

let elapsed = 0;
const clock = new THREE.Clock();
if (intro) intro.begin({ skip: !!landing });

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (intro) intro.update(dt);
  controls.update();
  ambient.update(dt);
  travel.update(dt);
  env.update(dt);
  field.update(dt, camera.position);
  focus.update(dt);
  audio.update(dt, {
    camera,
    suns: env.stars,
    regions: env.regions,
    activeEvent: env.activeEventName,
    eventPos: env.activeEventPos,
    planets: field.planets,
  });
  // the light itself breathes, on a minutes-long scale
  sun.intensity = 2.4 + 0.12 * Math.sin(elapsed * 0.011);
  renderer.render(scene, camera);
  perf.tick(dt);
});

// debug handle for testing in the console (harmless in a prototype)
window.__planets = { renderer, camera, controls, field, focus, creator, env, ambient, audio, travel, intro, info, search, planetCard, arrival, landAt };
