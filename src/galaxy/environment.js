import * as THREE from 'three';
import { computeRegions, seededRand } from './universe.js';
import { buildStar, pickStarType, STAR_TYPES } from './stars.js';

// The procedural environment: people make planets, the universe makes the
// rest. Everything static here is seeded (same universe every visit);
// transient events (comets, meteors, flares) are timed randomly but rare.
// Nothing in this file is interactive on purpose.

// ---- shared sprite helpers ----

function makeGlowSprite(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [t, color] of stops) g.addColorStop(t, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const WHITE_GLOW_STOPS = [
  [0, 'rgba(255,255,255,1)'],
  [0.35, 'rgba(255,255,255,0.45)'],
  [1, 'rgba(255,255,255,0)'],
];

// star temperature palette — warm white / cool white / pale blue / pale
// yellow / whisper of pink. never neon.
function starColor(col, i, rand) {
  const b = 0.3 + rand() * 0.7;
  const t = rand();
  let r, g, bl;
  if (t < 0.3) { r = 1.0; g = 0.85; bl = 0.66; }        // warm
  else if (t < 0.55) { r = 0.96; g = 0.96; bl = 0.92; } // white
  else if (t < 0.8) { r = 0.7; g = 0.82; bl = 1.0; }    // pale blue
  else if (t < 0.93) { r = 1.0; g = 0.94; bl = 0.72; }  // pale yellow
  else { r = 1.0; g = 0.8; bl = 0.82; }                 // faint pink
  col[i * 3] = b * r;
  col[i * 3 + 1] = b * g;
  col[i * 3 + 2] = b * bl;
}

function starField(sprite, rand, count, rMin, rMax, size, opacity) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(rMin + rand() * (rMax - rMin));
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    starColor(col, i, rand);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size, sizeAttenuation: true, map: sprite, vertexColors: true,
    transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

// brighter stars get a gentle twinkle via a tiny points shader
function twinkleField(sprite, rand, count, rMin, rMax, baseSize) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const sizes = new Float32Array(count);
  const v = new THREE.Vector3();
  const positions = [];
  for (let i = 0; i < count; i++) {
    v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(rMin + rand() * (rMax - rMin));
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    positions.push(v.clone());
    starColor(col, i, rand);
    phase[i] = rand() * 40;
    sizes[i] = baseSize * (0.6 + rand() * (rand() < 0.06 ? 3.5 : 1.2)); // very rare large ones
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: sprite }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        float tw = 0.74 + 0.26 * sin(uTime * (0.5 + fract(aPhase) * 1.2) + aPhase * 19.0);
        vTw = tw;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * tw * (420.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor * vTw, t.a * vTw * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  return { points, mat, positions };
}

// ---- transient events ----

class Comet {
  constructor(scene, sprite, bright, origin) {
    this.scene = scene;
    const v = new THREE.Vector3().randomDirection();
    v.y *= 0.4;
    v.normalize().multiplyScalar(650);
    this.from = origin.clone().add(v);
    const side = new THREE.Vector3().randomDirection().multiplyScalar(120 + Math.random() * 160);
    this.to = origin.clone().sub(v).add(side);
    this.dur = bright ? 32 : 55;
    this.t = 0;
    this.group = new THREE.Group();
    this.mats = [];
    const dir = this.to.clone().sub(this.from).normalize();
    const headScale = bright ? 9 : 4.5;
    const tint = bright ? '#dff3ff' : '#cfe4ff';
    const n = 22;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sprite, color: tint, transparent: true,
        opacity: i === 0 ? 0.95 : 0.4 * (1 - i / n),
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      const k = i === 0 ? headScale : headScale * (0.85 - (i / n) * 0.6);
      s.scale.set(k, k, 1);
      s.position.copy(dir).multiplyScalar(-i * headScale * 0.55);
      this.mats.push({ mat, base: mat.opacity });
      this.group.add(s);
    }
    scene.add(this.group);
  }
  update(dt) {
    this.t += dt / this.dur;
    const t = Math.min(1, this.t);
    this.group.position.lerpVectors(this.from, this.to, t);
    const fade = Math.min(1, Math.min(t * 8, (1 - t) * 8));
    for (const m of this.mats) m.mat.opacity = m.base * fade;
    return this.t < 1;
  }
  dispose() {
    this.scene.remove(this.group);
    for (const m of this.mats) m.mat.dispose();
  }
}

