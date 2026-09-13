// A planet can carry a song: a Spotify track or a YouTube video, plus the
// second it should start from. Shared by the browser (validating the pasted
// link while the creator types) and the server (the ONLY validation that
// counts). Nothing but these two providers is ever stored, and only the bare
// id -- never the pasted URL, never its tracking parameters.
//
//   parseSongLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x')
//     -> { provider: 'spotify', id: '4uLU6hMCjMI75M1A2tKUQC', start: 0 }
//   parseSongLink('https://youtu.be/dQw4w9WgXcQ?t=1m3s')
//     -> { provider: 'youtube', id: 'dQw4w9WgXcQ', start: 63 }

export const PROVIDERS = ['spotify', 'youtube'];
export const MAX_START_SECONDS = 6 * 60 * 60; // nothing sane starts later than this
export const MAX_MESSAGE_CHARS = 80;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const SP_ID = /^[A-Za-z0-9]{22}$/;

// "1m30s", "90", "90s", "1h2m3s" -> seconds (YouTube's t= grammar)
export function parseStart(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return clampStart(Number(s));
  // "1:23" / "1:02:03" -- what people type
  const colon = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (colon) return clampStart((Number(colon[1] || 0) * 3600) + (Number(colon[2]) * 60) + Number(colon[3]));
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (!m || (m[1] == null && m[2] == null && m[3] == null)) return 0;
  return clampStart((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0));
}

export function clampStart(n) {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_START_SECONDS, Math.floor(n));
}

export function parseSongLink(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text || text.length > 512) return null;

  // spotify:track:<id> URI
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return { provider: 'spotify', id: uri[1], start: 0 };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname;

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    // /track/<id>, /intl-de/track/<id>, /embed/track/<id>
    const m = /\/(?:intl-[a-z]{2}\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})(?:\/|$)/.exec(path);
    if (!m) return null;
    return { provider: 'spotify', id: m[1], start: 0 };
  }

  if (host === 'youtu.be') {
    const id = path.slice(1).split('/')[0];
    if (!YT_ID.test(id)) return null;
    return { provider: 'youtube', id, start: parseStart(url.searchParams.get('t')) };
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    let id = null;
    if (path === '/watch') id = url.searchParams.get('v');
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/.exec(path);
      if (m) id = m[1];
    }
    if (!id || !YT_ID.test(id)) return null;
    const t = url.searchParams.get('t') ?? url.searchParams.get('start');
    return { provider: 'youtube', id, start: parseStart(t) };
  }

  return null;
}

// Server-side gate for whatever the client sent: only a well-formed
// {provider,id,start} survives. Anything else becomes "no song".
export function sanitizeSong(song) {
  if (!song || typeof song !== 'object') return null;
  const provider = song.provider;
  const id = typeof song.id === 'string' ? song.id : '';
  if (provider === 'spotify' && SP_ID.test(id)) return { provider, id, start: clampStart(Number(song.start)) };
  if (provider === 'youtube' && YT_ID.test(id)) return { provider, id, start: clampStart(Number(song.start)) };
  return null;
}

// The one line a maker can leave on the planet. Trimmed, whitespace collapsed,
// control characters dropped, hard-capped. Empty -> null.
export function sanitizeMessage(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_CHARS);
  return s || null;
}

// canonical public URL for a stored song (what the arrival panel links to)
export function songUrl(song) {
  if (!song) return null;
  if (song.provider === 'spotify') return `https://open.spotify.com/track/${song.id}`;
  const t = song.start ? `&t=${song.start}s` : '';
  return `https://www.youtube.com/watch?v=${song.id}${t}`;
}

// /p/<slug> <-> planet name. Spaces become hyphens so links read well; the
// lookup normalizes both ways (see api/planet.js), so a name that already
// contains hyphens still resolves.
export function slugForName(name) {
  return encodeURIComponent(String(name || '').trim().replace(/\s+/g, '-'));
}
export function nameFromSlug(slug) {
  let s = '';
  try { s = decodeURIComponent(String(slug || '')); } catch { s = String(slug || ''); }
  return s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}
