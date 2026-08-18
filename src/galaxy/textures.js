// Procedural surface painting for the seeded planets.
// Small canvases on purpose: 256x128 is plenty once wrapped, lit and moving.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 256;
const H = 128;
const WRAPS = [-W, 0, W]; // draw features thrice so the texture tiles horizontally

export function averageColor(canvas) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d');
  x.drawImage(canvas, 0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return (d[0] << 16) | (d[1] << 8) | d[2];
}

export function generatePlanetTexture(rand) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const hue = rand() * 360;
  const sat = 30 + rand() * 55;
  const light = 30 + rand() * 42;
  const hsl = (h, s, l, a = 1) =>
    `hsla(${(((h % 360) + 360) % 360).toFixed(1)}, ${Math.max(0, Math.min(100, s)).toFixed(1)}%, ${Math.max(0, Math.min(96, l)).toFixed(1)}%, ${a})`;

  // secondary color family — sometimes adjacent, sometimes a playful clash
  const hue2 = hue + (rand() < 0.3 ? 120 + rand() * 120 : (rand() - 0.5) * 70);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hsl(hue + rand() * 30 - 15, sat, light + 10));
  g.addColorStop(1, hsl(hue2, sat * 0.85, Math.max(14, light - 8)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const styles = ['bands', 'blotch', 'speckle', 'swirl', 'barren'];
  const style = styles[Math.floor(rand() * styles.length)];

  if (style === 'bands') {
    ctx.filter = 'blur(1.5px)';
    let y = 0;
    while (y < H) {
      const bh = 4 + rand() * 18;
      ctx.fillStyle = hsl((rand() < 0.4 ? hue2 : hue) + (rand() - 0.5) * 40, sat + (rand() - 0.5) * 20, light + (rand() - 0.5) * 34, 0.22 + rand() * 0.35);
      ctx.fillRect(0, y, W, bh);
      y += bh;
    }
    ctx.filter = 'none';
  } else if (style === 'blotch') {
    ctx.filter = 'blur(2.5px)';
    const n = 14 + Math.floor(rand() * 22);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = hsl((rand() < 0.4 ? hue2 : hue) + (rand() - 0.5) * 60, sat + (rand() - 0.5) * 30, light + (rand() - 0.5) * 42, 0.2 + rand() * 0.4);
      const x = rand() * W, y = rand() * H;
      const rx = 8 + rand() * 55, ry = 5 + rand() * 25, rot = rand() * Math.PI;
      for (const dx of WRAPS) {
        ctx.beginPath();
        ctx.ellipse(x + dx, y, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.filter = 'none';
  } else if (style === 'speckle') {
    const n = 250 + Math.floor(rand() * 450);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = hsl((rand() < 0.3 ? hue2 : hue) + (rand() - 0.5) * 50, sat, light + (rand() - 0.5) * 55, 0.3 + rand() * 0.5);
      ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 2.5, 1 + rand() * 2.5);
    }
  } else if (style === 'swirl') {
    ctx.filter = 'blur(1px)';
    ctx.lineCap = 'round';
    const n = 10 + Math.floor(rand() * 14);
    for (let i = 0; i < n; i++) {
      ctx.strokeStyle = hsl((rand() < 0.4 ? hue2 : hue) + (rand() - 0.5) * 50, sat, light + (rand() - 0.5) * 35, 0.25 + rand() * 0.35);
      ctx.lineWidth = 2 + rand() * 5;
      const cx = rand() * W, cy = rand() * H;
      const r = 6 + rand() * 30, a0 = rand() * Math.PI * 2, len = 1 + rand() * 3;
      for (const dx of WRAPS) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy, r, a0, a0 + len);
        ctx.stroke();
      }
    }
    ctx.filter = 'none';
  } else {
    // barren: cratered, quiet — little rocks are allowed to stay simple
    const n = 6 + Math.floor(rand() * 10);
    for (let i = 0; i < n; i++) {
      const cx = rand() * W, cy = rand() * H, r = 3 + rand() * 12;
      for (const dx of WRAPS) {
        ctx.fillStyle = hsl(hue, sat * 0.5, Math.max(8, light - 14), 0.55);
        ctx.beginPath();
        ctx.arc(cx + dx, cy, r, 0, 7);
        ctx.fill();
        ctx.fillStyle = hsl(hue, sat * 0.5, light + 16, 0.32);
        ctx.beginPath();
        ctx.arc(cx + dx - r * 0.25, cy - r * 0.25, r * 0.72, 0, 7);
        ctx.fill();
      }
    }
  }

  if (rand() < 0.25) {
    ctx.filter = 'blur(3px)';
    ctx.fillStyle = hsl(hue, 14, 90, 0.5 + rand() * 0.3);
    ctx.fillRect(0, -4, W, 10 + rand() * 10);
    ctx.fillRect(0, H - (6 + rand() * 10), W, 20);
    ctx.filter = 'none';
  }

  for (let i = 0; i < 350; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }

  return canvas;
}
