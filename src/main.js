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
import { createPlanetRemote, fetchSharedPlanets, reportPlanetRemote, loadArtworkCanvas } from './backend/client.js';
import { assignOrbit, orbitPosition, claimOrbitRadius } from './galaxy/stars.js';
import { Soundscape } from './audio.js';

const STORAGE_KEY = 'planets.myPlanet.v1';

const { renderer, scene, camera, controls, sun } = createScene(document.getElementById('app'));

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

const creator = createCreator({
  onPreview: () => audio.tick(),
  async onLaunch({ name, canvas, derived }) {
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
    const remote = await createPlanetRemote({ clientRef, name, canvas, candidates, extent, derived });
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
    saveMyPlanet(myPlanet, canvas, derived);
    findBtn.classList.remove('gone');
    refreshCreationGate(); // this browser has planted its one world
    audio.birth(); // something has just come into existence

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

// ---- one planet per browser (soft, localStorage-only) ----
// A gentle "you've already planted one" once this browser has a planet. No
// server enforcement, no IP, no device id — clearing storage or a new browser
// lets you plant again. It just keeps a single visitor from filling the sky.
const createBtn = document.getElementById('create-btn');
function hasOwnPlanet() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return !!(saved && saved.v === 1);
  } catch { return false; }
}
function refreshCreationGate() {
  const planted = hasOwnPlanet();
  createBtn.classList.toggle('planted', planted);
  createBtn.textContent = planted ? "you've already planted one" : 'make a planet';
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
const ambient = new AmbientDirector({
  isBusy: () => creator.isOpen() || travel.active || (intro && intro.active) || info.isOpen(),
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
    if (saved && saved.remoteId && row.id === saved.remoteId) continue; // mine spawns locally
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
      if (orbit && star) {
        claimOrbitRadius(star, orbit.radius, orbitExtentOf(spec.scale, spec.look));
      }
    } catch { /* one bad row must not break the universe */ }
  }
}).catch(() => { /* degraded: procedural universe still works */ });

const perf = createPerfPanel({ renderer, field });

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
if (intro) intro.begin();

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
window.__planets = { renderer, camera, controls, field, focus, creator, env, ambient, audio, travel, intro, info };
