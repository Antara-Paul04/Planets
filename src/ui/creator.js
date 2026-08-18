import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPlanetVisual, deriveUserPlanet, makeSurfaceMaterial } from '../galaxy/planets.js';
import { Painter, applyPattern, addStars, addClouds, addDoodles, randomizeColors } from './painter.js';
import { STAMPS, STAMP_NAMES, stampIcon } from './stamps.js';

// The creation flow: draw -> make it yours -> preview -> launch.
// Drawing happens on a two-layer Painter (background + art) whose 1024x512
// composite becomes the equirectangular planet texture. Strokes are drawn
// three times (x-W, x, x+W) so artwork wraps seamlessly around the seam —
// which is also how people discover that the rectangle wraps.

const CW = 1024;
const CH = 512;

const PALETTES = {
  candy: ['#ff9fb2', '#ffd2a1', '#ffe08a', '#c79bff', '#8fb8ff'],
  earth: ['#8fd07c', '#8a6f4d', '#e8dcc0', '#4f86c6', '#58b895'],
  sunset: ['#ef9c4e', '#e2564a', '#e783a6', '#8a63d2', '#ffd2a1'],
  ocean: ['#7fe3e0', '#4f86c6', '#58b8a5', '#1b2f55', '#a1e3ff'],
  weird: ['#c6f24e', '#ff4fa3', '#ff8c42', '#c4b3f5', '#3ef2ff'],
};
const BASICS = ['#f5f1e8', '#1d2030'];

const ATMO_PALETTE = ['#8fb8ff', '#ffd2a1', '#c79bff', '#9fe8d1', '#ff9fb2', '#ffe08a'];
const VIBES = ['weird', 'peaceful', 'chaotic', 'tiny', 'lonely', 'hot', 'dreamy', 'mysterious', 'silly'];

const SIZES = [4, 9, 16, 26, 40];
const STAMP_SIZES = [26, 42, 64, 96, 140];
const TEXT_SIZES = [20, 28, 40, 56, 80];
const PATTERN_CELLS = [28, 40, 56, 84, 128];

const FONTS = [
  { name: 'bookish', css: 'Georgia, "Times New Roman", serif' },
  { name: 'silly', css: '"Comic Sans MS", "Chalkboard SE", cursive' },
  { name: 'typewriter', css: '"Courier New", monospace' },
  { name: 'bubbly', css: '"Arial Rounded MT Bold", "Trebuchet MS", sans-serif' },
];