class MeteorShower {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.dir = new THREE.Vector3().randomDirection();
    this.left = 6 + Math.floor(Math.random() * 6);
    this.timer = 0.1;
    this.meteors = [];
  }
  _spawn() {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const origin = this.camera.position.clone()
      .addScaledVector(fwd, 90)
      .add(new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 60));
    const len = 9 + Math.random() * 9;
    const geo = new THREE.BufferGeometry().setFromPoints([
      origin.clone(),
      origin.clone().addScaledVector(this.dir, len),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xfff3dd, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.meteors.push({ line, mat, geo, life: 0, dur: 1 + Math.random() * 0.8, speed: 55 + Math.random() * 35 });
  }
  update(dt) {
    if (this.left > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this._spawn();
        this.left--;
        this.timer = 0.4 + Math.random() * 0.9;
      }
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.life += dt;
      const k = m.life / m.dur;
      m.line.position.addScaledVector(this.dir, m.speed * dt);
      m.mat.opacity = 0.7 * Math.min(1, Math.min(k * 6, (1 - k) * 3));
      if (k >= 1) {
        this.scene.remove(m.line);
        m.mat.dispose();
        m.geo.dispose();
        this.meteors.splice(i, 1);
      }
    }
    return this.left > 0 || this.meteors.length > 0;
  }
  dispose() {
    for (const m of this.meteors) {
      this.scene.remove(m.line);
      m.mat.dispose();
      m.geo.dispose();
    }
    this.meteors.length = 0;
  }
}

class StarFlare {
  constructor(stars, camera) {
    const nearest = [...stars].sort(
      (a, b) => a.position.distanceToSquared(camera.position) - b.position.distanceToSquared(camera.position)
    ).slice(0, 4);
    this.star = nearest[Math.floor(Math.random() * nearest.length)];
    this.dur = 9;
    this.t = 0;
    this._baseGlow = this.star ? this.star.glow.scale.x : 1;
  }
  update(dt) {
    if (!this.star) return false;
    this.t += dt / this.dur;
    const t = Math.min(1, this.t);
    const pulse = Math.sin(t * Math.PI);
    this.star.coronaMat.uniforms.uIntensity.value = 1.15 + pulse * 1.1;
    this.star.glow.scale.setScalar(this._baseGlow * (1 + pulse * 0.35));
    return this.t < 1;
  }
  dispose() {
    if (!this.star) return;
    this.star.coronaMat.uniforms.uIntensity.value = 1.15;
    this.star.glow.scale.setScalar(this._baseGlow);
  }
}

