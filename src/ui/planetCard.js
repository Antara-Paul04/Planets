// A small collectible card shown after you create a planet: a lit "coin" of
// your world, its name, its birth date, and a share action. No links, no ids —
// just a beautiful thing to screenshot and pass around. The discovery loop is:
// make one -> share the card -> a friend searches its name -> travels to it.

export function createPlanetCard() {
  const overlay = document.createElement('div');
  overlay.id = 'planet-card';
  overlay.innerHTML = `
    <div class="card-inner">
      <div class="card-mark">&#10022; your planet &#10022;</div>
      <div class="card-coin"></div>
      <div class="card-name"></div>
      <div class="card-born"></div>
      <div class="card-where">somewhere in the universe</div>
      <div class="card-actions">
        <button class="card-share btn-primary">share</button>
        <button class="card-done btn-ghost">done</button>
      </div>
      <div class="card-foot">a planet in the universe</div>
    </div>`;
  document.body.appendChild(overlay);

  const coinHolder = overlay.querySelector('.card-coin');
  const shareBtn = overlay.querySelector('.card-share');
  const doneBtn = overlay.querySelector('.card-done');
  let current = null;

  function fmtDate(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // draw the world as a lit coin: a face of the artwork, a soft terminator,
  // and an atmospheric rim — reads as a little planet, not a flat sticker.
  function renderCoin(artwork, size = 240) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size * 0.4;

    // outer glow
    const glow = x.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.45);
    glow.addColorStop(0, 'rgba(150,180,255,0.28)');
    glow.addColorStop(1, 'rgba(150,180,255,0)');
    x.fillStyle = glow;
    x.beginPath(); x.arc(cx, cy, r * 1.45, 0, 7); x.fill();

    // the planet face
    x.save();
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.clip();
    x.fillStyle = '#12162a';
    x.fillRect(0, 0, size, size);
    if (artwork) {
      // sample the middle third of the equirectangular art (least distorted)
      const sw = artwork.width * 0.5, sh = artwork.height;
      x.drawImage(artwork, artwork.width * 0.25, 0, sw, sh, cx - r, cy - r, r * 2, r * 2);
    }
    // terminator: lit toward the upper-left, falling into shadow
    const term = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r * 1.05);
    term.addColorStop(0, 'rgba(0,0,0,0)');
    term.addColorStop(0.6, 'rgba(0,0,0,0.12)');
    term.addColorStop(1, 'rgba(0,0,0,0.62)');
    x.fillStyle = term;
    x.fillRect(0, 0, size, size);
    x.restore();

    // crisp day-side rim
    x.strokeStyle = 'rgba(255,240,214,0.35)';
    x.lineWidth = 1.5;
    x.beginPath(); x.arc(cx, cy, r - 0.75, Math.PI * 1.05, Math.PI * 1.85); x.stroke();
    return c;
  }

  // compose the whole card as one image — the thing worth screenshotting/sharing
  function renderShareImage(cur) {
    const W = 640, H = 860;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    // background: deep navy with a faint vignette + a few stars
    x.fillStyle = '#0a0d1c'; x.fillRect(0, 0, W, H);
    const vg = x.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, H * 0.7);
    vg.addColorStop(0, 'rgba(40,52,96,0.35)'); vg.addColorStop(1, 'rgba(10,13,28,0)');
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137.5) % W, sy = (i * 89.3) % H, s = (i % 3) * 0.5 + 0.4;
      x.globalAlpha = 0.15 + (i % 5) * 0.08; x.fillRect(sx, sy, s, s);
    }
    x.globalAlpha = 1;

    x.textAlign = 'center';
    x.fillStyle = 'rgba(255,233,201,0.85)';
    x.font = '600 22px Georgia, serif';
    x.fillText('✦  your planet  ✦', W / 2, 92);

    const coin = renderCoin(cur.artwork, 300);
    x.drawImage(coin, W / 2 - 150, 150, 300, 300);

    x.fillStyle = '#f5f1e8';
    x.font = '500 46px Georgia, serif';
    x.fillText(cur.name, W / 2, 520);

    x.fillStyle = 'rgba(240,234,217,0.7)';
    x.font = 'italic 20px Georgia, serif';
    if (cur.createdAt) x.fillText('born ' + fmtDate(cur.createdAt), W / 2, 560);
    x.fillStyle = 'rgba(240,234,217,0.5)';
    x.fillText('somewhere in the universe', W / 2, 594);

    x.fillStyle = 'rgba(240,234,217,0.4)';
    x.font = '14px Georgia, serif';
    x.fillText('a planet in the universe', W / 2, H - 48);
    return c;
  }

  function shareText(cur) {
    return `"${cur.name}" ✦ a planet I made in the universe. Find it in Planets by searching its name.`;
  }

  function flash(msg) {
    const prev = shareBtn.textContent;
    shareBtn.textContent = msg;
    shareBtn.disabled = true;
    setTimeout(() => { shareBtn.textContent = prev; shareBtn.disabled = false; }, 1600);
  }

  async function share() {
    if (!current) return;
    const text = shareText(current);
    // 1) native share of the card image (nicest)
    try {
      const img = renderShareImage(current);
      const blob = await new Promise((r) => img.toBlob(r, 'image/png'));
      if (blob && navigator.canShare) {
        const file = new File([blob], `${current.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'planet'}.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: current.name, text });
          return;
        }
      }
      // 2) native share of text
      if (navigator.share) { await navigator.share({ title: current.name, text }); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user dismissed the share sheet
      // otherwise fall through to copy
    }
    // 3) clipboard fallback
    try { await navigator.clipboard.writeText(text); flash('copied ✓'); }
    catch { flash(current.name); }
  }

  shareBtn.addEventListener('click', share);
  doneBtn.addEventListener('click', () => close());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  function show({ name, createdAt, artworkCanvas }) {
    current = { name, createdAt, artwork: artworkCanvas };
    overlay.querySelector('.card-name').textContent = name;
    const born = overlay.querySelector('.card-born');
    born.textContent = createdAt ? 'born ' + fmtDate(createdAt) : '';
    coinHolder.innerHTML = '';
    coinHolder.appendChild(renderCoin(artworkCanvas));
    overlay.classList.add('open');
  }
  const close = () => overlay.classList.remove('open');
  const isOpen = () => overlay.classList.contains('open');

  return { show, close, isOpen };
}
