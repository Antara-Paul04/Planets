import * as THREE from 'three';

// Ambient mode: after a quiet spell the universe takes the camera on a slow,
// procedural float — toward a planet, through a region, sometimes just out
// into the dark. Any interaction hands control straight back. No fixed path,
// no loops: every leg is a fresh choice with bounded randomness.

const UP = new THREE.Vector3(0, 1, 0);

export class AmbientDirector {
  constructor({ camera, controls, field, stars, isBusy, onEnter, onExit }) {
    this.camera = camera;
    this.controls = controls;
    this.field = field;
    this.stars = stars;
    this.isBusy = isBusy || (() => false);
    this.onEnter = onEnter || (() => {});
    this.onExit = onExit || (() => {});

    this.idleDelay = 11;
    this.idle = 0;
    this.active = false;
    this.ramp = 0;
    this._goalPos = new THREE.Vector3();
    this._goalTgt = new THREE.Vector3();
    this._legTime = 0;
    this._legDur = 0;
    this._lastTarget = null;

    const wake = () => this._wake();
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', wake, { passive: true });
    window.addEventListener('pointermove', (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this._wake();
    }, { passive: true });
  }

  _wake() {
    this.idle = 0;
    if (this.active) {
      this.active = false;
      this.ramp = 0;
      this.onExit();
    }
  }

  _nearestStar() {
    const cam = this.camera.position;
    return [...this.stars].sort(
      (a, b) => a.position.distanceToSquared(cam) - b.position.distanceToSquared(cam)
    )[0];
  }

  _pickLeg() {
    const roll = Math.random();
    const cam = this.camera.position;
    let lookAt;
    let dist;

    if (roll < 0.62 && this.field.planets.length) {
      // drift toward a nearby planet — the ambient camera stays in the
      // neighborhood instead of screaming across interstellar space
      const nearest = [...this.field.planets]
        .sort((a, b) => a.position.distanceToSquared(cam) - b.position.distanceToSquared(cam))
        .slice(0, 16);
      let p = nearest[Math.floor(Math.random() * nearest.length)];
      if (p === this._lastTarget && nearest.length > 1) {
        p = nearest[Math.floor(Math.random() * nearest.length)];
      }
      this._lastTarget = p;
      lookAt = p.position.clone();
      dist = p.scale * (7 + Math.random() * 9);
    } else if (roll < 0.86 && this.stars.length) {
      // wander through the current solar system
      const s = this._nearestStar();
      lookAt = s.position.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(s.influence * 0.35));
      dist = s.influence * (0.5 + Math.random() * 0.8);
    } else if (this.stars.length) {
      // pull back until the whole system is small against the dark
      const s = this._nearestStar();
      lookAt = s.position.clone();
      dist = s.influence * (3 + Math.random() * 4);
    } else {
      lookAt = cam.clone();
      dist = 200;
    }

    // approach from roughly where we already are, gently re-angled,
    // so each leg is a curve rather than a swerve
    const dir = this.camera.position.clone().sub(lookAt);
    if (dir.lengthSq() < 1) dir.set(0, 0.2, 1);
    dir.normalize();
    dir.applyAxisAngle(UP, (Math.random() - 0.5) * 1.1);
    dir.y += (Math.random() - 0.3) * 0.3;
    dir.normalize();

    this._goalPos.copy(lookAt).addScaledVector(dir, dist);
    this._goalTgt.copy(lookAt);
    this._legTime = 0;
    this._legDur = 35 + Math.random() * 40;
  }

  update(dt) {
    if (!this.active) {
      if (this.isBusy()) { this.idle = 0; return; }
      this.idle += dt;
      if (this.idle >= this.idleDelay) {
        this.active = true;
        this.ramp = 0;
        this._pickLeg();
        this.onEnter();
      }
      return;
    }

    this.ramp = Math.min(1, this.ramp + dt / 6);
    this._legTime += dt;
    if (this._legTime > this._legDur || this.camera.position.distanceTo(this._goalPos) < 3) {
      this._pickLeg();
    }

    // floaty exponential approach — never sudden, never fully arrives
    const k = 1 - Math.exp(-dt * 0.045 * this.ramp);
    this.camera.position.lerp(this._goalPos, k);
    this.controls.target.lerp(this._goalTgt, k * 1.15);
  }
}
