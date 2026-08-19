import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPlanetVisual, deriveUserPlanet, makeSurfaceMaterial } from '../galaxy/planets.js';
import { Painter } from './painter.js';

// The creation flow: draw -> make it yours -> preview -> launch.
//
// The drawing step is deliberately small: one brush, a curated palette, a few
// sizes, an eraser, and undo/redo/clear. Nothing else — the artwork should come
// from the hand, not from a toolbox. The rectangle is the planet's surface, so
// every stroke is drawn three times (x-W, x, x+W) and wraps seamlessly around
// the seam. The 1024x512 art becomes the equirectangular planet texture.

const CW = 1024;
const CH = 512;

// a small curated palette — enough range for oceans, deserts, ice and lava
// without turning colour into a management tool
const PALETTE = [
  '#f5f1e8', '#ffe08a', '#ef9c4e', '#e2564a',
  '#ff9fb2', '#c79bff', '#8fb8ff', '#4f86c6',
  '#7fe3e0', '#58b895', '#8fd07c', '#1d2030',
];

// brush sizes, fine -> thick, shown as growing dots (never as numbers)
const SIZES = [4, 11, 22, 40];

// one smooth round brush, and an eraser that is just the brush in reverse
const BRUSH = { width: (s) => s };
const ERASER = { width: (s) => s * 1.5, erase: true };

// --- style step (unchanged: these choices feed planet generation) ---
const ATMO_PALETTE = ['#8fb8ff', '#ffd2a1', '#c79bff', '#9fe8d1', '#ff9fb2', '#ffe08a'];
const VIBES = ['weird', 'peaceful', 'chaotic', 'tiny', 'lonely', 'hot', 'dreamy', 'mysterious', 'silly'];

const chipRow = (cls, values, active) =>
  values.map((v) => `<button class="chip ${cls}" data-value="${v}" ${v === active ? 'data-on="1"' : ''}>${v}</button>`).join('');
const dotRow = (cls, colors, active) =>
  colors.map((c) => `<button class="dot ${cls}" data-value="${c}" style="background:${c}" ${c === active ? 'data-on="1"' : ''}></button>`).join('');

