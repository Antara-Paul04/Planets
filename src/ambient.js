// Idle mode: after a quiet spell the UI recedes so nothing clutters the view.
// It does NOT move the camera — the camera is stationary unless the user drives
// it (pan/orbit/zoom) or an explicit navigation runs (find my planet, jump to a
// star, star-travel). Any interaction restores the UI immediately.

export class AmbientDirector {
  constructor({ isBusy, onEnter, onExit }) {
    this.isBusy = isBusy || (() => false);
    this.onEnter = onEnter || (() => {});
    this.onExit = onExit || (() => {});

    this.idleDelay = 11;
    this.idle = 0;
    this.active = false;

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
      this.onExit();
    }
  }

  update(dt) {
    if (this.active) return; // idle only fades the UI; the camera never drifts on its own
    if (this.isBusy()) { this.idle = 0; return; }
    this.idle += dt;
    if (this.idle >= this.idleDelay) {
      this.active = true;
      this.onEnter();
    }
  }
}