const STROKE_TOOLS = {
  pencil:      { width: (s) => Math.max(1.4, s * 0.45), alpha: 1, jitter: 0.9, incremental: true },
  pen:         { width: (s) => s, alpha: 1, incremental: true },
  marker:      { width: (s) => s * 2.1, alpha: 0.45, incremental: false },
  brush:       { width: (s) => s * 1.5, alpha: 0.92, soft: true, incremental: false },
  highlighter: { width: (s) => s * 3, alpha: 0.26, cap: 'butt', incremental: false },
  eraser:      { width: (s) => s * 2.3, alpha: 1, erase: true, incremental: true },
};
const SHAPE_TOOLS = ['line', 'box', 'circle', 'blob'];
const TOOL_LIST = ['pencil', 'pen', 'marker', 'brush', 'highlighter', 'eraser', 'fill', 'line', 'box', 'circle', 'blob', 'stamp', 'pattern', 'text'];
const PATTERN_LIST = ['dots', 'stripes', 'waves', 'checker', 'stars', 'grid', 'squiggles', 'circles'];

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
        <h2>draw the surface of your world</h2>
        <p class="creator-sub">the left and right edges meet around the back</p>
        <div class="draw-row">
          <div class="canvas-wrap">
            <canvas class="draw-canvas" width="${CW}" height="${CH}"></canvas>
            <div class="brush-cursor"></div>
          </div>
          <div class="mini-preview">
            <div class="mini-holder"></div>
            <p>it wraps like this</p>
          </div>
        </div>
        <div class="toolbar tools-row">
          ${TOOL_LIST.map((t) => `<button class="chip c-tool" data-value="${t}" ${t === 'pencil' ? 'data-on="1"' : ''}>${t}</button>`).join('')}
        </div>
        <div class="toolbar ctl-row">
          <span class="size-dots">
            ${SIZES.map((s, i) => `<button class="size-dot" data-i="${i}" ${i === 1 ? 'data-on="1"' : ''}><span style="width:${5 + i * 4}px;height:${5 + i * 4}px"></span></button>`).join('')}
          </span>
          <span class="toolbar-sep"></span>
          <label class="opacity-label">ink <input type="range" class="opacity-range" min="15" max="100" value="100" /></label>
          <span class="toolbar-sep"></span>
          <span class="sym-chips">
            ${chipRow('c-sym', ['no mirror', '↔', '↕', '✳'], 'no mirror')}
          </span>
        </div>
        <div class="toolbar color-row">
          <span class="palette-tabs">${chipRow('c-pal', Object.keys(PALETTES), 'candy')}</span>
          <span class="swatches"></span>
          <input type="color" class="color-picker" value="#ff9fb2" title="any color you like" />
        </div>
        <div class="tray stamps-tray hidden"></div>
        <div class="tray pattern-tray hidden">
          ${chipRow('c-pattern', PATTERN_LIST, null)}
          <span class="tray-hint">tap one to print it — size dots set the scale</span>
        </div>
        <div class="text-row hidden">
          <input class="text-input" maxlength="40" placeholder="type something, then click the canvas to place it" />
          <span class="font-chips">${FONTS.map((f, i) => `<button class="chip c-font" data-value="${i}" ${i === 0 ? 'data-on="1"' : ''} style="font-family:${f.css.replace(/"/g, '&quot;')}">${f.name}</button>`).join('')}</span>
        </div>
        <div class="toolbar helpers-row">
          <button class="helper h-bg">fill background</button>
          <button class="helper h-stars">add stars</button>
          <button class="helper h-clouds">add clouds</button>
          <button class="helper h-doodle">random doodles</button>
          <button class="helper h-shuffle">shuffle colors</button>
          <span class="toolbar-sep"></span>
          <button class="tool tool-undo">undo</button>
          <button class="tool tool-redo">redo</button>
          <button class="tool tool-clear">clear</button>
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
            <label>atmosphere</label>
            <div class="chip-row">${chipRow('c-atmo', ['none', 'soft', 'thick', 'colorful'], 'soft')}</div>
            <div class="chip-row atmo-colors">${dotRow('c-atmo-color', ATMO_PALETTE, ATMO_PALETTE[0])}</div>
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
  const textInput = $('.text-input');
  const nameInput = $('.name-input');
  const colorPicker = $('.color-picker');

  const painter = new Painter(CW, CH);

  // ---------- tool state ----------
  let tool = 'pencil';
  let sizeIdx = 1;
  let opacity = 1;
  let color = PALETTES.candy[0];
  let symmetry = 'off'; // off | v | h | r
  let fontIdx = 0;
  let stampName = 'star';
  let paletteName = 'candy';

  const curPalette = () => [...PALETTES[paletteName], ...BASICS];

  // ---------- symmetry + wrap plumbing ----------
  const variantsOf = (pts) => {
    const out = [pts];
    if (symmetry === 'v' || symmetry === 'r') out.push(pts.map((p) => ({ x: CW - p.x, y: p.y })));
    if (symmetry === 'h' || symmetry === 'r') out.push(pts.map((p) => ({ x: p.x, y: CH - p.y })));
    if (symmetry === 'r') out.push(pts.map((p) => ({ x: CW - p.x, y: CH - p.y })));
    return out;
  };

  function tracePath(ctx, pts, dx) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x + dx, pts[0].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + dx + 0.01, pts[0].y + 0.01);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + dx, pts[i].y);
  }

  function strokeAllVariants(pts, cfg) {
    const ctx = painter.actx;
    ctx.save();
    ctx.globalAlpha = cfg.alpha * opacity;
    ctx.globalCompositeOperation = cfg.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = cfg.width(SIZES[sizeIdx]);
    ctx.lineCap = cfg.cap || 'round';
    ctx.lineJoin = 'round';
    if (cfg.soft) {
      ctx.shadowColor = color;
      ctx.shadowBlur = SIZES[sizeIdx] * 0.7;
    }
    for (const varPts of variantsOf(pts)) {
      for (const dx of [-CW, 0, CW]) {
        tracePath(ctx, varPts, dx);
        ctx.stroke();
      }
    }
    ctx.restore();
    painter.markDirty();
  }

  function drawShapeAllVariants(a, b, kind) {
    const ctx = painter.actx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, SIZES[sizeIdx] * 0.8);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [va, vb] of variantsOf([a, b]).map((v) => [v[0], v[1]])) {
      for (const dx of [-CW, 0, CW]) {
        ctx.beginPath();
        if (kind === 'line') {
          ctx.moveTo(va.x + dx, va.y);
          ctx.lineTo(vb.x + dx, vb.y);
          ctx.stroke();
        } else if (kind === 'box') {
          ctx.strokeRect(Math.min(va.x, vb.x) + dx, Math.min(va.y, vb.y), Math.abs(vb.x - va.x), Math.abs(vb.y - va.y));
        } else {
          ctx.ellipse((va.x + vb.x) / 2 + dx, (va.y + vb.y) / 2, Math.abs(vb.x - va.x) / 2 || 1, Math.abs(vb.y - va.y) / 2 || 1, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    painter.markDirty();
  }

  function fillBlobAllVariants(pts) {
    const ctx = painter.actx;
    ctx.save();
    ctx.globalAlpha = opacity * 0.9;
    ctx.fillStyle = color;
    for (const varPts of variantsOf(pts)) {
      for (const dx of [-CW, 0, CW]) {
        tracePath(ctx, varPts, dx);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    painter.markDirty();
  }

  function placeStamp(p) {
    painter.pushUndo();
    const ctx = painter.actx;
    const s = STAMP_SIZES[sizeIdx];
    for (const [v] of variantsOf([p]).map((x) => [x[0]])) {
      for (const dx of [-CW, 0, CW]) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(v.x + dx, v.y);
        ctx.rotate((Math.random() - 0.5) * 0.7);
        STAMPS[stampName](ctx, s, color);
        ctx.restore();
      }
    }
    painter.markDirty();
  }

  function placeText(p) {
    const text = textInput.value.trim();
    if (!text) { textInput.focus(); return; }
    painter.pushUndo();
    const ctx = painter.actx;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.font = `600 ${TEXT_SIZES[sizeIdx]}px ${FONTS[fontIdx].css}`;
    ctx.textAlign = 'center';
    for (const dx of [-CW, 0, CW]) ctx.fillText(text, p.x + dx, p.y);
    ctx.restore();
    painter.markDirty();
  }

  // ---------- pointer handling ----------
  let drawing = false;
  let strokePts = [];
  let strokeStart = null;
  let strokeSnapshot = null; // ImageData of art layer before this gesture

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
  }
  const jitterPt = (p, amt) => ({ x: p.x + (Math.random() - 0.5) * amt, y: p.y + (Math.random() - 0.5) * amt });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = canvasPos(e);
    if (tool === 'stamp') { placeStamp(p); return; }
    if (tool === 'text') { placeText(p); return; }
    if (tool === 'fill') {
      painter.pushUndo();
      for (const [v] of variantsOf([p]).map((x) => [x[0]])) painter.floodFill(v.x, v.y, color);
      return;
    }
    if (tool === 'pattern') return; // patterns come from the tray
    painter.pushUndo();
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    if (SHAPE_TOOLS.includes(tool)) {
      strokeStart = p;
      strokePts = [p];
      strokeSnapshot = painter.actx.getImageData(0, 0, CW, CH);
      return;
    }
    const cfg = STROKE_TOOLS[tool];
    strokePts = [cfg.jitter ? jitterPt(p, cfg.jitter * 2) : p];
    strokeSnapshot = cfg.incremental ? null : painter.actx.getImageData(0, 0, CW, CH);
    strokeAllVariants(strokePts, cfg);
  });

  canvas.addEventListener('pointermove', (e) => {
    updateCursor(e);
    if (!drawing) return;
    const p = canvasPos(e);
    if (SHAPE_TOOLS.includes(tool)) {
      strokePts.push(p);
      painter.actx.putImageData(strokeSnapshot, 0, 0);
      if (tool === 'blob') fillBlobAllVariants(strokePts);
      else drawShapeAllVariants(strokeStart, p, tool);
      return;
    }
    const cfg = STROKE_TOOLS[tool];
    strokePts.push(cfg.jitter ? jitterPt(p, cfg.jitter * 2) : p);
    if (cfg.incremental) {
      strokeAllVariants(strokePts.slice(-2), cfg);
    } else {
      painter.actx.putImageData(strokeSnapshot, 0, 0);
      strokeAllVariants(strokePts, cfg);
    }
  });

  window.addEventListener('pointerup', () => {
    drawing = false;
    strokePts = [];
    strokeStart = null;
    strokeSnapshot = null;
  });

  // brush-size cursor ring
  function updateCursor(e) {
    const r = canvas.getBoundingClientRect();
    const cfg = STROKE_TOOLS[tool];
    let d;
    if (cfg) d = cfg.width(SIZES[sizeIdx]) * (r.width / CW);
    else if (tool === 'stamp') d = STAMP_SIZES[sizeIdx] * (r.width / CW);
    else d = Math.max(6, SIZES[sizeIdx] * 0.8 * (r.width / CW));
    cursorEl.style.width = cursorEl.style.height = `${Math.max(4, d)}px`;
    cursorEl.style.left = `${e.clientX - r.left}px`;
    cursorEl.style.top = `${e.clientY - r.top}px`;
  }
  canvas.addEventListener('pointerenter', () => { cursorEl.style.opacity = '1'; });
  canvas.addEventListener('pointerleave', () => { cursorEl.style.opacity = '0'; });

  // ---------- toolbar wiring ----------
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

  bindChips('c-tool', (v) => {
    tool = v === 'eraser' ? 'eraser' : v;
    $('.stamps-tray').classList.toggle('hidden', v !== 'stamp');
    $('.pattern-tray').classList.toggle('hidden', v !== 'pattern');
    $('.text-row').classList.toggle('hidden', v !== 'text');
    if (v === 'text') textInput.focus();
  });

  $$('.size-dot').forEach((b) => {
    b.addEventListener('click', () => {
      $$('.size-dot').forEach((x) => (x.dataset.on = ''));
      b.dataset.on = '1';
      sizeIdx = Number(b.dataset.i);
    });
  });
  $('.opacity-range').addEventListener('input', (e) => { opacity = Number(e.target.value) / 100; });

  const SYM_MAP = { 'no mirror': 'off', '↔': 'v', '↕': 'h', '✳': 'r' };
  bindChips('c-sym', (v) => { symmetry = SYM_MAP[v] || 'off'; });

  const swatchHolder = $('.swatches');
  function renderSwatches() {
    swatchHolder.innerHTML = dotRow('swatch', curPalette(), color);
    swatchHolder.querySelectorAll('.swatch').forEach((b) => {
      b.addEventListener('click', () => {
        color = b.dataset.value;
        colorPicker.value = new (function () { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = color; return { v: c.fillStyle }; })().v;
        swatchHolder.querySelectorAll('.swatch').forEach((x) => (x.dataset.on = x === b ? '1' : ''));
      });
    });
  }
  bindChips('c-pal', (v) => { paletteName = v; renderSwatches(); });
  renderSwatches();
  colorPicker.addEventListener('input', () => {
    color = colorPicker.value;
    swatchHolder.querySelectorAll('.swatch').forEach((x) => (x.dataset.on = ''));
  });

  // stamps tray
  const stampsTray = $('.stamps-tray');
  STAMP_NAMES.forEach((name) => {
    const b = document.createElement('button');
    b.className = 'stamp-btn';
    b.title = name;
    if (name === stampName) b.dataset.on = '1';
    b.appendChild(stampIcon(name));
    b.addEventListener('click', () => {
      stampName = name;
      stampsTray.querySelectorAll('.stamp-btn').forEach((x) => (x.dataset.on = x === b ? '1' : ''));
    });
    stampsTray.appendChild(b);
  });

  // patterns tray — tapping a pattern prints it immediately (undoable)
  $$('.c-pattern').forEach((b) => {
    b.addEventListener('click', () => {
      applyPattern(painter, b.dataset.value, PATTERN_CELLS[sizeIdx], color, Math.min(0.85, 0.4 + opacity * 0.4));
    });
  });

  bindChips('c-font', (v) => { fontIdx = Number(v); });

  // helpers
  $('.h-bg').addEventListener('click', () => painter.setBackground(color));
  $('.h-stars').addEventListener('click', () => addStars(painter, curPalette()));
  $('.h-clouds').addEventListener('click', () => addClouds(painter));
  $('.h-doodle').addEventListener('click', () => addDoodles(painter, curPalette()));
  $('.h-shuffle').addEventListener('click', () => randomizeColors(painter));

  $('.tool-undo').addEventListener('click', () => painter.undo());
  $('.tool-redo').addEventListener('click', () => painter.redo());
  $('.tool-clear').addEventListener('click', () => painter.clearArt());

  window.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('open')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? painter.redo() : painter.undo();
    }
  });

  // ---------- live mini preview beside the canvas ----------
  let mini = null;
  function ensureMini() {
    if (mini) return mini;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(150, 150);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    $('.mini-holder').appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
    camera.position.set(0, 0.3, 3.4);
    camera.lookAt(0, 0, 0);
    const sun = new THREE.DirectionalLight(0xffe9c9, 2.2);
    sun.position.set(4, 2, 3);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x445070, 1.6));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 22),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 })
    );
    scene.add(globe);
    mini = { renderer, scene, camera, globe, texture };
    return mini;
  }

  // one RAF loop drives: composite -> display canvas, throttled texture
  // upload, and the mini globe rotation. Runs only while the overlay is open.
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
    if (mini) {
      if (texDirty && now - lastTexAt > 130) {
        mini.texture.needsUpdate = true;
        if (preview) preview.texture.needsUpdate = true;
        texDirty = false;
        lastTexAt = now;
      }
      if (!$('.step-draw').classList.contains('hidden')) {
        mini.globe.rotation.y += 0.006;
        mini.renderer.render(mini.scene, mini.camera);
      }
    }
    requestAnimationFrame(loop);
  }

  // ---------- customization state ----------
  const config = {
    type: 'soft',
    atmo: { mode: 'soft', color: ATMO_PALETTE[0] },
    vibe: null,
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
    ensureMini();
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
    textInput.value = '';
    statusEl.textContent = '';
  });

  return {
    open,
    close,
    isOpen: () => overlay.classList.contains('open'),
  };
}
