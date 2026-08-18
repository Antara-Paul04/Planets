import { STAMPS } from './stamps.js';

// Two-layer painting surface: a background color underneath a transparent
// "art" canvas. The composite of the two is what becomes the planet texture.
// Erasing punches through the art layer to reveal the background.
// Undo/redo snapshots capture both.

export class Painter {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.bg = '#1a1e30';
    this.art = document.createElement('canvas');
    this.art.width = W;
    this.art.height = H;
    this.actx = this.art.getContext('2d', { willReadFrequently: true });
    this.composite = document.createElement('canvas');
    this.composite.width = W;
    this.composite.height = H;
    this.cctx = this.composite.getContext('2d');
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = true;
    this.compose();
  }

  compose() {
    this.cctx.fillStyle = this.bg;
    this.cctx.fillRect(0, 0, this.W, this.H);
    this.cctx.drawImage(this.art, 0, 0);
  }

  markDirty() { this.dirty = true; }

  _snapshot() {
    return { img: this.actx.getImageData(0, 0, this.W, this.H), bg: this.bg };
  }
  _restore(s) {
    this.actx.putImageData(s.img, 0, 0);
    this.bg = s.bg;
    this.dirty = true;
  }
  pushUndo() {
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.undoStack.push(this._snapshot());
    this.redoStack.length = 0;
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this._snapshot());
    this._restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this._snapshot());
    this._restore(s);
  }
  clearArt() {
    this.pushUndo();
    this.actx.clearRect(0, 0, this.W, this.H);
    this.dirty = true;
  }
  setBackground(color) {
    this.pushUndo();
    this.bg = color;
    this.dirty = true;
  }

  // flood fill (on the composite view, painted into the art layer)
  floodFill(x, y, colorCss) {
    const { W, H } = this;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    this.compose();
    const src = this.cctx.getImageData(0, 0, W, H);
    const d = src.data;
    const idx = (y * W + x) * 4;
    const tr = d[idx], tg = d[idx + 1], tb = d[idx + 2];
    // parse fill color
    const probe = document.createElement('canvas').getContext('2d');
    probe.fillStyle = colorCss;
    const hex = probe.fillStyle; // normalized #rrggbb
    const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 12) return;
    const TOL = 28;
    const match = (i) => Math.abs(d[i] - tr) <= TOL && Math.abs(d[i + 1] - tg) <= TOL && Math.abs(d[i + 2] - tb) <= TOL;
    const out = this.actx.createImageData(W, H);
    const od = out.data;
    const seen = new Uint8Array(W * H);
    const stack = [x + y * W];
    seen[x + y * W] = 1;
    while (stack.length) {
      const p = stack.pop();
      const px = p % W, py = (p / W) | 0;
      const i = p * 4;
      if (!match(i)) continue;
      od[i] = fr; od[i + 1] = fg; od[i + 2] = fb; od[i + 3] = 255;
      if (px > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (px < W - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (py > 0 && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (py < H - 1 && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    // stencil the fill on top of the art layer
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d').putImageData(out, 0, 0);
    this.actx.drawImage(tmp, 0, 0);
    this.dirty = true;
  }
}

// ---- repeating patterns, painted straight onto the art layer ----

export const PATTERNS = {
  dots(ctx, W, H, cell, color) {
    ctx.fillStyle = color;
    for (let y = cell / 2, row = 0; y < H; y += cell, row++) {
      for (let x = cell / 2 + (row % 2) * cell * 0.5; x < W; x += cell) {
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.14, 0, 7);
        ctx.fill();
      }
    }
  },
  stripes(ctx, W, H, cell, color) {
    ctx.fillStyle = color;
    for (let y = 0; y < H; y += cell) ctx.fillRect(0, y, W, cell * 0.45);
  },
  waves(ctx, W, H, cell, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.lineCap = 'round';
    for (let y = cell / 2; y < H; y += cell) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const yy = y + Math.sin((x / cell) * Math.PI * 2) * cell * 0.2;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  },
  checker(ctx, W, H, cell, color) {
    ctx.fillStyle = color;
    for (let y = 0, ry = 0; y < H; y += cell, ry++)
      for (let x = (ry % 2) * cell; x < W; x += cell * 2)
        ctx.fillRect(x, y, cell, cell);
  },
  stars(ctx, W, H, cell, color) {
    const n = Math.round((W * H) / (cell * cell) * 0.4);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(Math.random() * W, Math.random() * H);
      ctx.rotate(Math.random() * Math.PI);
      STAMPS.sparkle(ctx, cell * (0.3 + Math.random() * 0.4), color);
      ctx.restore();
    }
  },
  grid(ctx, W, H, cell, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, cell * 0.05);
    ctx.beginPath();
    for (let x = 0; x <= W; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += cell) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  },
  squiggles(ctx, W, H, cell, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.lineCap = 'round';
    const n = Math.round((W * H) / (cell * cell) * 0.5);
    for (let i = 0; i < n; i++) {
      const x0 = Math.random() * W, y0 = Math.random() * H;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      let x = x0, y = y0;
      for (let k = 0; k < 4; k++) {
        x += (Math.random() - 0.5) * cell * 1.4;
        y += (Math.random() - 0.5) * cell * 1.4;
        ctx.quadraticCurveTo(x + (Math.random() - 0.5) * cell, y + (Math.random() - 0.5) * cell, x, y);
      }
      ctx.stroke();
    }
  },
  circles(ctx, W, H, cell, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cell * 0.08);
    for (let y = cell / 2; y < H; y += cell)
      for (let x = cell / 2; x < W; x += cell) {
        ctx.beginPath();
        ctx.arc(x + (Math.random() - 0.5) * cell * 0.2, y + (Math.random() - 0.5) * cell * 0.2, cell * (0.18 + Math.random() * 0.14), 0, 7);
        ctx.stroke();
      }
  },
};

