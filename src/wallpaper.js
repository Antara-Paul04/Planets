// A phone wallpaper of a planet: 1080x1920, the world as a lit coin in the
// upper half (clear of the lock-screen clock), its name, the line, the song,
// and its address small at the bottom. Drawn entirely in the browser from the
// artwork canvas the renderer already holds -- nothing is fetched.
//
// Saving: the native share sheet where it exists (phones: "Save Image"),
// otherwise a download.

const W = 1080;
const H = 1920;

function coin(ctx, artwork, cx, cy, r) {
  // atmosphere
  const glow = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.5);
  glow.addColorStop(0, 'rgba(150,180,255,0.30)');
  glow.addColorStop(1, 'rgba(150,180,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, 7); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
  ctx.fillStyle = '#12162a';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (artwork) {
    // the middle of the equirectangular art, least distorted
    const sw = artwork.width * 0.5;
    ctx.drawImage(artwork, artwork.width * 0.25, 0, sw, artwork.height, cx - r, cy - r, r * 2, r * 2);
  }
  // terminator, lit upper-left
  const term = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r * 1.05);
  term.addColorStop(0, 'rgba(0,0,0,0)');
  term.addColorStop(0.6, 'rgba(0,0,0,0.12)');
  term.addColorStop(1, 'rgba(0,0,0,0.66)');
  ctx.fillStyle = term;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,240,214,0.32)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r - 1.5, Math.PI * 1.05, Math.PI * 1.85); ctx.stroke();
}

function wrap(ctx, text, maxWidth, maxLines = 3) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; } else line = t;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

const TECH = '"IBM Plex Sans Condensed", "Roboto Condensed", ui-sans-serif, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

// planet: { name, message, song, artwork (canvas|image), sealed, revealAt }
export function renderWallpaper(planet, { origin = window.location.origin, slug = '' } = {}) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  x.fillStyle = '#0a0d1c'; x.fillRect(0, 0, W, H);
  const vg = x.createRadialGradient(W * 0.5, H * 0.36, 80, W * 0.5, H * 0.36, H * 0.55);
  vg.addColorStop(0, 'rgba(40,52,96,0.42)'); vg.addColorStop(1, 'rgba(10,13,28,0)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    const sx = (i * 137.5 + 31) % W, sy = (i * 89.3 + 17) % H, s = 1 + (i % 3);
    x.globalAlpha = 0.14 + (i % 5) * 0.08;
    x.fillStyle = '#fff'; x.fillRect(sx, sy, s, s);
  }
  x.globalAlpha = 1;

  // corner ticks
  x.strokeStyle = '#ff7a2f'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(72, 110); x.lineTo(72, 72); x.lineTo(110, 72); x.stroke();
  x.beginPath(); x.moveTo(W - 72, H - 110); x.lineTo(W - 72, H - 72); x.lineTo(W - 110, H - 72); x.stroke();

  coin(x, planet.artwork, W / 2, H * 0.40, 300);

  x.textAlign = 'center';
  x.fillStyle = '#ff7a2f';
  x.font = `500 26px ${MONO}`;
  const kicker = planet.sealed ? 'SEALED · MADE FOR SOMEONE' : (planet.message || planet.song) ? 'SOMEONE MADE THIS FOR YOU' : 'A PLANET IN ASTRAY';
  x.fillText(kicker.split('').join(' '), W / 2, H * 0.40 + 300 + 120);

  x.fillStyle = '#f2f4f8';
  const name = (planet.name || 'a planet').toUpperCase();
  let size = name.length > 16 ? 72 : name.length > 10 ? 92 : 112;
  x.font = `600 ${size}px ${TECH}`;
  while (x.measureText(name).width > W - 180 && size > 48) { size -= 4; x.font = `600 ${size}px ${TECH}`; }
  let y = H * 0.40 + 300 + 120 + 40 + size;
  x.fillText(name, W / 2, y);

  x.fillStyle = 'rgba(244,241,232,0.9)';
  x.font = `italic 44px ${SERIF}`;
  const line = planet.sealed
    ? `opens ${new Date(planet.revealAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
    : planet.message ? `“${planet.message}”` : '';
  if (line) {
    y += 78;
    for (const l of wrap(x, line, W - 200, 3)) { x.fillText(l, W / 2, y); y += 56; }
  }
  if (!planet.sealed && planet.song) {
    y += 40;
    x.fillStyle = 'rgba(230,232,236,0.62)';
    x.font = `500 24px ${MONO}`;
    const t = (planet.song.title || 'a song').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').trim().slice(0, 44);
    x.fillText(`♪  ${t.toUpperCase()}`, W / 2, y);
  }

  x.fillStyle = 'rgba(230,232,236,0.4)';
  x.font = `400 24px ${MONO}`;
  x.fillText(`${origin.replace(/^https?:\/\//, '')}/p/${slug}`, W / 2, H - 120);
  return c;
}

export async function saveWallpaper(planet, opts = {}) {
  const canvas = renderWallpaper(planet, opts);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const filename = `${(planet.name || 'planet').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-wallpaper.png`;
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: planet.name });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
