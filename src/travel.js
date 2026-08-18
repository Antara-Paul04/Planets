import * as THREE from 'three';

// Interstellar travel for "find my planet": the camera physically crosses
// the void. No cockpit, no tunnel — the stars you were looking at stretch
// into streaks because *you* are moving, then the destination resolves the
// same way any system does: beacon → star → orbits → planets → your planet.
//
// Phases: orient (turn toward the destination, pull back a touch)
//       → cruise  (quintic ease along a slightly-arced path; streaks track
//                  actual camera speed, so acceleration and deceleration
//                  read naturally)
//       → settle  (streaks fade, sky restores, hand off to the normal
//                  planet-focus flight)
// Escape cancels: the camera decelerates smoothly and control returns.

const AXIS = 2600; // length of the streak field's scrolling corridor

function makeStreakField() {
  const N = 420;
  const theta = new Float32Array(N * 2);
  const radial = new Float32Array(N * 2);
  const offset = new Float32Array(N * 2);
  const len = new Float32Array(N * 2);
  const head = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const t = Math.random() * Math.PI * 2;
    const r = 60 + Math.pow(Math.random(), 0.7) * 850;
    const o = Math.random();
    const l = 0.45 + Math.random() * 1.1;
    for (const j of [0, 1]) {
      theta[i * 2 + j] = t;
      radial[i * 2 + j] = r;
      offset[i * 2 + j] = o;
      len[i * 2 + j] = l;
      head[i * 2 + j] = j;
    }
  }
  const geo = new THREE.BufferGeometry();
  // positions are computed in the shader; this attribute only sizes the draw
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  geo.setAttribute('aTheta', new THREE.BufferAttribute(theta, 1));
  geo.setAttribute('aRadial', new THREE.BufferAttribute(radial, 1));
  geo.setAttribute('aOffset', new THREE.BufferAttribute(offset, 1));
  geo.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
  geo.setAttribute('aHead', new THREE.BufferAttribute(head, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDir: { value: new THREE.Vector3(0, 0, -1) },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uScroll: { value: 0 },
      uStreak: { value: 0 },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uDir;
      uniform vec3 uRight;
      uniform vec3 uUp;
      uniform float uScroll;
      uniform float uStreak;
      attribute float aTheta;
      attribute float aRadial;
      attribute float aOffset;
      attribute float aLen;
      attribute float aHead;
      varying float vHead;
      varying float vFade;
      void main() {
        vHead = aHead;
        vec3 lateral = (cos(aTheta) * uRight + sin(aTheta) * uUp) * aRadial;
        float z = mod(aOffset * ${AXIS}.0 + uScroll, ${AXIS}.0) - ${AXIS}.0 * 0.5;
        // the streak trails toward where the star just was (ahead of us)
        vec3 p = uDir * z + lateral + uDir * (aHead * uStreak * aLen);
        vFade = smoothstep(0.0, 180.0, ${AXIS}.0 * 0.5 - abs(z));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vHead;
      varying float vFade;
      void main() {
        float a = uOpacity * vFade * mix(1.0, 0.1, vHead);
        gl_FragColor = vec4(0.82, 0.85, 1.0, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  return lines;
}

const cubicInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export class TravelDirector {
  constructor({ camera, controls, renderer, scene, env, focus, audio }) {
    this.camera = camera;
    this.controls = controls;
    this.renderer = renderer;
    this.env = env;
    this.focus = focus;
    this.audio = audio;

    this.phase = null; // null | 'orient' | 'cruise' | 'cancel' | 'settle'
    this._planet = null;
    this._t = 0;
    this._dur = 0;
    this._p0 = new THREE.Vector3();
    this._p1 = new THREE.Vector3();
    this._p2 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._prevPos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._v = 0;
    this._vPeak = 1;
    this._k = 0;
    this._settleT = 0;
    this._handoff = false;
    this._baseExposure = renderer.toneMappingExposure;
    this._baseFov = camera.fov;
    this._skyMats = null;

    this.streaks = makeStreakField();
    this.streaks.visible = false;
    scene.add(this.streaks);
  }

  get active() {
    return this.phase !== null;
  }

  // returns false when the actual journey is too short to deserve the
  // spectacle — the caller should fall back to the plain focus flight.
  // planet may be null: then the journey ends framing the star's system.
  begin(planet, destStar) {
    if (this.phase) return true;

    // approach point: just outside the destination system, on our side of it
    const span = destStar.orbits.length
      ? Math.max(...destStar.orbits.map((o) => o.r)) * 1.9
      : destStar.influence * 1.4;
    const toUs = this._tmp.copy(this.camera.position).sub(destStar.position).normalize();
    this._p2.copy(destStar.position).addScaledVector(toUs, span);
    this._p2.y += span * 0.12;

    this._p0.copy(this.camera.position);
    const dist = this._p0.distanceTo(this._p2);
    if (dist < 600) return false;

    this._planet = planet;
    this._destStar = destStar;
    this.controls.enabled = false;
    this._dir.copy(this._p2).sub(this._p0).normalize();

    // a slight arc so the journey curves instead of railing
    const up = Math.abs(this._dir.y) > 0.9 ? this._tmp2.set(1, 0, 0) : this._tmp2.set(0, 1, 0);
    const perp = new THREE.Vector3().crossVectors(this._dir, up).normalize();
    this._p1.copy(this._p0).add(this._p2).multiplyScalar(0.5)
      .addScaledVector(perp, Math.min(600, dist * 0.05))
      .addScaledVector(up, Math.min(300, dist * 0.025));

    this._dur = Math.min(8.5, Math.max(3.8, 3.2 + dist / 9000));
    this._vPeak = (1.5 * dist) / this._dur; // easeInOutCubic max slope
    this._t = 0;
    this._v = 0;
    this._k = 0;
    this._handoff = false;
    this._prevPos.copy(this._p0);
    this.phase = 'orient';

    // dim the decorative sky so the streaks own the frame at speed.
    // Points use .opacity; the twinkle shader exposes uOpacity; nebulae are
    // animated by env.update, so they dim through env.skyDim instead.
    this._skyMats = [];
    for (const g of [this.env.sky, this.env.skyNear]) {
      if (!g) continue;
      g.traverse((o) => {
        if (!o.material || o.isSprite) return;
        const m = o.material;
        if (m.isShaderMaterial && m.uniforms && m.uniforms.uOpacity) {
          this._skyMats.push({ set: (v) => { m.uniforms.uOpacity.value = v; }, get: () => m.uniforms.uOpacity.value, base: m.uniforms.uOpacity.value });
        } else if (!m.isShaderMaterial && m.opacity !== undefined) {
          this._skyMats.push({ set: (v) => { m.opacity = v; }, get: () => m.opacity, base: m.opacity });
        }
      });
    }

    if (this.audio) this.audio.travelStart();
    return true;
  }

  cancel() {
    if (this.phase === 'orient') {
      this._endNow(false);
      return;
    }
    if (this.phase === 'cruise') this.phase = 'cancel';
    if (this.phase === 'settle') this.focus.interrupt(); // hand back mid-arrival
  }

  _bezier(s, out) {
    const a = (1 - s) * (1 - s);
    const b = 2 * (1 - s) * s;
    const c = s * s;
    return out.set(
      a * this._p0.x + b * this._p1.x + c * this._p2.x,
      a * this._p0.y + b * this._p1.y + c * this._p2.y,
      a * this._p0.z + b * this._p1.z + c * this._p2.z
    );
  }

  _applySpeedLook(k) {
    this._k = k;
    const su = this.streaks.material.uniforms;
    su.uStreak.value = Math.min(650, this._v * 0.085);
    su.uOpacity.value = 0.55 * THREE.MathUtils.smoothstep(k, 0.1, 0.5);
    this.streaks.visible = su.uOpacity.value > 0.004;
    const dim = 1 - 0.75 * THREE.MathUtils.smoothstep(k, 0.15, 0.6);
    for (const s of this._skyMats) s.set(s.base * dim);
    this.env.skyDim = dim; // nebulae are dimmed inside env.update
    this.renderer.toneMappingExposure = this._baseExposure * (1 + 0.11 * k);
    const fov = this._baseFov * (1 + 0.05 * k);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.audio) this.audio.travelUpdate(k);
  }

  _endNow(handoffToFocus) {
    this.phase = 'settle';
    this._settleT = 0;
    if (handoffToFocus && this._planet) {
      this.focus.focus(this._planet); // the last stretch: label, sunlit side, tracking
    } else if (handoffToFocus && this._destStar) {
      this.focus.focusStar(this._destStar); // glide in and frame the system
    } else {
      this.controls.enabled = true;
      this.controls.target.copy(this._tmp.copy(this.camera.position).addScaledVector(this._dir, 60));
    }
  }

  update(dt) {
    if (!this.phase) return;
    const su = this.streaks.material.uniforms;

    if (this.phase === 'orient') {
      this._t += dt / 0.9;
      const e = Math.min(1, this._t);
      // turn to face the journey, drift back half a step
      this.controls.target.lerp(this._tmp.copy(this._p0).addScaledVector(this._dir, 140), 1 - Math.exp(-dt * 4));
      this.camera.position.lerp(this._tmp2.copy(this._p0).addScaledVector(this._dir, -6), 1 - Math.exp(-dt * 3));
      if (e >= 1) {
        this._p0.copy(this.camera.position);
        this._prevPos.copy(this.camera.position); // no stale-delta direction flip
        this.controls.target.copy(this.camera.position).addScaledVector(this._dir, 90);
        this._t = 0;
        this.phase = 'cruise';
      }
      return;
    }

    if (this.phase === 'cruise') {
      this._t += dt / this._dur;
      const u = Math.min(1, this._t);
      const s = cubicInOut(u);
      this._bezier(s, this.camera.position);

      // effects follow a guaranteed time envelope (ramp in 22%, full through
      // the middle, release over the last 22%) modulated by actual speed —
      // so the streaks are unmissable DURING the journey and gone by arrival
      this._v = this.camera.position.distanceTo(this._prevPos) / Math.max(dt, 1e-4);
      const envlp = Math.min(1, Math.min(u / 0.22, (1 - u) / 0.22));
      const k = Math.max(0, envlp * (0.4 + 0.6 * Math.min(1, this._v / this._vPeak)));
      this._tmp.copy(this.camera.position).sub(this._prevPos);
      if (this._tmp.lengthSq() > 1e-4) {
        this._dir.copy(this._tmp).normalize();
        const up = Math.abs(this._dir.y) > 0.9 ? this._tmp2.set(1, 0, 0) : this._tmp2.set(0, 1, 0);
        su.uRight.value.crossVectors(this._dir, up).normalize();
        su.uUp.value.crossVectors(su.uRight.value, this._dir);
        su.uDir.value.copy(this._dir);
      }
      this._prevPos.copy(this.camera.position);
      su.uScroll.value -= this._v * dt;
      this.streaks.position.copy(this.camera.position);
      this.controls.target.copy(this._tmp.copy(this.camera.position).addScaledVector(this._dir, 90));
      this._applySpeedLook(k);

      if (this._t >= 1) this._endNow(true);
      return;
    }

    if (this.phase === 'cancel') {
      // ease off the throttle, drift to a stop, hand back control
      this._v *= Math.exp(-2.6 * dt);
      this.camera.position.addScaledVector(this._dir, this._v * dt);
      this._prevPos.copy(this.camera.position);
      su.uScroll.value -= this._v * dt;
      this.streaks.position.copy(this.camera.position);
      this.controls.target.copy(this._tmp.copy(this.camera.position).addScaledVector(this._dir, 90));
      this._applySpeedLook(Math.min(1, this._v / this._vPeak));
      if (this._v < 4) this._endNow(false);
      return;
    }

    if (this.phase === 'settle') {
      this._settleT += dt / 0.7;
      const e = Math.min(1, this._settleT);
      const ease = 1 - Math.exp(-5 * dt); // relax everything toward normal from wherever it is
      su.uStreak.value *= Math.exp(-6 * dt);
      su.uOpacity.value *= Math.exp(-7 * dt);
      this.streaks.visible = su.uOpacity.value > 0.004;
      for (const s of this._skyMats) s.set(s.get() + (s.base - s.get()) * ease);
      this.env.skyDim += (1 - this.env.skyDim) * ease;
      this.renderer.toneMappingExposure += (this._baseExposure - this.renderer.toneMappingExposure) * ease;
      this.camera.fov += (this._baseFov - this.camera.fov) * ease;
      this.camera.updateProjectionMatrix();
      if (this.audio) this.audio.travelUpdate(this._k * (1 - e));
      if (e >= 1) {
        for (const s of this._skyMats) s.set(s.base);
        this._skyMats = null;
        this.env.skyDim = 1;
        this.renderer.toneMappingExposure = this._baseExposure;
        this.camera.fov = this._baseFov;
        this.camera.updateProjectionMatrix();
        this.streaks.visible = false;
        if (this.audio) this.audio.travelEnd();
        this.phase = null;
        this._planet = null;
        this._destStar = null;
      }
    }
  }
}