export function applyPattern(painter, name, cellApprox, color, alpha) {
  painter.pushUndo();
  // snap the cell so it divides the width — patterns tile cleanly around the seam
  const cell = painter.W / Math.max(2, Math.round(painter.W / cellApprox));
  const ctx = painter.actx;
  ctx.save();
  ctx.globalAlpha = alpha;
  PATTERNS[name](ctx, painter.W, painter.H, cell, color);
  ctx.restore();
  painter.dirty = true;
}

// ---- one-tap doodle helpers ----

export function addStars(painter, palette) {
  painter.pushUndo();
  const ctx = painter.actx;
  const n = 14 + Math.floor(Math.random() * 10);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(Math.random() * painter.W, Math.random() * painter.H);
    ctx.rotate(Math.random() * Math.PI);
    const stamp = Math.random() < 0.5 ? 'sparkle' : 'star';
    STAMPS[stamp](ctx, 10 + Math.random() * 20, palette[Math.floor(Math.random() * palette.length)]);
    ctx.restore();
  }
  painter.dirty = true;
}

export function addClouds(painter) {
  painter.pushUndo();
  const ctx = painter.actx;
  const n = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(Math.random() * painter.W, Math.random() * painter.H);
    ctx.globalAlpha = 0.75 + Math.random() * 0.25;
    STAMPS.cloud(ctx, 46 + Math.random() * 60, '#f2f1ea');
    ctx.restore();
  }
  painter.dirty = true;
}

export function addDoodles(painter, palette) {
  painter.pushUndo();
  const ctx = painter.actx;
  const pick = () => palette[Math.floor(Math.random() * palette.length)];
  const n = 16 + Math.floor(Math.random() * 8);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * painter.W, y = Math.random() * painter.H;
    const kind = Math.random();
    ctx.save();
    ctx.translate(x, y);
    if (kind < 0.3) {
      ctx.fillStyle = pick();
      ctx.beginPath();
      ctx.arc(0, 0, 3 + Math.random() * 9, 0, 7);
      ctx.fill();
    } else if (kind < 0.55) {
      ctx.strokeStyle = pick();
      ctx.lineWidth = 2 + Math.random() * 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      let px = 0, py = 0;
      ctx.moveTo(0, 0);
      for (let k = 0; k < 3; k++) {
        px += (Math.random() - 0.5) * 50;
        py += (Math.random() - 0.5) * 50;
        ctx.quadraticCurveTo(px + (Math.random() - 0.5) * 30, py + (Math.random() - 0.5) * 30, px, py);
      }
      ctx.stroke();
    } else if (kind < 0.75) {
      ctx.rotate(Math.random() * Math.PI);
      STAMPS.star(ctx, 12 + Math.random() * 18, pick());
    } else {
      ctx.strokeStyle = pick();
      ctx.lineWidth = 2 + Math.random() * 3;
      ctx.beginPath();
      ctx.arc(0, 0, 6 + Math.random() * 16, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
  }
  painter.dirty = true;
}

export function randomizeColors(painter) {
  painter.pushUndo();
  const deg = 60 + Math.random() * 240;
  const tmp = document.createElement('canvas');
  tmp.width = painter.W;
  tmp.height = painter.H;
  const tctx = tmp.getContext('2d');
  tctx.filter = `hue-rotate(${deg}deg)`;
  tctx.drawImage(painter.art, 0, 0);
  painter.actx.clearRect(0, 0, painter.W, painter.H);
  painter.actx.drawImage(tmp, 0, 0);
  // rotate the background hue too
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = painter.bg;
  const hex = probe.fillStyle;
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0;
  const l = (mx + mn) / 2, dlt = mx - mn;
  const s = dlt === 0 ? 0 : dlt / (1 - Math.abs(2 * l - 1));
  if (dlt > 0) {
    if (mx === r) h = ((g - b) / dlt) % 6;
    else if (mx === g) h = (b - r) / dlt + 2;
    else h = (r - g) / dlt + 4;
    h *= 60;
  }
  painter.bg = `hsl(${(h + deg) % 360}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  painter.dirty = true;
}
