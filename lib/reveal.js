// Sealed planets: what a planet carries (message, song, voice) can be locked
// until a moment the maker picked. The seal is enforced HERE, on the server,
// on every public read: a sealed planet leaves the database with its cargo
// stripped and `sealed: true, revealAt` in its place. The browser only ever
// receives what it is allowed to show, and counts down to the moment.

export const MAX_SEAL_DAYS = 400;
const MIN_SEAL_MS = 60 * 1000; // a seal in the past (or the next minute) is no seal at all

// client-proposed reveal moment -> ISO string, or null when it isn't a real
// future moment within the window
export function sanitizeRevealAt(raw, now = Date.now()) {
  if (raw == null || raw === '') return null;
  const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
  if (!Number.isFinite(t)) return null;
  if (t < now + MIN_SEAL_MS) return null;
  if (t > now + MAX_SEAL_DAYS * 86400 * 1000) return null;
  return new Date(t).toISOString();
}

export function isSealed(revealAt, now = Date.now()) {
  if (!revealAt) return false;
  const t = Date.parse(revealAt);
  return Number.isFinite(t) && t > now;
}

// the public shape of a planet's cargo: full when open, stripped when sealed
export function sealCargo(planet, now = Date.now()) {
  const revealAt = planet.revealAt || null;
  if (!isSealed(revealAt, now)) {
    return { ...planet, sealed: false, revealAt };
  }
  return {
    ...planet,
    sealed: true,
    revealAt,
    message: null,
    song: null,
    voiceUrl: null,
    hasMessage: !!planet.message,
    hasSong: !!planet.song,
    hasVoice: !!planet.voiceUrl,
  };
}
