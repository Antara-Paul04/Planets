// Plays a planet's song on arrival. Two providers, one interface.
//
// Privacy contract: NOTHING from Spotify or YouTube is loaded until the
// visitor taps play on that planet. The provider script and the player iframe
// are created inside that tap, and destroyed the moment the planet is left.
// A tap is also what browsers need before an iframe may make sound: the top
// page's sticky user activation is delegated to the iframe via allow="autoplay".
//
// Spotify plays the full track only for visitors signed into Spotify in this
// browser; everyone else hears a 30-second preview. YouTube plays the whole
// thing for anyone. Both start at song.start when the provider allows seeking.

const YT_API = 'https://www.youtube.com/iframe_api';
const SP_API = 'https://open.spotify.com/embed/iframe-api/v1';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { existing.dataset.loaded ? resolve() : existing.addEventListener('load', () => resolve(), { once: true }); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('provider script failed'));
    document.head.appendChild(s);
  });
}

let ytReady = null;
function youtubeAPI() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    loadScript(YT_API).catch(reject);
  });
  return ytReady;
}

let spReady = null;
function spotifyAPI() {
  if (spReady) return spReady;
  spReady = new Promise((resolve, reject) => {
    if (window.__spotifyIframeAPI) { resolve(window.__spotifyIframeAPI); return; }
    const prev = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => { window.__spotifyIframeAPI = api; if (prev) prev(api); resolve(api); };
    loadScript(SP_API).catch(reject);
  });
  return spReady;
}

export class SongPlayer {
  // mount: the element the (small, visible) player lives in
  // onState: (state) => {} with 'loading' | 'playing' | 'paused' | 'ended' | 'error'
  constructor({ mount, onState }) {
    this.mount = mount;
    this.onState = onState || (() => {});
    this.song = null;
    this._yt = null;
    this._sp = null;
    this._gen = 0;
    this.state = 'idle';
  }

  _set(state) {
    this.state = state;
    this.onState(state, this.song);
  }

  get playing() { return this.state === 'playing'; }

  async play(song) {
    if (!song) return;
    this.stop();
    const gen = ++this._gen;
    this.song = song;
    this._set('loading');
    try {
      if (song.provider === 'youtube') await this._playYouTube(song, gen);
      else if (song.provider === 'spotify') await this._playSpotify(song, gen);
      else this._set('error');
    } catch {
      if (gen === this._gen) this._set('error');
    }
  }

  async _playYouTube(song, gen) {
    const YT = await youtubeAPI();
    if (gen !== this._gen) return;
    const host = document.createElement('div');
    this.mount.replaceChildren(host);
    this._yt = new YT.Player(host, {
      videoId: song.id,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1, start: song.start || 0, playsinline: 1,
        controls: 1, rel: 0, modestbranding: 1, iv_load_policy: 3,
        origin: window.location.origin,
      },
      events: {
        onReady: (e) => { if (gen === this._gen) e.target.playVideo(); },
        onStateChange: (e) => {
          if (gen !== this._gen) return;
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) this._set('playing');
          else if (e.data === S.PAUSED) this._set('paused');
          else if (e.data === S.ENDED) this._set('ended');
        },
        onError: () => { if (gen === this._gen) this._set('error'); },
      },
    });
  }

  async _playSpotify(song, gen) {
    const api = await spotifyAPI();
    if (gen !== this._gen) return;
    const host = document.createElement('div');
    this.mount.replaceChildren(host);
    await new Promise((resolve) => {
      api.createController(host, { uri: `spotify:track:${song.id}`, width: '100%', height: 80, theme: 'dark' }, (controller) => {
        if (gen !== this._gen) { try { controller.destroy(); } catch { /* fine */ } resolve(); return; }
        this._sp = controller;
        controller.addListener('ready', () => {
          if (gen !== this._gen) return;
          controller.play();
          if (song.start) setTimeout(() => { if (gen === this._gen) { try { controller.seek(song.start); } catch { /* preview clips can't seek */ } } }, 600);
        });
        controller.addListener('playback_update', (e) => {
          if (gen !== this._gen || !e || !e.data) return;
          const d = e.data;
          if (d.isPaused === false) this._set('playing');
          else if (d.position > 0 && d.duration > 0 && d.position >= d.duration - 300) this._set('ended');
          else if (d.isPaused) this._set(this.state === 'loading' ? 'loading' : 'paused');
        });
        controller.addListener('error', () => { if (gen === this._gen) this._set('error'); });
        resolve();
      });
    });
  }

  toggle() {
    if (this._yt && this._yt.getPlayerState) {
      const S = window.YT && window.YT.PlayerState;
      if (S && this._yt.getPlayerState() === S.PLAYING) this._yt.pauseVideo(); else this._yt.playVideo();
    } else if (this._sp) {
      this._sp.togglePlay();
    }
  }

  // leaving the planet: the song, the iframe and every provider handle go away
  stop() {
    this._gen++;
    if (this._yt) { try { this._yt.destroy(); } catch { /* fine */ } this._yt = null; }
    if (this._sp) { try { this._sp.destroy(); } catch { /* fine */ } this._sp = null; }
    this.mount.replaceChildren();
    if (this.state !== 'idle') { this.song = null; this._set('idle'); }
  }
}
