// Generative ambient soundscape — no samples, no loops, just a few quiet
// layers synthesized with WebAudio:
//   hum  — two barely-detuned low sines (swells near a sun)
//   pad  — a soft sustained triad through a lowpass (richer in dense regions)
//   air  — filtered noise, almost inaudible (breathes with a slow LFO)
//   ...plus the occasional lone soft tone, and whispers for comets/meteors.
// Everything is smoothed with setTargetAtTime so nothing ever clicks.

const PREF_KEY = 'planets.audio.v1';
const NOTES = [220, 261.63, 329.63, 392, 440, 523.25];

export class Soundscape {
  constructor() {
    let pref = null;
    try { pref = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch { /* fresh start */ }
    this.pref = pref || { on: false, vol: 0.5 };
    this.ctx = null;
    this.enabled = false;
    this._travelK = 0;
    this._pollAcc = 0;
    this._blipIn = 20 + Math.random() * 40;
    this._lastEvent = null;
  }

  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // --- hum ---
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 130;
    this.humGain.connect(humFilter).connect(this.master);
    for (const f of [54, 54.6]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(this.humGain);
      o.start();
    }

    // --- pad ---
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 620;
    this.padFilter = padFilter;
    this.padGain.connect(padFilter).connect(this.master);
    [110, 165, 196].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      // each voice slowly waxes and wanes on its own clock
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.013 + i * 0.007;
      const lfoAmp = ctx.createGain();
      lfoAmp.gain.value = 0.14;
      lfo.connect(lfoAmp).connect(g.gain);
      lfo.start();
      o.connect(g).connect(this.padGain);
      o.start();
    });

    // --- air ---
    const noiseLen = 4 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = 'bandpass';
    this.airFilter.frequency.value = 850;
    this.airFilter.Q.value = 0.7;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0;
    noise.connect(this.airFilter).connect(this.airGain).connect(this.master);
    noise.start();

    // --- planet proximity: a soft fifth that rises as you draw near a world ---
    this.planetGain = ctx.createGain();
    this.planetGain.gain.value = 0;
    const planetFilter = ctx.createBiquadFilter();
    planetFilter.type = 'lowpass';
    planetFilter.frequency.value = 900;
    this.planetGain.connect(planetFilter).connect(this.master);
    for (const f of [262, 393.3]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g).connect(this.planetGain);
      o.start();
    }

    // --- bus for one-off soft tones ---
    this.blipBus = ctx.createGain();
    this.blipBus.gain.value = 1;
    this.blipBus.connect(this.master);
  }

  _tone(freq, { attack = 3, release = 4, gain = 0.05, type = 'sine' } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    o.connect(g).connect(this.blipBus);
    o.start(t);
    o.stop(t + attack + release + 0.1);
  }

  enable() {
    if (!this.ctx) this._build();
    this.ctx.resume();
    this.enabled = true;
    this.pref.on = true;
    this._save();
    this._setMaster();
  }
  disable() {
    this.enabled = false;
    this.pref.on = false;
    this._travelK = 0;
    this._save();
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(0, t, 0.6);
      this.airFilter.frequency.setTargetAtTime(850, t, 1); // never re-enable mid-swell
    }
  }
  setVolume(v) {
    this.pref.vol = v;
    this._save();
    this._setMaster();
  }
  _setMaster() {
    if (!this.ctx || !this.enabled) return;
    // deliberately quiet even at full volume
    this.master.gain.setTargetAtTime(0.16 * this.pref.vol, this.ctx.currentTime, 1.2);
  }
  _save() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(this.pref)); } catch { /* fine */ }
  }

  // something has just come into existence — a quiet harmonic bloom
  birth() {
    if (!this.enabled || !this.ctx) return;
    this._tone(262, { attack: 0.12, release: 3.0, gain: 0.05 });
    this._tone(393.3, { attack: 0.2, release: 3.4, gain: 0.032 });
    this._tone(524, { attack: 0.35, release: 3.8, gain: 0.02 });
    this._tone(65.4, { attack: 0.05, release: 1.6, gain: 0.045 }); // gentle low pulse
  }

  // tiny confirmation, e.g. the drawing becoming a planet in the preview
  tick() {
    if (!this.enabled || !this.ctx) return;
    this._tone(524, { attack: 0.05, release: 1.3, gain: 0.018 });
  }

  // interstellar travel: space itself swells — no engines
  travelStart() {
    this._travelK = 0.001;
  }
  travelUpdate(k) {
    this._travelK = k;
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(0.07 + k * 0.3, t, 0.7);
    this.airFilter.frequency.setTargetAtTime(850 + k * 1900, t, 0.5);
    this.airGain.gain.setTargetAtTime(0.03 + k * 0.11, t, 0.5);
    this.padGain.gain.setTargetAtTime(0.04 + k * 0.05, t, 1.0);
  }
  travelEnd() {
    this._travelK = 0;
    if (this.ctx) this.airFilter.frequency.setTargetAtTime(850, this.ctx.currentTime, 2);
    // the regular environment targets take over on the next poll
  }

  // called every frame; heavy work only ~2x per second
  update(dt, { camera, suns, regions, activeEvent, eventPos, planets }) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;

    // occasional lone soft tone, whatever is happening
    this._blipIn -= dt;
    if (this._blipIn <= 0) {
      this._tone(NOTES[Math.floor(Math.random() * NOTES.length)], { gain: 0.028 });
      this._blipIn = 25 + Math.random() * 50;
    }

    // transient whispers for events — attenuated by how far away they are
    if (activeEvent !== this._lastEvent) {
      const atten = eventPos && camera
        ? 1 - Math.min(1, camera.position.distanceTo(eventPos) / 3500)
        : 1;
      if (activeEvent === 'comet') {
        this.airFilter.frequency.setTargetAtTime(1900, t, 4);
        this.airGain.gain.setTargetAtTime(0.09, t, 4);
        setTimeout(() => {
          if (!this.ctx) return;
          this.airFilter.frequency.setTargetAtTime(850, this.ctx.currentTime, 8);
        }, 12000);
      }
      if (activeEvent === 'flare' && atten > 0.03) {
        this.humGain.gain.setTargetAtTime(0.08 + 0.26 * atten, t, 2.5);
        setTimeout(() => {
          if (this.ctx) this.humGain.gain.setTargetAtTime(0.08, this.ctx.currentTime, 4);
        }, 8000);
      }
      if (activeEvent === 'meteors') {
        for (let i = 0; i < 4; i++) {
          setTimeout(() => this._tone(NOTES[2 + Math.floor(Math.random() * 4)] * 2, { attack: 0.4, release: 2.2, gain: 0.02 }), i * 1800 + Math.random() * 900);
        }
      }
      this._lastEvent = activeEvent;
    }

    this._pollAcc += dt;
    if (this._pollAcc < 0.5) return;
    this._pollAcc = 0;
    if (this._travelK > 0.02) return; // travel swell owns the mix right now

    // environment-shaped targets
    let sunNear = 0;
    for (const s of suns) {
      const d = camera.position.distanceTo(s.position);
      sunNear = Math.max(sunNear, 1 - Math.min(1, d / 140));
    }
    let regionNear = 0;
    for (const r of regions) {
      const d = camera.position.distanceTo(r.center);
      regionNear = Math.max(regionNear, 1 - Math.min(1, d / (r.radius * 1.6)));
    }

    // interstellar space is emptier: the base layers thin out away from
    // suns and inhabited regions, and gently thicken near them
    const presence = Math.max(sunNear, regionNear * 0.7);
    // long, slow, irrational-period drifts so nothing ever audibly loops
    const T = this.ctx.currentTime;
    const drift1 = Math.sin((T / 127) * Math.PI * 2);
    const drift2 = Math.sin((T / 211) * Math.PI * 2 + 1.3);

    this.humGain.gain.setTargetAtTime(0.03 + sunNear * 0.32 + 0.015 * drift2, t, 2.5);
    this.padGain.gain.setTargetAtTime(0.02 + presence * 0.16 + 0.01 * drift1, t, 3.5);
    this.padFilter.frequency.setTargetAtTime(620 + regionNear * 500 + 70 * drift1, t, 4);
    if (this._lastEvent !== 'comet') {
      this.airGain.gain.setTargetAtTime(0.012 + presence * 0.03, t, 3);
    }

    // approaching a world: a soft tonal layer rises, richer very close
    let planetNear = 0;
    if (planets && camera) {
      for (const pl of planets) {
        const d = camera.position.distanceTo(pl.position) / Math.max(1, pl.scale);
        planetNear = Math.max(planetNear, 1 - Math.min(1, d / 40));
      }
    }
    this.planetGain.gain.setTargetAtTime(0.06 * planetNear * planetNear, t, 2);
  }
}