class Flare {
  constructor(scene, sprite, starPositions) {
    this.scene = scene;
    this.dur = 7;
    this.t = 0;
    const pos = starPositions[Math.floor(Math.random() * starPositions.length)];
    this.mat = new THREE.SpriteMaterial({
      map: sprite, color: '#ffefd8', transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.position.copy(pos);
    this.base = 30 + Math.random() * 30;
    scene.add(this.sprite);
  }
  update(dt) {
    this.t += dt / this.dur;
    const t = Math.min(1, this.t);
    const pulse = Math.sin(t * Math.PI);
    this.mat.opacity = 0.55 * pulse;
    const s = this.base * (0.5 + pulse);
    this.sprite.scale.set(s, s, 1);
    return this.t < 1;
  }
  dispose() {
    this.scene.remove(this.sprite);
    this.mat.dispose();
  }
}

// ---- the environment ----

const NEBULA_HUES = [
  [275, 320], // muted violet into magenta
  [222, 250], // deep blue
  [340, 20],  // dusty pink
  [28, 45],   // warm orange
  [178, 200], // muted teal
];

export class Environment {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.time = 0;
    this.regions = computeRegions();
    this.stars = [];
    this.suns = this.stars; // legacy alias (audio, older callers)
    this._clusters = [];
    this._active = null;
    this.activeEventName = null;
    this.activeEventPos = null;
    this.skyDim = 1;
    this._nebulae = [];
    this._cooldown = 30 + Math.random() * 60;
    this._sprite = makeGlowSprite(WHITE_GLOW_STOPS);

    // the decorative sky is unreachable scenery — it travels with the camera.
    // the near layer follows with a lag, so motion produces real parallax.
    this.sky = new THREE.Group();
    scene.add(this.sky);
    this.skyNear = new THREE.Group();
    scene.add(this.skyNear);

    const rand = seededRand(0x51a2);
    this._buildBackgroundStars(rand);
    this._buildStars(rand);
    this._buildNebulae(rand);
    this._buildAsteroids(rand);
    this._buildMotes(rand);
    this._buildDeepDust();
  }

  _buildBackgroundStars(rand) {
    this.sky.add(starField(this._sprite, rand, 2100, 900, 3200, 6.5, 0.85)); // the sky
    this.skyNear.add(starField(this._sprite, rand, 1500, 250, 1500, 2.4, 0.6)); // near dust, parallaxes
    const tw = twinkleField(this._sprite, rand, 160, 700, 2600, 14);
    this._twinkle = tw;
    this.sky.add(tw.points);
  }

  // the star's far-distance glow sprite (pure; no PRNG)
  _starGlow(a, b) {
    const hexA = (hex, alpha) => {
      const c = new THREE.Color(hex);
      return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
    };
    return makeGlowSprite([
      [0, 'rgba(255,255,255,0.9)'],
      [0.16, hexA(a, 0.5)],
      [0.5, hexA(b, 0.12)],
      [1, 'rgba(0,0,0,0)'],
    ]);
  }

  _addStarToScene(star) {
    this.scene.add(star.object);
    this.scene.add(star.glow);
    this.scene.add(star.orbitGroup);
    this.scene.add(star.proxy);
    this.stars.push(star);
    return star;
  }

  // look up any star by id (deterministic index or dynamic id)
  getStar(id) {
    return this.stars.find((s) => s.id === id) || null;
  }

  // a star minted server-side because every existing star was full; rendered
  // from its persisted data, added to the live universe. Positions are stable
  // (derived deterministically in the DB from the star id).
  addDynamicStar(d) {
    const existing = this.getStar(d.id);
    if (existing) return existing;
    const type = STAR_TYPES[d.type] ? d.type : 'yellow';
    const [rMin, rMax] = STAR_TYPES[type].radius;
    const star = buildStar({
      id: d.id,
      position: new THREE.Vector3(d.x, d.y, d.z),
      type,
      radius: Number.isFinite(d.radius) ? d.radius : (rMin + rMax) / 2,
      seed: Number.isFinite(d.seed) ? d.seed : 0,
      plane: { incl: d.plane_incl || 0, node: d.plane_node || 0 },
      glowSprite: (a, b) => this._starGlow(a, b),
    });
    return this._addStarToScene(star);
  }

  _buildStars(rand) {
    const glowSprite = (a, b) => this._starGlow(a, b);

    const n = 8 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      let pos = null;
      for (let tries = 0; tries < 40 && !pos; tries++) {
        let candidate;
        if (rand() < 0.65) {
          // clustered in a region — neighbors, but still thousands apart
          const reg = this.regions[Math.floor(rand() * this.regions.length)];
          candidate = reg.center.clone().add(
            new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.4, rand() * 2 - 1)
              .multiplyScalar(reg.radius * Math.pow(rand(), 0.7))
          );
        } else {
          // or utterly alone out in the dark
          candidate = new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.35, rand() * 2 - 1)
            .normalize().multiplyScalar(3000 + rand() * 42000);
        }
        if (this.stars.every((s) => s.position.distanceTo(candidate) > 2500)) pos = candidate;
      }
      if (!pos) continue;
      const type = pickStarType(rand);
      const [rMin, rMax] = STAR_TYPES[type].radius;
      const star = buildStar({
        id: this.stars.length,
        position: pos,
        type,
        radius: rMin + rand() * (rMax - rMin),
        seed: rand() * 100,
        plane: { incl: (rand() - 0.5) * 0.7, node: rand() * Math.PI * 2 },
        glowSprite,
      });
      this._addStarToScene(star);
    }

    this._buildBeacons();

    // two shared point lights follow the nearest stars, so approaching a
    // system means its planets are actually lit by its sun
    this._starLights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      this.scene.add(l);
      return l;
    });
  }

  // one Points cloud holding a bright dot per major star: clamped to a
  // minimum pixel size so a solar system never disappears entirely, faded
  // out up close where the real star takes over. From interstellar space,
  // a whole system is just... a star.
  _buildBeacons() {
    const n = this.stars.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const c = new THREE.Color();
    this.stars.forEach((s, i) => {
      pos[i * 3] = s.position.x;
      pos[i * 3 + 1] = s.position.y;
      pos[i * 3 + 2] = s.position.z;
      c.copy(s.lightColor);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = s.radius * 2.6;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this._sprite } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          float px = clamp(aSize * (500.0 / d), 5.0, 34.0);
          vA = smoothstep(600.0, 1600.0, d);
          vColor = aColor;
          gl_PointSize = px;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vA;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * 1.6, t.a * vA);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  _buildNebulae(rand) {
    // R2: a couple of these are re-anchored into true world space at real
    // density-region centres so approaching a region's colour means approaching
    // an actual place (parallax, growing scale), not a camera-pinned wash. The
    // world jitter draws from its OWN salt so the shared chain — and every
    // star / asteroid / mote seeded after this — stays byte-identical.
    const worldRand = seededRand(0x9b3c);
    NEBULA_HUES.forEach(([h1, h2], i) => {
      const tex = makeGlowSprite([
        [0, `hsla(${h1}, 55%, 58%, 0.42)`],
        [0.45, `hsla(${h2}, 50%, 46%, 0.18)`],
        [1, 'hsla(0, 0%, 0%, 0)'],
      ]);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true,
        opacity: 0.07 + rand() * 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      // shared-chain rand() calls below are preserved verbatim (same count, same
      // order) so nothing downstream shifts; world nebulae override the result.
      let dir;
      if (i < this.regions.length && rand() < 0.6) dir = this.regions[i].center.clone().normalize();
      else { dir = new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.5, rand() * 2 - 1).normalize(); }
      sprite.position.copy(dir.multiplyScalar(1900 + rand() * 900));
      const s = 1000 + rand() * 900;
      sprite.scale.set(s, s * (0.55 + rand() * 0.5), 1);
      sprite.userData.baseOpacity = mat.opacity;
      sprite.userData.phase = rand() * Math.PI * 2;

      if (i < 3 && i < this.regions.length) {
        // anchor into world space near a real region centre — a distant
        // landmark, deliberately NOT a screen-filling cloud
        const reg = this.regions[i];
        const off = new THREE.Vector3(worldRand() * 2 - 1, (worldRand() * 2 - 1) * 0.4, worldRand() * 2 - 1)
          .multiplyScalar(reg.radius * 0.35);
        sprite.position.copy(reg.center).add(off);
        const ws = 2400 + worldRand() * 1800;
        sprite.scale.set(ws, ws * (0.62 + worldRand() * 0.28), 1);
        sprite.userData.world = true;
        this.scene.add(sprite);
      } else {
        // the rest stay camera-pinned as far, unreachable wallpaper
        this.sky.add(sprite);
      }
      this._nebulae.push(sprite);
    });
  }

  _buildAsteroids(rand) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8477, roughness: 1, flatShading: true });
    const clusters = 4 + Math.floor(rand() * 2);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let c = 0; c < clusters; c++) {
      let center;
      if (this.stars.length) {
        const star = this.stars[Math.floor(rand() * this.stars.length)];
        center = star.position.clone().add(
          new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.4, rand() * 2 - 1)
            .normalize().multiplyScalar(190 + rand() * 260) // the system's outskirts
        );
      } else {
        center = new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.35, rand() * 2 - 1).normalize().multiplyScalar(150 + rand() * 350);
      }
      const count = 12 + Math.floor(rand() * 22);
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      for (let i = 0; i < count; i++) {
        const off = new THREE.Vector3(rand() * 2 - 1, (rand() * 2 - 1) * 0.5, rand() * 2 - 1).multiplyScalar(14 + rand() * 34);
        e.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
        q.setFromEuler(e);
        const base = rand() < 0.12 ? 0.9 + rand() * 0.9 : 0.12 + rand() * 0.5;
        m4.compose(off, q, new THREE.Vector3(base * (0.6 + rand() * 0.8), base * (0.6 + rand() * 0.8), base * (0.6 + rand() * 0.8)));
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      const group = new THREE.Group();
      group.position.copy(center);
      group.add(mesh);
      group.userData.spin = (rand() - 0.5) * 0.02;
      this.scene.add(group);
      this._clusters.push(group);
    }
  }

  _buildMotes(rand) {
    this._motes = starField(this._sprite, rand, 240, 50, 260, 1.6, 0.45);
    this.skyNear.add(this._motes);
  }

  // R1: one world-fixed deep-space dust layer. Unlike the sky / skyNear groups
  // (which re-centre on the camera every frame and can never be approached),
  // these points live in TRUE world space and are never moved — so crossing the
  // void makes them drift and slide past: the one real depth cue between
  // systems. Biased to the density regions and to lanes between neighbouring
  // stars; the space in between stays deliberately empty. One shared Points =
  // one draw call. Its own seed salt, so it can never shift any existing object.
  _buildDeepDust() {
    const rand = seededRand(0x0d05);
    const COUNT = 8000;
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT);
    const v = new THREE.Vector3();
    const regions = this.regions;

    // seeded lanes: neighbouring stars close enough to string faint dust between
    const lanes = [];
    for (let a = 0; a < this.stars.length; a++) {
      for (let b = a + 1; b < this.stars.length; b++) {
        if (this.stars[a].position.distanceTo(this.stars[b].position) < 6500) {
          lanes.push([this.stars[a].position, this.stars[b].position]);
        }
      }
    }

    const put = (i, p) => {
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      // muted white / grey, a whisper of temperature — far dimmer than any star
      const b = 0.32 + rand() * 0.33;
      const t = rand();
      let r = 1, g = 1, bl = 1;
      if (t < 0.5) { r = 0.9; g = 0.93; bl = 1.0; }         // cool white
      else if (t < 0.85) { r = 0.96; g = 0.96; bl = 0.95; } // neutral grey
      else { r = 1.0; g = 0.95; bl = 0.88; }                // faint warm
      col[i * 3] = b * r; col[i * 3 + 1] = b * g; col[i * 3 + 2] = b * bl;
      size[i] = 0.8 + rand() * 1.6;
    };

    for (let i = 0; i < COUNT; i++) {
      const roll = rand();
      if (roll < 0.68 && regions.length) {
        // soft, disc-flattened fill concentrated toward a region centre
        const reg = regions[Math.floor(rand() * regions.length)];
        v.set(rand() * 2 - 1, (rand() * 2 - 1) * 0.45, rand() * 2 - 1)
          .normalize()
          .multiplyScalar(reg.radius * Math.pow(rand(), 0.55))
          .add(reg.center);
        put(i, v);
      } else if (roll < 0.93 && lanes.length) {
        // dust strung along a lane between two neighbouring systems
        const [pa, pb] = lanes[Math.floor(rand() * lanes.length)];
        v.lerpVectors(pa, pb, rand());
        v.x += (rand() * 2 - 1) * 600;
        v.y += (rand() * 2 - 1) * 320;
        v.z += (rand() * 2 - 1) * 600;
        put(i, v);
      } else if (regions.length) {
        // a few faint satellites just outside a region — softens the edge,
        // still leaves genuine interstellar gaps empty
        const reg = regions[Math.floor(rand() * regions.length)];
        v.set(rand() * 2 - 1, (rand() * 2 - 1) * 0.4, rand() * 2 - 1)
          .normalize()
          .multiplyScalar(reg.radius * (1.05 + rand() * 0.6))
          .add(reg.center);
        put(i, v);
      } else {
        v.set(rand() * 2 - 1, (rand() * 2 - 1) * 0.4, rand() * 2 - 1)
          .normalize().multiplyScalar(4000 + rand() * 8000);
        put(i, v);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this._sprite } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          // distant -> almost invisible, easing up smoothly as you approach.
          // no hard pop-in, no fog: just per-point fade with view depth.
          vA = 1.0 - smoothstep(9000.0, 30000.0, d);
          vColor = aColor;
          gl_PointSize = clamp(aSize * (780.0 / d), 0.6, 2.6);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vA;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vA * 0.6);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false; // one world-spanning cloud; never cull it whole
    this._deepDust = points;
    this.scene.add(points);
  }

  // rare-event director: one thing at a time, long quiet stretches between
  _startEvent() {
    const roll = Math.random();
    if (roll < 0.42) { this._active = new Comet(this.scene, this._sprite, false, this.camera.position); this.activeEventName = 'comet'; }
    else if (roll < 0.72) { this._active = new MeteorShower(this.scene, this.camera); this.activeEventName = 'meteors'; }
    else if (roll < 0.94) { this._active = new StarFlare(this.stars, this.camera); this.activeEventName = 'flare'; this.activeEventPos = this._active.star ? this._active.star.position : null; }
    else { this._active = new Comet(this.scene, this._sprite, true, this.camera.position); this.activeEventName = 'comet'; }
  }

  trigger(name) {
    if (this._active) { this._active.dispose(); this._active = null; }
    if (name === 'comet') this._active = new Comet(this.scene, this._sprite, false, this.camera.position);
    if (name === 'brightComet') this._active = new Comet(this.scene, this._sprite, true, this.camera.position);
    if (name === 'meteors') this._active = new MeteorShower(this.scene, this.camera);
    if (name === 'flare') this._active = new StarFlare(this.stars, this.camera);
    this.activeEventName = name === 'brightComet' ? 'comet' : name;
  }

  update(dt) {
    this.time += dt;
    this.sky.position.copy(this.camera.position);
    this.skyNear.position.lerp(this.camera.position, 1 - Math.exp(-dt * 1.6));
    this._twinkle.mat.uniforms.uTime.value = this.time;
    const k = 1 - Math.exp(-dt * 3);
    for (const s of this.stars) {
      s.surfaceMat.uniforms.uTime.value = this.time;
      // orbit paths: invisible from afar, faint at range, clear when visiting
      const d = s.position.distanceTo(this.camera.position);
      const fade = 1 - Math.min(1, Math.max(0, (d - s.influence * 1.3) / (s.influence * 2.2)));
      s.orbitMat.opacity += (0.16 * fade - s.orbitMat.opacity) * k;
      s.orbitGroup.visible = s.orbitMat.opacity > 0.005;
    }
    this._lightAcc = (this._lightAcc || 0) + dt;
    if (this._lightAcc > 0.5 && this.stars.length) {
      this._lightAcc = 0;
      const sorted = [...this.stars].sort((a, b) =>
        a.position.distanceToSquared(this.camera.position) - b.position.distanceToSquared(this.camera.position));
      this._starLights.forEach((light, i) => {
        const s = sorted[i];
        if (!s) { light.intensity = 0; return; }
        light.position.copy(s.position);
        light.color.copy(s.lightColor);
        light.distance = s.influence * 2.4;
        light.decay = 2;
        light.intensity = 5 * s.radius * s.radius;
      });
    }
    this._motes.rotation.y += dt * 0.004;
    for (const n of this._nebulae) {
      const breathe = 0.8 + 0.2 * Math.sin(this.time * 0.006 + n.userData.phase);
      if (n.userData.world) {
        // world-anchored: fade in as you approach, and stay visible during
        // travel (approaching a region is exactly when you want to see it)
        const d = n.position.distanceTo(this.camera.position);
        const vis = 1 - THREE.MathUtils.smoothstep(d, 16000, 46000);
        n.material.opacity = n.userData.baseOpacity * breathe * vis;
      } else {
        n.material.opacity = n.userData.baseOpacity * breathe * (this.skyDim ?? 1);
      }
    }
    for (const c of this._clusters) c.rotation.y += c.userData.spin * dt;

    if (this._active) {
      if (!this._active.update(dt)) {
        this._active.dispose();
        this._active = null;
        this.activeEventName = null;
        this.activeEventPos = null;
        this._cooldown = 100 + Math.random() * 200;
      }
    } else {
      this._cooldown -= dt;
      if (this._cooldown <= 0) this._startEvent();
    }
  }
}
