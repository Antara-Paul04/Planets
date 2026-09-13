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

export function createArrival({ onMakeOne, onSongState }) {
  const el = document.createElement('div');
  el.id = 'arrival';
  el.innerHTML = `
    <div class="arr-inner">
      <div class="arr-kicker"></div>
      <div class="arr-message"></div>
      <div class="arr-now" hidden>
        <span class="arr-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="arr-title"></span>
      </div>
      <div class="arr-actions">
        <button class="arr-play btn-primary"></button>
        <button class="arr-link btn-ghost">copy its link</button>
        <button class="arr-make btn-ghost">make one back</button>
      </div>
      <div class="arr-player" aria-hidden="true"></div>
      <div class="arr-foot"></div>
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
  let watchdog = null;

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
    return (p.song && p.song.title) ? p.song.title : 'their song';
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

  // show the panel for a planet. mode: 'link' (arrived by its address) | 'click'
  function show(p, { mode: m = 'click' } = {}) {
    if (planet && planet !== p) player.stop();
    planet = p;
    mode = m;
    const hasSong = !!p.song;
    const hasMsg = !!p.message;
    if (!hasSong && !hasMsg && m !== 'link') { hide(); return; }

    kicker.textContent = m === 'link'
      ? (hasMsg || hasSong ? 'someone made this for you' : 'you were sent here')
      : (hasMsg && hasSong ? 'a song and a line' : hasSong ? 'this planet has a song' : 'a line was left here');
    message.textContent = hasMsg ? `“${p.message}”` : '';
    message.hidden = !hasMsg;
    playBtn.hidden = !hasSong;
    now.hidden = !hasSong;
    titleEl.textContent = hasSong ? songLabel(p) : '';
    if (hasSong && player.state === 'idle') playBtn.textContent = '♪ play their song';
    foot.textContent = footLine(p, player.state);
    foot.hidden = !hasSong;
    el.dataset.song = player.state;
    el.dataset.provider = hasSong ? p.song.provider : '';
    el.dataset.mode = m;
    el.classList.add('show');
  }

  function hide() {
    el.classList.remove('show');
    player.stop();
    planet = null;
  }

  return {
    show, hide, player,
    isOpen: () => el.classList.contains('show'),
    current: () => planet,
    // the universe should not drift into its screensaver while someone is
    // reading what was left for them, or while their song is playing
    holds: () => el.classList.contains('show') && (mode === 'link' || player.playing || player.state === 'loading'),
  };
}
