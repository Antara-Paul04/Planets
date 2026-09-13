import { SongPlayer } from '../song.js';
import { slugForName, songUrl } from '../../lib/song.js';

// The arrival: what a visitor sees once the flight to a planet has settled.
// One quiet panel at the bottom of the instrument HUD -- the line the maker
// left, a play control for the planet's song, the planet's own link, and a
// way to make one back. It appears only for planets that carry something
// (a song or a message) or when the visitor arrived by the planet's link.
//
// The song never starts on its own. The player (and every third-party byte)
// exists only after the visitor taps play, and is torn down on leaving.

const REPORT_REASONS = ['spam', 'hateful', 'someone’s private info', 'not for kids', 'other'];

export function createArrival({ onMakeOne, onSongState, onWallpaper, onReveal, onReport }) {
  const el = document.createElement('div');
  el.id = 'arrival';
  el.innerHTML = `
    <div class="arr-inner">
      <div class="arr-kicker"></div>
      <div class="arr-seal" hidden>
        <div class="arr-seal-count"></div>
        <div class="arr-seal-sub"></div>
      </div>
      <div class="arr-message"></div>
      <div class="arr-now" hidden>
        <span class="arr-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="arr-title"></span>
      </div>
      <div class="arr-actions">
        <button class="arr-play btn-primary"></button>
        <button class="arr-voice btn-primary" hidden>▶ hear their voice</button>
        <button class="arr-link btn-ghost">copy its link</button>
        <button class="arr-wall btn-ghost">wallpaper</button>
        <button class="arr-make btn-ghost">make one back</button>
      </div>
      <div class="arr-player" aria-hidden="true"></div>
      <div class="arr-foot"></div>
      <button class="arr-report" type="button">report this planet</button>
      <div class="arr-report-box" hidden>
        <div class="arr-report-reasons">${REPORT_REASONS.map((r) => `<button type="button" class="chip arr-reason" data-value="${r}">${r}</button>`).join('')}</div>
        <input class="arr-report-text" maxlength="200" autocomplete="off" placeholder="anything else? (optional)" />
        <div class="arr-report-actions">
          <button type="button" class="arr-report-send btn-primary">send report</button>
          <button type="button" class="arr-report-cancel btn-ghost">cancel</button>
        </div>
        <p class="arr-report-note">three different networks reporting a planet hide it. the project owner also sees every report and can act sooner.</p>
      </div>
    </div>`;
  document.body.appendChild(el);

  const $ = (s) => el.querySelector(s);
  const kicker = $('.arr-kicker');
  const message = $('.arr-message');
  const playBtn = $('.arr-play');
  const linkBtn = $('.arr-link');
  const makeBtn = $('.arr-make');
  const foot = $('.arr-foot');
  const mount = $('.arr-player'); // audio only: kept off-screen, never a video
  const now = $('.arr-now');
  const titleEl = $('.arr-title');
  const sealEl = $('.arr-seal');
  const sealCount = $('.arr-seal-count');
  const sealSub = $('.arr-seal-sub');
  const voiceBtn = $('.arr-voice');
  const wallBtn = $('.arr-wall');
  const reportBtn = $('.arr-report');
  const reportBox = $('.arr-report-box');
  const reportText = $('.arr-report-text');
  const reportSend = $('.arr-report-send');
  let reportReason = null;
  let watchdog = null;
  let sealTimer = null;
  let voiceEl = null; // an <audio> for the voice line, created on tap

  let planet = null;
  let mode = 'click';

  const player = new SongPlayer({
    mount,
    onState: (state) => {
      el.dataset.song = state;
      // a provider that never answers should not leave the button on "tuning in…"
      clearTimeout(watchdog);
      if (state === 'loading') watchdog = setTimeout(() => { if (player.state === 'loading') player.stop(); playBtn.textContent = 'the song won’t play here'; el.dataset.song = 'error'; foot.innerHTML = openElsewhere(planet); }, 14000);
      if (planet && planet.song) {
        playBtn.textContent = ({
          idle: '♪ play their song',
          loading: 'tuning in…',
          playing: '❚❚ pause',
          paused: '▶ resume',
          ended: '♪ play it again',
          error: 'the song won’t play here',
        })[state] || '♪ play their song';
        if (state === 'error') foot.innerHTML = openElsewhere(planet);
        else foot.textContent = footLine(planet, state);
      }
      if (onSongState) onSongState(state);
    },
  });

  function footLine(p, state) {
    if (!p.song) return '';
    const where = p.song.provider === 'spotify' ? 'spotify' : 'youtube';
    if (state === 'idle' || state === 'ended') return `audio only, via ${where} · nothing loads until you press play`;
    if (state === 'playing' && p.song.provider === 'spotify') return 'a 30s preview unless you’re signed into spotify in this browser';
    if (state === 'playing' || state === 'paused') return `via ${where}`;
    return '';
  }
  function openElsewhere(p) {
    if (!p || !p.song) return '';
    return `open it on <a href="${songUrl(p.song)}" target="_blank" rel="noopener noreferrer">${p.song.provider}</a> instead`;
  }
  function songLabel(p) {
    if (!p.song || !p.song.title) return 'their song';
    return p.song.title
      .replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|remaster|hd|4k|visuali[sz]er|mv)[^\)\]]*[\)\]]/gi, '')
      .replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim() || p.song.title;
  }

  function linkFor(p) {
    return `${window.location.origin}/p/${slugForName(p.name)}`;
  }

  playBtn.addEventListener('click', () => {
    if (!planet || !planet.song) return;
    if (player.state === 'idle' || player.state === 'ended' || player.state === 'error') player.play(planet.song);
    else player.toggle();
  });

  linkBtn.addEventListener('click', async () => {
    if (!planet) return;
    const url = linkFor(planet);
    const prev = linkBtn.textContent;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: planet.name, text: planet.message ? `“${planet.message}”` : `${planet.name}, a planet`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      linkBtn.textContent = 'copied ✓';
    } catch {
      linkBtn.textContent = url.replace(/^https?:\/\//, '');
    }
    setTimeout(() => { linkBtn.textContent = prev; }, 1800);
  });

  makeBtn.addEventListener('click', () => { if (onMakeOne) onMakeOne(planet); });

  // ---- reporting: a reason, one tap, the owner hears about it ----
  function resetReport() {
    reportBox.hidden = true;
    reportReason = null;
    reportText.value = '';
    el.querySelectorAll('.arr-reason').forEach((b) => { b.dataset.on = ''; });
    reportSend.disabled = false;
    reportSend.textContent = 'send report';
    reportBtn.hidden = false;
  }
  function openReportBox() {
    reportBox.hidden = false;
    reportBtn.hidden = true;
  }
  reportBtn.addEventListener('click', openReportBox);
  $('.arr-report-cancel').addEventListener('click', resetReport);
  el.querySelectorAll('.arr-reason').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('.arr-reason').forEach((x) => { x.dataset.on = x === b ? '1' : ''; });
    reportReason = b.dataset.value;
  }));
  reportSend.addEventListener('click', async () => {
    if (!planet || !onReport) return;
    const extra = reportText.value.replace(/\s+/g, ' ').trim();
    const reason = [reportReason, extra].filter(Boolean).join(' · ').slice(0, 200) || null;
    reportSend.disabled = true;
    reportSend.textContent = 'sending…';
    const out = await onReport(planet, reason);
    if (out && out.ok) {
      reportSend.textContent = 'reported · thanks';
      setTimeout(() => { if (el.classList.contains('show')) resetReport(); }, 1600);
    } else {
      reportSend.disabled = false;
      reportSend.textContent = 'try again in a moment';
    }
  });

  wallBtn.addEventListener('click', async () => {
    if (!planet || !onWallpaper) return;
    const prev = wallBtn.textContent;
    wallBtn.textContent = 'making it…';
    try { const r = await onWallpaper(planet); wallBtn.textContent = r === 'downloaded' ? 'saved ✓' : prev; }
    catch { wallBtn.textContent = prev; }
    setTimeout(() => { wallBtn.textContent = prev; }, 1600);
  });

  // ---- the voice line: a plain <audio>, created on tap, gone on leaving ----
  function stopVoice() {
    if (voiceEl) { voiceEl.onended = null; voiceEl.onerror = null; voiceEl.pause(); voiceEl.removeAttribute('src'); voiceEl.load(); voiceEl = null; }
    voiceBtn.textContent = '▶ hear their voice';
    el.dataset.voice = 'idle';
    if (onSongState) onSongState(player.state);
  }
  voiceBtn.addEventListener('click', () => {
    if (!planet || !planet.voiceUrl) return;
    if (voiceEl && !voiceEl.paused) { stopVoice(); return; }
    if (player.state === 'playing') player.toggle(); // one voice at a time
    voiceEl = new Audio(planet.voiceUrl);
    voiceEl.preload = 'auto';
    el.dataset.voice = 'playing';
    voiceBtn.textContent = '■ stop';
    if (onSongState) onSongState('playing'); // duck the soundscape the same way
    voiceEl.onended = stopVoice;
    voiceEl.onerror = () => { stopVoice(); voiceBtn.textContent = 'their voice won’t play here'; };
    voiceEl.play().catch(() => { stopVoice(); voiceBtn.textContent = 'their voice won’t play here'; });
  });

  // ---- sealed: count down to the moment, then ask the app to open it ----
  function fmtLeft(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }
  function tickSeal() {
    if (!planet || !planet.sealed) return;
    const left = Date.parse(planet.revealAt) - Date.now();
    if (left > 0) { sealCount.textContent = `opens in ${fmtLeft(left)}`; return; }
    clearInterval(sealTimer);
    sealCount.textContent = 'opening…';
    const p = planet;
    (onReveal ? onReveal(p) : Promise.resolve(false)).then((opened) => {
      if (planet !== p) return;
      if (opened) show(p, { mode: mode });
      else { sealCount.textContent = 'opens any moment now'; sealTimer = setTimeout(tickSeal, 15000); }
    });
  }

  // show the panel for a planet. mode: 'link' (arrived by its address) | 'click'
  // report: open with the report box already out (the label's report link)
  function show(p, { mode: m = 'click', report = false } = {}) {
    if (planet && planet !== p) player.stop();
    if (planet !== p) resetReport();
    planet = p;
    mode = m;
    const sealed = !!p.sealed && !p.mine;
    const hasSong = !sealed && !!p.song;
    const hasMsg = !sealed && !!p.message;
    const hasVoice = !sealed && !!p.voiceUrl;
    if (!report && !sealed && !hasSong && !hasMsg && !hasVoice && m !== 'link') { hide(); return; }
    reportBtn.hidden = !!p.mine; // you don't report your own world
    if (report) openReportBox();

    clearInterval(sealTimer);
    stopVoice();
    sealEl.hidden = !sealed;
    if (sealed) {
      const waiting = [p.hasMessage && 'a line', p.hasSong && 'a song', p.hasVoice && 'a voice'].filter(Boolean);
      sealSub.textContent = waiting.length ? `${waiting.join(', ')} waiting inside` : 'something is waiting inside';
      tickSeal();
      sealTimer = setInterval(tickSeal, 1000);
    }

    const carried = [hasMsg && 'a line', hasSong && 'a song', hasVoice && 'a voice'].filter(Boolean);
    kicker.textContent = sealed
      ? 'sealed · made for someone'
      : m === 'link'
        ? (carried.length ? 'someone made this for you' : 'you were sent here')
        : (carried.length ? carried.join(' and ') : 'a planet');
    if (p.mine && p.revealAt && Date.parse(p.revealAt) > Date.now()) {
      kicker.textContent = `yours · sealed for everyone else until ${new Date(p.revealAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;
    }
    message.textContent = hasMsg ? `“${p.message}”` : '';
    message.hidden = !hasMsg;
    voiceBtn.hidden = !hasVoice;
    playBtn.hidden = !hasSong;
    now.hidden = !hasSong;
    titleEl.textContent = hasSong ? songLabel(p) : '';
    if (hasSong && player.state === 'idle') playBtn.textContent = '♪ play their song';
    foot.textContent = footLine(p, player.state);
    foot.hidden = !hasSong;
    el.dataset.song = player.state;
    el.dataset.provider = hasSong ? p.song.provider : '';
    el.dataset.mode = m;
    el.dataset.sealed = sealed ? '1' : '';
    el.classList.add('show');
  }

  function hide() {
    el.classList.remove('show');
    resetReport();
    clearInterval(sealTimer);
    stopVoice();
    player.stop();
    planet = null;
  }

  return {
    show, hide, player,
    openReport: (p) => show(p, { mode: 'click', report: true }),
    isOpen: () => el.classList.contains('show'),
    current: () => planet,
    // the universe should not drift into its screensaver while someone is
    // reading what was left for them, or while their song is playing
    holds: () => el.classList.contains('show') && (mode === 'link' || player.playing || player.state === 'loading' || !!(voiceEl && !voiceEl.paused)),
  };
}
