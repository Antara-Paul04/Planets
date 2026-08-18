import * as THREE from 'three';
import { createAtmosphereMaterial } from './atmosphere.js';
import { generatePlanetTexture, averageColor, mulberry32 } from './textures.js';
import { computeRegions } from './universe.js';
import { assignOrbit, orbitPosition, makeOrbitLine, releaseOrbit } from './stars.js';

// how far a planet's visuals reach beyond its center, in world units —
// used to keep neighboring orbits from ever visually touching
export function orbitExtentOf(scale, look) {
  let e = 1.3; // atmosphere shell headroom
  if (look.rings) e = Math.max(e, look.rings.outer);
  for (const m of look.moons || []) e = Math.max(e, m.dist + m.size);
  return scale * e;
}

// Planet visual system.
//
// A planet is plain data (spec) + a THREE.LOD object:
//   close  — textured sphere, atmosphere shell, rings, moons
//   medium — low-poly sphere (same material) + rings
//   far    — tiny flat-shaded sphere tinted the texture's average color
//
// Users control: drawing, surface type, atmosphere, vibe, name.
// The universe controls: rings, moons, aurora, placement, orbits.
//
// The "look" object is the normalized visual description:
//   { atmo: {color, intensity, shell}|null,
//     rings: {color, inner, outer, opacity}|null,
//     moons: [{size, dist, speed, phase}, ...] }

export const GEO_HI = new THREE.SphereGeometry(1, 28, 20);
export const GEO_MID = new THREE.SphereGeometry(1, 14, 10);
export const GEO_LOW = new THREE.SphereGeometry(1, 8, 6);

const TYPE_PARAMS = {
  soft:     { roughness: 0.9,  metalness: 0.0,  envMapIntensity: 0.15 },
  rocky:    { roughness: 1.0,  metalness: 0.0,  envMapIntensity: 0.1 },
  glassy:   { roughness: 0.18, metalness: 0.0,  envMapIntensity: 0.45 },
  matte:    { roughness: 1.0,  metalness: 0.0,  envMapIntensity: 0.0 },
  metallic: { roughness: 0.4,  metalness: 0.8,  envMapIntensity: 0.4 },
};

export function makeSurfaceMaterial(texture, type, emissive = 0x000000) {
  const p = TYPE_PARAMS[type] || TYPE_PARAMS.soft;
  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: p.roughness,
    metalness: p.metalness,
    envMapIntensity: p.envMapIntensity,
    emissive: new THREE.Color(emissive),
  });
}

// ---- shared caches (rings / moons / atmospheres) ----

// ring dims snap to 0.25 steps: visually identical, and the cache stays
// bounded (~50 geometries) instead of growing forever under stress tests
const ringGeoCache = new Map();
function ringGeo(innerRaw, outerRaw) {
  const inner = Math.round(innerRaw * 4) / 4;
  const outer = Math.max(inner + 0.25, Math.round(outerRaw * 4) / 4);
  const key = `${inner}:${outer}`;
  if (!ringGeoCache.has(key)) ringGeoCache.set(key, new THREE.RingGeometry(inner, outer, 48, 1));
  return ringGeoCache.get(key);
}

// banded, dusty ring material — concentric density variation and a gap,
// computed radially in the fragment shader (RingGeometry UVs are planar).
// One instance per ringed planet, shared by its hi/mid LOD levels.
function makeRingMaterial(color, opacity, inner, outer, seed) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uInner: { value: inner },
      uOuter: { value: outer },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uInner;
      uniform float uOuter;
      uniform float uSeed;
      varying vec2 vP;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float r = length(vP);
        float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
        // overlapping band frequencies, seeded per planet
        float bands = 0.6
          + 0.25 * sin(t * 47.0 + uSeed * 13.0)
          + 0.18 * sin(t * 23.0 + uSeed * 29.0)
          + 0.12 * sin(t * 91.0 + uSeed * 7.0);
        // fine dusty grain
        float grain = 0.8 + 0.35 * hash(floor(t * 150.0) + uSeed);
        // one clear division, like a tiny Cassini gap
        float gapPos = 0.3 + 0.4 * hash(uSeed + 3.0);
        float gap = 1.0 - 0.85 * smoothstep(0.05, 0.015, abs(t - gapPos));
        float edge = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t);
        vec3 col = uColor * (0.8 + 0.35 * clamp(bands, 0.0, 1.0));
        float a = uOpacity * edge * clamp(bands, 0.12, 1.0) * grain * gap;
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

