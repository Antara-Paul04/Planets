// Tiny hand-drawn stamps. Each draws centered at (0,0), roughly s wide,
// with deliberate wobble so nothing looks like a system emoji.

const wob = (v, amt) => v + (Math.random() - 0.5) * amt;

function inkSetup(ctx, s, color) {
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

export const STAMPS = {
  star(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2, ri = r * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rad = wob(i % 2 === 0 ? r : ri, s * 0.06);
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.globalAlpha *= 0.9;
    ctx.fill();
  },

  heart(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.75);
    ctx.bezierCurveTo(wob(-r * 1.15, s * 0.08), r * 0.05, -r * 0.75, -r * 0.85, 0, wob(-r * 0.28, s * 0.06));
    ctx.bezierCurveTo(r * 0.75, -r * 0.85, wob(r * 1.15, s * 0.08), r * 0.05, 0, r * 0.75);
    ctx.fill();
  },

  moon(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI * 0.32, Math.PI * 1.68);
    ctx.arc(r * 0.55, 0, r * 0.72, Math.PI * 1.55, Math.PI * 0.45, true);
    ctx.closePath();
    ctx.fill();
  },

  sun(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s * 0.28;
    ctx.beginPath();
    ctx.arc(0, 0, wob(r, s * 0.04), 0, 7);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + wob(0, 0.2);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
      ctx.lineTo(Math.cos(a) * wob(s * 0.5, s * 0.1), Math.sin(a) * wob(s * 0.5, s * 0.1));
      ctx.stroke();
    }
  },

  flower(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s * 0.32;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + wob(0, 0.25);
      ctx.save();
      ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, wob(r * 0.75, s * 0.05), r * 0.45, 0, 0, 7);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#f5f1e8';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, 7);
    ctx.fill();
  },

  cloud(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s * 0.22;
    ctx.beginPath();
    ctx.arc(-r * 1.4, r * 0.4, wob(r, s * 0.04), 0, 7);
    ctx.arc(-r * 0.3, -r * 0.35, wob(r * 1.25, s * 0.05), 0, 7);
    ctx.arc(r * 1.1, r * 0.25, wob(r * 1.05, s * 0.05), 0, 7);
    ctx.arc(0, r * 0.55, r * 1.15, 0, 7);
    ctx.fill();
  },

  lightning(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.beginPath();
    ctx.moveTo(wob(-r * 0.1, 2), -r);
    ctx.lineTo(r * 0.35, -r * 0.15);
    ctx.lineTo(r * 0.05, -r * 0.05);
    ctx.lineTo(wob(r * 0.25, 2), r);
    ctx.lineTo(-r * 0.3, r * 0.05);
    ctx.lineTo(-r * 0.02, -r * 0.12);
    ctx.closePath();
    ctx.fill();
  },

  sparkle(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(wob(r * 0.12, 2), wob(-r * 0.12, 2), r, 0);
    ctx.quadraticCurveTo(r * 0.12, r * 0.12, 0, r);
    ctx.quadraticCurveTo(-r * 0.12, r * 0.12, -r, 0);
    ctx.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r);
    ctx.fill();
  },

  eye(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.fillStyle = '#f5f1e8';
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.quadraticCurveTo(0, wob(-r * 0.9, 3), r, 0);
    ctx.quadraticCurveTo(0, wob(r * 0.9, 3), -r, 0);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(wob(0, 3), 0, r * 0.34, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#1d2030';
    ctx.beginPath();
    ctx.arc(wob(0, 2), 0, r * 0.15, 0, 7);
    ctx.fill();
  },

  smiley(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.beginPath();
    ctx.arc(0, 0, wob(r, s * 0.03), 0, 7);
    ctx.fill();
    ctx.strokeStyle = '#1d2030';
    ctx.fillStyle = '#1d2030';
    ctx.beginPath();
    ctx.arc(-r * 0.32, -r * 0.2, r * 0.09, 0, 7);
    ctx.arc(r * 0.32, -r * 0.2, r * 0.09, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, r * 0.1, r * 0.45, 0.25, Math.PI - 0.25);
    ctx.stroke();
  },

  planet(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s * 0.32;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.fill();
    ctx.save();
    ctx.rotate(-0.35 + wob(0, 0.15));
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.52, r * 0.42, 0, 0, 7);
    ctx.stroke();
    ctx.restore();
  },

  alien(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, wob(r * 0.85, 3), 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#1d2030';
    ctx.beginPath();
    ctx.ellipse(-r * 0.24, -r * 0.1, r * 0.16, r * 0.28, 0.35, 0, 7);
    ctx.ellipse(r * 0.24, -r * 0.1, r * 0.16, r * 0.28, -0.35, 0, 7);
    ctx.fill();
  },

  ufo(ctx, s, color) {
    inkSetup(ctx, s, color);
    const r = s / 2;
    ctx.beginPath();
    ctx.arc(0, -r * 0.18, r * 0.34, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, wob(0, 2), r, r * 0.3, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#f5f1e8';
    for (const x of [-r * 0.5, 0, r * 0.5]) {
      ctx.beginPath();
      ctx.arc(x, r * 0.08, r * 0.07, 0, 7);
      ctx.fill();
    }
  },
};

export const STAMP_NAMES = Object.keys(STAMPS);

export function stampIcon(name, color = '#e8e2d0') {
  const c = document.createElement('canvas');
  c.width = c.height = 30;
  const ctx = c.getContext('2d');
  ctx.translate(15, 15);
  STAMPS[name](ctx, 22, color);
  return c;
}
