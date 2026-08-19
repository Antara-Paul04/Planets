import * as THREE from 'three';

// First-visit cinematic: the visitor is already inside the universe. The
// camera starts pulled far back (the nearest star is a distant point) and
// drifts slowly toward its resting position while a single quiet line breathes
// in and out and the UI fades up. It never blocks: any input hands control to
// the visitor instantly and the intro dissolves.
//
// It plays only on a genuine first visit (localStorage-gated). Returning
// visitors land straight at the resting view with the UI already present.

const SEEN_KEY = 'planets.introSeen.v1';
const DURATION = 6.5; // seconds of drift if left uninterrupted
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function firstVisit() {
  try {
    if (localStorage.getItem(SEEN_KEY)) return false;
    localStorage.setItem(SEEN_KEY, '1');
    return true;
  } catch {
    return false; // storage blocked -> don't gate the experience on it
  }
}

export class IntroDirector {
  constructor({ camera, controls, restingPos, restingTarget, lineEl, onReveal }) {
    this.camera = camera;
    this.controls = controls;
    this.restingPos = restingPos.clone();
    this.restingTarget = restingTarget.clone();
    this.lineEl = lineEl;
    this.onReveal = onReveal || (() => {});
    this.active = false;
    this._t = 0;
    this._from = new THREE.Vector3();
    this._revealed = false;
    this._lineShown = false;
    this._onInput = () => this.skip();
  }

  // begin the boot: cinematic on first visit, instant reveal otherwise
  begin() {
    if (!firstVisit()) {
      this._reveal();
      return;
    }
    // start far out along the resting sight-line: the star is a distant point
    const dir = this.restingPos.clone().sub(this.restingTarget);
    this._from.copy(this.restingTarget).addScaledVector(dir, 5);
    this.camera.position.copy(this._from);
    this.controls.target.copy(this.restingTarget);
    this.controls.enabled = false;
    this.active = true;
    this._t = 0;

    // interruptible: the first real input takes over immediately
    window.addEventListener('pointerdown', this._onInput, { passive: true, once: true });
    window.addEventListener('wheel', this._onInput, { passive: true, once: true });
    window.addEventListener('keydown', this._onInput, { passive: true, once: true });
  }

  update(dt) {
    if (!this.active) return;
    this._t += dt / DURATION;
    const u = Math.min(1, this._t);
    // drift the camera in; the target stays on the star so it grows head-on
    this.camera.position.lerpVectors(this._from, this.restingPos, easeInOutCubic(u));
    this.controls.target.copy(this.restingTarget);

    // the quiet line: breathe in early, fade out before arrival
    if (this.lineEl) {
      const show = u > 0.12 && u < 0.7;
      if (show !== this._lineShown) {
        this._lineShown = show;
        this.lineEl.classList.toggle('show', show);
      }
    }

    if (u >= 1) this._finish();
  }

  // hand control to the visitor from wherever the camera currently is
  skip() {
    if (!this.active) return;
    this._finish();
  }

  _finish() {
    this.active = false;
    this.controls.enabled = true;
    if (this.lineEl) this.lineEl.classList.remove('show');
    window.removeEventListener('pointerdown', this._onInput);
    window.removeEventListener('wheel', this._onInput);
    window.removeEventListener('keydown', this._onInput);
    this._reveal();
  }

  _reveal() {
    if (this._revealed) return;
    this._revealed = true;
    this.onReveal();
  }
}