const atmoMatCache = new Map();
function atmoMat(color, intensity) {
  const key = `${new THREE.Color(color).getHexString()}:${intensity.toFixed(2)}`;
  if (!atmoMatCache.has(key)) atmoMatCache.set(key, createAtmosphereMaterial(color, intensity));
  return atmoMatCache.get(key);
}

const MOON_MATS = [0xd8d2c4, 0xbfae9a, 0x9aa4b5].map(
  (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
);

const noRaycast = () => {};

// ---- builders ----

function moonsOf(look) {
  return normalizeLook(look).moons;
}

// Builds the full-detail visual (radius 1). Used for the close LOD level
// and for the creator preview, so what you preview is what launches.
export function buildPlanetVisual(material, look) {
  const group = new THREE.Group();
  const surface = new THREE.Mesh(GEO_HI, material);
  group.add(surface);
  const freeze = (o) => { o.updateMatrix(); o.matrixAutoUpdate = false; };
  freeze(surface);

  let atmoMesh = null;
  if (look.atmo) {
    atmoMesh = new THREE.Mesh(GEO_HI, atmoMat(look.atmo.color, look.atmo.intensity));
    atmoMesh.scale.setScalar(look.atmo.shell);
    atmoMesh.raycast = noRaycast;
    freeze(atmoMesh);
    group.add(atmoMesh);
  }
  let ringMaterial = null;
  if (normalizeLook(look).rings) {
    ringMaterial = makeRingMaterial(look.rings.color, look.rings.opacity, look.rings.inner, look.rings.outer, look.rings.seed || 1);
    const rings = new THREE.Mesh(ringGeo(look.rings.inner, look.rings.outer), ringMaterial);
    rings.rotation.x = Math.PI / 2;
    rings.raycast = noRaycast;
    freeze(rings);
    group.add(rings);
  }
  const moonPivots = [];
  for (const m of moonsOf(look)) {
    const pivot = new THREE.Group();
    pivot.rotation.y = m.phase || 0;
    pivot.rotation.x = m.incl || 0; // moons orbit in their own tilted planes
    pivot.userData.speed = m.speed;
    const moon = new THREE.Mesh(GEO_LOW, MOON_MATS[Math.floor((m.phase || 0) * 7) % MOON_MATS.length]);
    moon.scale.setScalar(m.size);
    moon.position.x = m.dist;
    moon.raycast = noRaycast;
    moon.updateMatrix();
    moon.matrixAutoUpdate = false; // the pivot rotates; the moon itself is fixed
    pivot.add(moon);
    group.add(pivot);
    moonPivots.push(pivot);
  }
  return { group, surface, moonPivots, atmoMesh, ringMaterial };
}

function buildMidVisual(material, look, ringMaterial) {
  const group = new THREE.Group();
  const surface = new THREE.Mesh(GEO_MID, material);
  group.add(surface);
  if (look.rings && ringMaterial) {
    const rings = new THREE.Mesh(ringGeo(look.rings.inner, look.rings.outer), ringMaterial);
    rings.rotation.x = Math.PI / 2;
    rings.raycast = noRaycast;
    group.add(rings);
  }
  return { group, surface };
}

// ---- what the universe decides for any new planet ----
// A planet has moons, OR rings, OR neither — never both. Enforced here at
// the data level and re-checked by normalizeLook for anything persisted.

const RING_COLORS = ['#e8c65c', '#e783a6', '#8fd07c', '#9db9ff', '#ef9c4e', '#c79bff', '#cabfae'];

function ringsFor(rand) {
  const outer = 1.7 + rand() * 1.2;
  return {
    color: RING_COLORS[Math.floor(rand() * RING_COLORS.length)],
    inner: outer - (0.3 + rand() * 0.8),
    outer,
    opacity: 0.25 + rand() * 0.45, // some barely there, none shouting
    seed: rand() * 100,
  };
}

function moonsFor(rand) {
  const moons = [];
  const count = rand() < 0.75 ? 1 : 2;
  for (let i = 0; i < count; i++) {
    moons.push({
      size: 0.12 + rand() * 0.13,
      dist: 2 + rand() * 1.3 + i * 0.9,
      speed: (0.25 + rand() * 0.55) * (rand() < 0.15 ? -1 : 1),
      phase: rand() * Math.PI * 2,
      incl: (rand() - 0.5) * 0.5, // moon orbits are 3D too
    });
  }
  return moons;
}

// most planets are ordinary: ~70% bare, ~20% moons, ~10% rings
function naturalSatellites(rand) {
  const roll = rand();
  if (roll < 0.7) return { rings: null, moons: [] };
  if (roll < 0.9) return { rings: null, moons: moonsFor(rand) };
  return { rings: ringsFor(rand), moons: [] };
}

// deterministic conflict resolution for anything persisted before the
// exclusivity rule existed: moons win, rings go
export function normalizeLook(look) {
  if (!look.moons) look.moons = look.moon ? [look.moon] : [];
  delete look.moon;
  if (look.rings && look.moons.length) look.rings = null;
  return look;
}

// ---- user planet derivation (creator config -> spec pieces) ----

const ATMO_MODES = {
  soft:     { intensity: 0.55, shell: 1.16 },
  thick:    { intensity: 1.1,  shell: 1.32 },
  colorful: { intensity: 0.85, shell: 1.22 },
};

export function deriveUserPlanet(config) {
  const rand = Math.random;
  const look = { atmo: null, ...naturalSatellites(rand) };

  if (config.atmo && config.atmo.mode !== 'none') {
    const m = ATMO_MODES[config.atmo.mode] || ATMO_MODES.soft;
    look.atmo = { color: config.atmo.color, intensity: m.intensity, shell: m.shell };
  }

  const derived = {
    look,
    type: config.type || 'soft',
    scale: 2.4,
    rotationSpeed: 0.12,
    tilt: 0.25,
    emissive: 0x000000,
    extraGap: 0,
    aurora: Math.random() < 0.12,
    vibe: config.vibe || null,
  };
  applyVibe(derived);
  return derived;
}

// small, legible nudges — the drawing stays the identity
function applyVibe(d) {
  const { look } = d;
  switch (d.vibe) {
    case 'weird':
      d.tilt = 1.2;
      d.rotationSpeed = -0.18;
      if (look.atmo) look.atmo.color = '#9dffb0';
      break;
    case 'peaceful':
      d.rotationSpeed = 0.05;
      if (look.atmo) look.atmo.intensity *= 0.85;
      break;
    case 'chaotic':
      d.rotationSpeed = 0.55;
      d.tilt = 0.9;
      for (const m of look.moons) m.speed *= 2.2;
      break;
    case 'tiny':
      d.scale = 1.1;
      if (look.atmo) { look.atmo.intensity *= 1.5; look.atmo.shell += 0.08; }
      break;
    case 'lonely':
      d.extraGap = 60 + Math.random() * 50; // the far, quiet edge of the system
      look.moons.length = 0;
      break;
    case 'hot':
      d.emissive = 0x38160a;
      if (look.atmo) { look.atmo.color = '#ffa261'; look.atmo.intensity *= 1.3; }
      break;
    case 'dreamy':
      d.rotationSpeed = 0.06;
      if (look.atmo) { look.atmo.color = '#f3c4ff'; look.atmo.shell += 0.06; }
      break;
    case 'mysterious':
      if (look.atmo) { look.atmo.color = '#8a63d2'; look.atmo.intensity *= 0.9; }
      d.aurora = d.aurora || Math.random() < 0.35;
      break;
    case 'silly':
      d.tilt = 1.35;
      if (!look.moons.length) {
        look.rings = null; // moons and rings are mutually exclusive
        look.moons.push({ size: 0.2, dist: 2.4, speed: 1.3, phase: 1, incl: 0.3 });
      }
      break;
  }
}

// ---- the field ----

const easeOutBack = (t) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const ATMO_COLORS = ['#8fb8ff', '#ffd2a1', '#c79bff', '#9fe8d1', '#ff9fb2', '#a1e3ff', '#ffe08a'];
const TYPE_KEYS = Object.keys(TYPE_PARAMS);

// the universe "began" well before launch — seeded worlds were born then
const UNIVERSE_DAWN = Date.UTC(2025, 5, 1);
const UNIVERSE_AGE = Date.UTC(2026, 6, 31) - UNIVERSE_DAWN;

const NAME_A = ['Ka', 'Velu', 'Ori', 'Mira', 'Sol', 'Nyra', 'Quel', 'Ari', 'Luma', 'Onde', 'Yara', 'Ishi', 'Tave', 'Ossa', 'Nix', 'Elo', 'Thali', 'Vesper', 'Duma', 'Rilo'];
const NAME_B = ['ra', 'nis', 'veth', 'mor', 'lia', 'dun', 'sae', 'rin', 'tho', 'mel', 'va', 'une', 'pel', 'dra', 'wen', 'os'];
function randomName(rand) {
  return NAME_A[Math.floor(rand() * NAME_A.length)] + NAME_B[Math.floor(rand() * NAME_B.length)];
}

export class PlanetField {
  constructor(scene, stars = []) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.planets = [];
    this.stars = stars;
    this.regions = computeRegions();
    this._nextId = 1;
    this._pool = []; // { material, farMaterial }
    this._auroras = [];
    this._time = 0;
    this._buildPools();
  }

  _buildPools() {
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 20; i++) {
      const canvas = generatePlanetTexture(rand);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      const type = TYPE_KEYS[Math.floor(rand() * TYPE_KEYS.length)];
      const material = makeSurfaceMaterial(tex, type);
      const farMaterial = new THREE.MeshLambertMaterial({ color: averageColor(canvas) });
      this._pool.push({ material, farMaterial });
    }
  }

  randomCount() {
    return this.planets.filter((p) => !p.isUser).length;
  }

  setRandomCount(n, rand) {
    const randoms = this.planets.filter((p) => !p.isUser);
    while (randoms.length > n) {
      const p = randoms.pop();
      this.group.remove(p.object);
      if (p.orbit && this.stars[p.orbit.starId]) {
        releaseOrbit(this.stars[p.orbit.starId], p.orbit, p.orbitLine);
      }
      if (p._aurora) {
        const ai = this._auroras.indexOf(p._aurora);
        if (ai >= 0) this._auroras.splice(ai, 1);
        p._aurora.mat.dispose();
      }
      if (p._ringMat) p._ringMat.dispose();
      this.planets.splice(this.planets.indexOf(p), 1);
    }
    let count = randoms.length;
    while (count < n) {
      this.addRandom(rand);
      count++;
    }
  }

  addRandom(rand) {
    const scale = (rand() < 0.07 ? 2 : 1) * (0.6 + Math.pow(rand(), 2) * 5);

    const look = { atmo: null, ...naturalSatellites(rand) };
    if (rand() < 0.68) {
      look.atmo = {
        color: ATMO_COLORS[Math.floor(rand() * ATMO_COLORS.length)],
        intensity: 0.3 + rand() * 0.45,
        shell: 1.12 + rand() * 0.12,
      };
    }

    // every planet belongs to a star system — the universe finds it an orbit
    // wide enough for everything the planet carries
    let position;
    let orbit = null;
    let solarSystemId = null;
    if (this.stars.length) {
      const star = this.stars[Math.floor(rand() * this.stars.length)];
      orbit = assignOrbit(star, rand, 0, orbitExtentOf(scale, look));
      solarSystemId = star.id;
      position = orbitPosition(orbit, new THREE.Vector3());
    } else {
      position = this.findSpot(scale, 1, rand);
    }

    const spec = {
      id: this._nextId++,
      name: randomName(rand),
      isUser: false,
      createdAt: UNIVERSE_DAWN + rand() * UNIVERSE_AGE,
      position,
      scale,
      look,
      orbit,
      solarSystemId,
      aurora: look.atmo ? rand() < 0.1 : false,
      rotationSpeed: (0.03 + rand() * 0.25) * (rand() < 0.5 ? -1 : 1),
      tilt: (rand() - 0.5) * 1.1,
    };
    const pooled = this._pool[Math.floor(rand() * this._pool.length)];
    return this._build(spec, pooled.material, pooled.farMaterial);
  }

  addUserPlanet({ name, canvas, derived, position, orbit = null, solarSystemId = null, travelFrom, createdAt }) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    const material = makeSurfaceMaterial(texture, derived.type, derived.emissive);
    const farMaterial = new THREE.MeshLambertMaterial({ color: averageColor(canvas) });

    const spec = {
      id: this._nextId++,
      name,
      isUser: true,
      createdAt: createdAt || Date.now(),
      position: position.clone(),
      orbit,
      solarSystemId,
      scale: derived.scale,
      look: normalizeLook(derived.look),
      aurora: !!derived.aurora && !!derived.look.atmo,
      rotationSpeed: derived.rotationSpeed,
      tilt: derived.tilt,
    };
    if (travelFrom) {
      const dur = Math.min(7, 2.2 + travelFrom.distanceTo(position) / 6000);
      spec.travel = { t: 0, dur, from: travelFrom.clone(), to: position.clone() };
      spec.spawn = { t: 0, dur: 0.9 };
    }
    return this._build(spec, material, farMaterial);
  }

  _build(spec, material, farMaterial) {
    const lod = new THREE.LOD();

    const hi = buildPlanetVisual(material, spec.look);
    hi.surface.userData.planet = spec;
    spec._ringMat = hi.ringMaterial;
    const mid = buildMidVisual(material, spec.look, hi.ringMaterial);
    mid.surface.userData.planet = spec;
    const far = new THREE.Mesh(GEO_LOW, farMaterial);
    far.userData.planet = spec;

    const f = Math.min(4, Math.max(1, spec.scale * 0.7));
    spec.cullDist2 = Math.pow(2000 * f, 2); // beyond this, stop animating entirely
    lod.addLevel(hi.group, 0);
    lod.addLevel(mid.group, 85 * f);
    lod.addLevel(far, 320 * f);
    lod.addLevel(new THREE.Object3D(), 1600 * f); // planets disappear long before their star does

    lod.position.copy(spec.travel ? spec.travel.from : spec.position);
    lod.scale.setScalar(spec.spawn ? 0.001 : spec.scale);
    lod.rotation.z = spec.tilt;
    lod.rotation.y = Math.random() * Math.PI * 2;

    this.group.add(lod);
    spec.object = lod;
    spec.surface = hi.surface;
    spec.moonPivots = hi.moonPivots;
    if (spec.orbit && this.stars[spec.orbit.starId]) {
      spec.orbitLine = makeOrbitLine(this.stars[spec.orbit.starId], spec.orbit);
    }
    this.planets.push(spec);

    // a few planets breathe: slow aurora-like shifts in their atmosphere
    if (spec.aurora && spec.look.atmo && hi.atmoMesh) {
      const own = createAtmosphereMaterial(spec.look.atmo.color, spec.look.atmo.intensity);
      hi.atmoMesh.material = own;
      spec._aurora = {
        mat: own,
        base: spec.look.atmo.intensity,
        c1: new THREE.Color(spec.look.atmo.color),
        c2: new THREE.Color(spec.look.atmo.color).offsetHSL(0.12, 0.05, 0.06),
        phase: Math.random() * Math.PI * 2,
      };
      this._auroras.push(spec._aurora);
    }
    return spec;
  }

  findSpot(scale, radiusMult = 1, rand = Math.random) {
    const pos = new THREE.Vector3();
    for (let tries = 0; tries < 50; tries++) {
      // denser near seeded regions, sparse elsewhere
      if (rand() < 0.6 && this.regions.length) {
        const reg = this.regions[Math.floor(rand() * this.regions.length)];
        const dir = new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.5, rand() * 2 - 1).normalize();
        pos.copy(reg.center).addScaledVector(dir, reg.radius * Math.pow(rand(), 0.6));
        pos.multiplyScalar(radiusMult);
      } else {
        const r = (40 + Math.pow(rand(), 1.45) * 540) * radiusMult;
        const theta = rand() * Math.PI * 2;
        const y = rand() * 2 - 1;
        const xz = Math.sqrt(Math.max(0, 1 - y * y));
        pos.set(Math.cos(theta) * xz, y * 0.42, Math.sin(theta) * xz).multiplyScalar(r);
      }
      let ok = pos.length() > 30;
      if (ok) {
        for (const p of this.planets) {
          if (pos.distanceTo(p.position) < (scale + p.scale) * 5) { ok = false; break; }
        }
      }
      if (ok) return pos.clone();
    }
    return pos.clone();
  }

  update(dt, cameraPos) {
    this._time += dt;
    for (const p of this.planets) {
      // planets far beyond visibility freeze completely: no rotation, no
      // orbit advance, no per-frame matrix recomposition
      const busy = p.travel || p.spawn;
      const far = !busy && cameraPos && p.object.position.distanceToSquared(cameraPos) > p.cullDist2;
      if (far !== !p.object.matrixAutoUpdate) {
        p.object.matrixAutoUpdate = !far;
        if (far) p.object.updateMatrix();
      }
      if (far) continue;
      p.object.rotation.y += p.rotationSpeed * dt;
      if (p.moonPivots) {
        for (const piv of p.moonPivots) piv.rotation.y += piv.userData.speed * dt;
      }
      if (p.orbit && !p.travel) {
        p.orbit.angle += p.orbit.speed * dt;
        orbitPosition(p.orbit, p.object.position);
        p.position.copy(p.object.position);
      }
      if (p.travel) {
        p.travel.t += dt / p.travel.dur;
        const t = Math.min(1, p.travel.t);
        p.object.position.lerpVectors(p.travel.from, p.travel.to, easeInOutCubic(t));
        if (t >= 1) delete p.travel;
      }
      if (p.spawn) {
        p.spawn.t += dt / p.spawn.dur;
        const t = Math.min(1, p.spawn.t);
        p.object.scale.setScalar(Math.max(0.001, p.scale * easeOutBack(t)));
        if (t >= 1) delete p.spawn;
      }
    }
    for (const a of this._auroras) {
      a.mat.uniforms.uIntensity.value = a.base * (0.8 + 0.3 * Math.sin(this._time * 0.35 + a.phase));
      a.mat.uniforms.uColor.value.lerpColors(a.c1, a.c2, 0.5 + 0.5 * Math.sin(this._time * 0.21 + a.phase));
    }
  }

  raycastables() {
    return this.planets.map((p) => p.surface);
  }
}
