import * as THREE from 'three';

// Flies the camera to a clicked planet and pins its name label to it.

const SUN_DIR = new THREE.Vector3(220, 120, 160).normalize();
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// "born · 19 August 2026" — a small piece of the planet's history
function bornLine(createdAt) {
  if (!createdAt) return '';
  return 'born · ' + new Date(createdAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export class FocusController {
  constructor(camera, controls, labelEl) {
    this.camera = camera;
    this.controls = controls;
    this.labelEl = labelEl;
    this.current = null;
    this.anim = null;
    this._v = new THREE.Vector3();
    this._trackPos = new THREE.Vector3();
    this._delta = new THREE.Vector3();
  }

  focus(planet) {
    this.current = planet;
    const target = planet.position.clone();
    const dir = this.camera.position.clone().sub(target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    // drift toward the sun side so the lit face greets the visitor
    dir.normalize().lerp(SUN_DIR, 0.6).normalize();
    const ringSpan = planet.look && planet.look.rings ? planet.look.rings.outer : 1;
    const dist = planet.scale * (3.4 + ringSpan * 1.1) + 1.5;
    const camTo = target.clone().addScaledVector(dir, dist).add(new THREE.Vector3(0, planet.scale * 0.7, 0));
    this.anim = {
      t: 0,
      dur: Math.min(5, 1.2 + this.camera.position.distanceTo(camTo) / 4000),
      camFrom: this.camera.position.clone(),
      camTo,
      tgtFrom: this.controls.target.clone(),
      tgtTo: target,
    };
    this.controls.enabled = false;
    this._trackPos.copy(planet.position);
    this.labelEl.querySelector('.label-name').textContent = planet.name || 'an unnamed world';
    this.labelEl.querySelector('.label-sub').textContent = bornLine(planet.createdAt);
    this.labelEl.classList.remove('label-hidden');
  }

  // fly to a star and frame its whole system — no label, stars have no names
  focusStar(star) {
    this.current = null;
    this.labelEl.classList.add('label-hidden');
    const target = star.position.clone();
    const dir = this.camera.position.clone().sub(target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.2, 1);
    dir.normalize();
    const span = star.orbits.length ? Math.max(...star.orbits.map((o) => o.r)) * 1.45 : star.influence;
    const camTo = target.clone().addScaledVector(dir, span).add(new THREE.Vector3(0, span * 0.3, 0));
    this.anim = {
      t: 0,
      dur: Math.min(6, 1.4 + this.camera.position.distanceTo(camTo) / 4000),
      camFrom: this.camera.position.clone(),
      camTo,
      tgtFrom: this.controls.target.clone(),
      tgtTo: target,
    };
    this.controls.enabled = false;
  }

  // a drag mid-flight hands the camera straight back — no dead controls
  interrupt() {
    if (this.anim) {
      this.anim = null;
      this.controls.enabled = true;
    }
  }

  clear() {
    this.current = null;
    this.anim = null;
    this.controls.enabled = true;
    this.labelEl.classList.add('label-hidden');
    // re-anchor the orbit pivot nearby so free space feels like floating,
    // not like swinging around a point left behind somewhere
    const d = Math.min(400, Math.max(60, this.camera.position.distanceTo(this.controls.target)));
    this.camera.getWorldDirection(this._v);
    this.controls.target.copy(this.camera.position).addScaledVector(this._v, d);
  }

  update(dt) {
    // orbiting planets keep moving — carry the camera along with them
    if (this.current) {
      this._delta.copy(this.current.position).sub(this._trackPos);
      if (this._delta.lengthSq() > 0) {
        if (this.anim) {
          this.anim.camTo.add(this._delta);
          this.anim.tgtTo.add(this._delta);
        } else {
          this.camera.position.add(this._delta);
          this.controls.target.add(this._delta);
        }
        this._trackPos.copy(this.current.position);
      }
    }
    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.dur;
      const k = easeInOutCubic(Math.min(1, a.t));
      this.camera.position.lerpVectors(a.camFrom, a.camTo, k);
      this.controls.target.lerpVectors(a.tgtFrom, a.tgtTo, k);
      if (a.t >= 1) {
        this.anim = null;
        this.controls.enabled = true;
      }
    }
    if (this.current) {
      const p = this.current;
      this._v.copy(p.position);
      this._v.y += p.scale * 1.6;
      this._v.project(this.camera);
      if (this._v.z > 1 || this._v.z < -1) {
        this.labelEl.style.opacity = '0';
      } else {
        this.labelEl.style.opacity = '';
        this.labelEl.style.left = `${(this._v.x * 0.5 + 0.5) * window.innerWidth}px`;
        this.labelEl.style.top = `${(-this._v.y * 0.5 + 0.5) * window.innerHeight}px`;
      }
    }
  }
}
