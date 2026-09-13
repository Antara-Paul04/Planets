// Server-only: the song's title, fetched ONCE at creation through the
// providers' public oEmbed endpoints and stored with the planet, so the arrival
// panel can say what is playing without the visitor's browser asking Spotify
// or YouTube anything. The request carries only the bare track/video id.
// Any failure -> null; a planet never fails to launch because of a title.

import { songUrl } from './song.js';

export const MAX_TITLE_CHARS = 120;

export function oembedUrl(song) {
  const target = songUrl(song);
  if (!target) return null;
  return song.provider === 'spotify'
    ? `https://open.spotify.com/oembed?url=${encodeURIComponent(target)}`
    : `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;
}

export function cleanTitle(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
  return s || null;
}

export async function fetchSongTitle(song, { fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  const url = song ? oembedUrl(song) : null;
  if (!url || typeof fetchImpl !== 'function') return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { signal: ctl ? ctl.signal : undefined, headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object') return null;
    const title = cleanTitle(json.title);
    if (!title) return null;
    // youtube titles usually carry the artist; spotify's oEmbed gives the track name only
    const by = song.provider === 'youtube' ? null : cleanTitle(json.author_name);
    return by && !title.toLowerCase().includes(by.toLowerCase()) ? `${title} — ${by}` : title;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