export function createCreator({ onLaunch, onPreview }) {
  const overlay = document.createElement('div');
  overlay.id = 'creator';
  overlay.innerHTML = `
    <div class="creator-inner">
      <button class="creator-close" title="Close">&times;</button>

      <section class="step step-draw">
        <h2>draw your planet</h2>
        <p class="creator-sub">this rectangle is the surface — the left and right edges meet around the back</p>
        <div class="draw-stage">
          <canvas class="draw-canvas" width="${CW}" height="${CH}"></canvas>
          <div class="brush-cursor"></div>
        </div>
        <div class="draw-tools">
          <div class="mode-group">
            <button class="mode-btn m-brush" data-on="1">brush</button>
            <button class="mode-btn m-eraser">eraser</button>
          </div>
          <div class="size-dots" title="brush size">
            ${SIZES.map((s, i) => `<button class="size-dot" data-i="${i}" ${i === 1 ? 'data-on="1"' : ''}><span style="width:${4 + i * 4}px;height:${4 + i * 4}px"></span></button>`).join('')}
          </div>
          <div class="palette">
            ${PALETTE.map((c, i) => `<button class="swatch" data-value="${c}" style="background:${c}" ${i === 1 ? 'data-on="1"' : ''} aria-label="colour"></button>`).join('')}
          </div>
        </div>
        <div class="draw-actions">
          <button class="act act-undo" title="undo">&#8630;</button>
          <button class="act act-redo" title="redo">&#8631;</button>
          <button class="act act-clear" title="clear the canvas">clear</button>
        </div>
        <div class="step-nav">
          <button class="btn-primary btn-to-style">next — make it yours</button>
        </div>
      </section>

      <section class="step step-style hidden">
        <h2>make it yours</h2>
        <p class="creator-sub">the drawing stays the star — these are just finishing touches</p>
        <div class="style-groups">
          <div class="style-group">
            <label>surface</label>
            <div class="chip-row">${chipRow('c-type', ['soft', 'rocky', 'glassy', 'matte', 'metallic'], 'soft')}</div>
          </div>
          <div class="style-group">
            <label>what's the vibe? <span class="optional">(optional)</span></label>
            <div class="chip-row">${chipRow('c-vibe', VIBES, null)}</div>
          </div>
        </div>
        <div class="name-row">
          <input class="name-input" maxlength="24" placeholder="name your planet" />
        </div>
        <div class="step-nav">
          <button class="btn-ghost btn-to-draw">back to drawing</button>
          <button class="btn-primary btn-to-preview">see your planet</button>
        </div>
      </section>

      <section class="step step-preview hidden">
        <h2 class="preview-name"></h2>
        <p class="creator-sub">drag to turn it over in your hands</p>
        <div class="preview-holder"></div>
        <p class="creator-status"></p>
        <div class="step-nav">
          <button class="btn-ghost btn-back-style">keep tweaking</button>
          <button class="btn-primary btn-launch">launch planet</button>
        </div>
        <p class="creator-guidelines">planets reported by three different people are removed from the universe</p>
      </section>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const $$ = (sel) => overlay.querySelectorAll(sel);
  const canvas = $('.draw-canvas');
  const displayCtx = canvas.getContext('2d');
  const cursorEl = $('.brush-cursor');
  const nameInput = $('.name-input');

  const painter = new Painter(CW, CH);

  // ---------- tool state ----------
  let tool = 'brush'; // 'brush' | 'eraser'
  let sizeIdx = 1;
  let color = PALETTE[1];

  // ---------- the one brush, wrapped across the seam ----------
  function tracePath(ctx, pts, dx) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x + dx, pts[0].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + dx + 0.01, pts[0].y + 0.01); // a tap leaves a dot
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + dx, pts[i].y);
  }

  function strokeSeam(pts) {
    const cfg = tool === 'eraser' ? ERASER : BRUSH;
    const ctx = painter.actx;
    ctx.save();
    ctx.globalCompositeOperation = cfg.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = cfg.width(SIZES[sizeIdx]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // draw the same path one canvas-width left and right so it meets itself
    for (const dx of [-CW, 0, CW]) { tracePath(ctx, pts, dx); ctx.stroke(); }
    ctx.restore();
    painter.markDirty();
  }

  // ---------- pointer handling ----------
  let drawing = false;
  let strokePts = [];

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    painter.pushUndo();
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    strokePts = [canvasPos(e)];
    strokeSeam(strokePts); // lay down the first dab immediately (low latency)
  });

  canvas.addEventListener('pointermove', (e) => {
    updateCursor(e);
    if (!drawing) return;
    strokePts.push(canvasPos(e));
    strokeSeam(strokePts.slice(-2)); // extend by just the new segment
  });

  window.addEventListener('pointerup', () => {
    drawing = false;
    strokePts = [];
  });

  // a responsive ring that shows the true brush footprint
  function updateCursor(e) {
    const r = canvas.getBoundingClientRect();
    const cfg = tool === 'eraser' ? ERASER : BRUSH;
    const d = cfg.width(SIZES[sizeIdx]) * (r.width / CW);
    cursorEl.style.width = cursorEl.style.height = `${Math.max(4, d)}px`;
    cursorEl.style.left = `${e.clientX - r.left}px`;
    cursorEl.style.top = `${e.clientY - r.top}px`;
  }
  canvas.addEventListener('pointerenter', () => { cursorEl.style.opacity = '1'; });
  canvas.addEventListener('pointerleave', () => { cursorEl.style.opacity = '0'; });

  // ---------- draw-step controls ----------
  const modeBtns = { brush: $('.m-brush'), eraser: $('.m-eraser') };
  function setMode(m) {
    tool = m;
    modeBtns.brush.dataset.on = m === 'brush' ? '1' : '';
    modeBtns.eraser.dataset.on = m === 'eraser' ? '1' : '';
  }
  modeBtns.brush.addEventListener('click', () => setMode('brush'));
  modeBtns.eraser.addEventListener('click', () => setMode('eraser'));

  $$('.size-dot').forEach((b) => {
    b.addEventListener('click', () => {
      $$('.size-dot').forEach((x) => (x.dataset.on = ''));
      b.dataset.on = '1';
      sizeIdx = Number(b.dataset.i);
    });
  });

  // colour is a single interaction; picking one also drops you out of erasing
  $$('.swatch').forEach((b) => {
    b.addEventListener('click', () => {
      color = b.dataset.value;
      $$('.swatch').forEach((x) => (x.dataset.on = x === b ? '1' : ''));
      if (tool === 'eraser') setMode('brush');
    });
  });

  $('.act-undo').addEventListener('click', () => painter.undo());
  $('.act-redo').addEventListener('click', () => painter.redo());

  // clear is secondary and asks once, so a planet is never lost by accident
  const clearBtn = $('.act-clear');
  let clearArmed = false;
  let clearTimer = null;
  function disarmClear() {
    clearArmed = false;
    clearBtn.dataset.armed = '';
    clearBtn.textContent = 'clear';
    clearTimeout(clearTimer);
  }
  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.dataset.armed = '1';
      clearBtn.textContent = 'clear everything?';
      clearTimer = setTimeout(disarmClear, 3000);
      return;
    }
    painter.clearArt();
    disarmClear();
  });

  window.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('open')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? painter.redo() : painter.undo();
    }
  });

  // one RAF loop composites the art onto the visible canvas and, only while the
  // preview step is showing, throttles texture uploads. Runs while open.
  let rafOn = false;
  let lastTexAt = 0;
  let texDirty = false;
  function loop() {
    if (!rafOn) return;
    if (painter.dirty) {
      painter.compose();
      displayCtx.clearRect(0, 0, CW, CH);
      displayCtx.drawImage(painter.composite, 0, 0);
      painter.dirty = false;
      texDirty = true;
    }
    const now = performance.now();
    if (texDirty && now - lastTexAt > 130) {
      if (preview) preview.texture.needsUpdate = true;
      texDirty = false;
      lastTexAt = now;
    }
    requestAnimationFrame(loop);
  }

  // ---------- customization state ----------
  const config = {
    type: 'soft',
    atmo: { mode: 'soft', color: ATMO_PALETTE[0] },
    vibe: null,
  };

  const bindChips = (cls, onPick, allowOff = false) => {
    $$('.' + cls).forEach((b) => {
      b.addEventListener('click', () => {
        const turnOff = allowOff && b.dataset.on === '1';
        $$('.' + cls).forEach((x) => (x.dataset.on = ''));
        if (!turnOff) b.dataset.on = '1';
        onPick(turnOff ? null : b.dataset.value);
      });
    });
  };

  bindChips('c-type', (v) => { config.type = v; });
  bindChips('c-atmo', (v) => {
    config.atmo.mode = v;
    $('.atmo-colors').style.display = v === 'none' ? 'none' : '';
  });
  bindChips('c-atmo-color', (v) => { config.atmo.color = v; });
  bindChips('c-vibe', (v) => { config.vibe = v; }, true);

  // ---------- full 3D preview step ----------
  let preview = null;
  let previewPlanet = null;
  let derived = null;

  function ensurePreview() {
    if (preview) return preview;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const px = Math.min(420, window.innerWidth - 80, window.innerHeight - 300);
    renderer.setSize(px, px);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    $('.preview-holder').appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);

    const sun = new THREE.DirectionalLight(0xffe9c9, 2.4);
    sun.position.set(4, 2, 3);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x445070, 1.1));

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;

    const spin = { vx: 0.004, vy: 0, dragging: false, lastX: 0, lastY: 0 };
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      spin.dragging = true;
      spin.lastX = e.clientX;
      spin.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!spin.dragging || !previewPlanet) return;
      spin.vx = (e.clientX - spin.lastX) * 0.005;
      spin.vy = (e.clientY - spin.lastY) * 0.003;
      spin.lastX = e.clientX;
      spin.lastY = e.clientY;
      previewPlanet.group.rotation.y += spin.vx;
      previewPlanet.group.rotation.x = Math.max(-0.7, Math.min(0.7, previewPlanet.group.rotation.x + spin.vy));
    });
    window.addEventListener('pointerup', () => { spin.dragging = false; });

    preview = { renderer, scene, camera, texture, spin, running: false };
    return preview;
  }

  function buildPreviewPlanet() {
    const p = ensurePreview();
    if (previewPlanet) {
      p.scene.remove(previewPlanet.group);
      previewPlanet.surface.material.dispose();
      if (previewPlanet.ringMaterial) previewPlanet.ringMaterial.dispose();
    }
    derived = deriveUserPlanet(config);
    p.texture.needsUpdate = true;
    const material = makeSurfaceMaterial(p.texture, derived.type, derived.emissive);
    previewPlanet = buildPlanetVisual(material, derived.look);
    // the preview lights the camera-facing side so the artwork stays clearly
    // readable while still reading as a lit 3D sphere; in the universe this is
    // driven per-frame from each planet's real star instead.
    const psl = previewPlanet.surface.material.userData.starLight;
    if (psl) { psl.uToStar.value.set(0.25, 0.18, 1).normalize(); psl.uAmbient.value = 0.34; psl.uDayStrength.value = 0.9; }
    previewPlanet.group.rotation.z = derived.tilt * 0.5;
    p.scene.add(previewPlanet.group);
    p.camera.position.set(0, 0.5, derived.look.rings ? 5.6 : 3.7);
    p.camera.lookAt(0, 0, 0);
  }

  function startPreview() {
    const p = ensurePreview();
    if (p.running) return;
    p.running = true;
    const ploop = () => {
      if (!p.running) return;
      if (previewPlanet) {
        if (!p.spin.dragging) {
          previewPlanet.group.rotation.y += Math.max(0.004, Math.abs(p.spin.vx) * 0.9) * Math.sign(p.spin.vx || 1);
          p.spin.vx *= 0.95;
        }
        for (const piv of previewPlanet.moonPivots) piv.rotation.y += piv.userData.speed * 0.016;
      }
      p.renderer.render(p.scene, p.camera);
      requestAnimationFrame(ploop);
    };
    ploop();
  }
  function stopPreview() {
    if (preview) preview.running = false;
  }

  // ---------- steps / open / close / launch ----------
  const steps = { draw: $('.step-draw'), style: $('.step-style'), preview: $('.step-preview') };
  function showStep(which) {
    for (const [k, el] of Object.entries(steps)) el.classList.toggle('hidden', k !== which);
    if (which === 'preview') {
      $('.preview-name').textContent = nameInput.value.trim() || 'a planet with no name yet';
      buildPreviewPlanet();
      startPreview();
      if (onPreview) onPreview();
    } else {
      stopPreview();
    }
  }

  function open() {
    overlay.classList.add('open');
    showStep('draw');
    painter.markDirty();
    if (!rafOn) { rafOn = true; loop(); }
  }
  function close() {
    overlay.classList.remove('open');
    stopPreview();
    rafOn = false;
  }

  $('.creator-close').addEventListener('click', close);
  $('.btn-to-style').addEventListener('click', () => showStep('style'));
  $('.btn-to-draw').addEventListener('click', () => showStep('draw'));
  $('.btn-to-preview').addEventListener('click', () => showStep('preview'));
  $('.btn-back-style').addEventListener('click', () => showStep('style'));
  // launching persists the planet first; if the universe doesn't answer,
  // the drawing stays right here and nothing is lost
  let launching = false;
  const launchBtn = $('.btn-launch');
  const statusEl = $('.creator-status');
  launchBtn.addEventListener('click', async () => {
    if (launching) return;
    const name = nameInput.value.trim() || 'an unnamed world';
    painter.compose();
    const copy = document.createElement('canvas');
    copy.width = CW;
    copy.height = CH;
    copy.getContext('2d').drawImage(painter.composite, 0, 0);

    launching = true;
    launchBtn.disabled = true;
    launchBtn.textContent = 'launching…';
    statusEl.textContent = '';

    const result = await onLaunch({ name, canvas: copy, derived });

    launching = false;
    launchBtn.disabled = false;
    launchBtn.textContent = 'launch planet';

    if (result && result.failed) {
      statusEl.textContent = result.unavailable
        ? 'the universe is temporarily unavailable.'
        : "the universe didn't answer. try again in a moment.";
      return;
    }

    close();
    painter.pushUndo();
    painter.actx.clearRect(0, 0, CW, CH);
    painter.bg = '#1a1e30';
    painter.undoStack.length = 0;
    painter.redoStack.length = 0;
    painter.markDirty();
    nameInput.value = '';
    statusEl.textContent = '';
  });

  return {
    open,
    close,
    isOpen: () => overlay.classList.contains('open'),
  };
}
