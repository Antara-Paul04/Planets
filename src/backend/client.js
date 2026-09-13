// Browser side of the backend. The client only ever talks to our own /api
// endpoints -- no Supabase keys, no direct database access.
//
// Local development: an unconfigured backend degrades to the app's
// original local-only behavior (unchanged).
// Production builds: the backend is the ONE source of truth. If it is
// unconfigured or unreachable, operations return { unavailable: true }
// and the app shows a minimal unavailable state instead of pretending.

const IS_PROD = import.meta.env.PROD;

// try one encoding; browsers that can't encode a format silently hand back a
// PNG data URL, so we confirm the mime prefix before trusting it
function encode(canvas, mime, quality) {
  const url = canvas.toDataURL(mime, quality);
  return url.startsWith(`data:${mime}`) ? url : null;
}

function flatten(canvas, w = 512, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1e30';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  // compressed formats are 5-10x smaller than PNG and identical on a distant
  // sphere; the background is opaque so lossy encoding loses no transparency.
  // JPEG first: the unfurl card (lib/og-card.js) is rendered by resvg, which
  // reads JPEG and PNG but not WebP, so a WebP planet would preview without
  // its face. PNG is the last-resort fallback.
  return encode(c, 'image/jpeg', 0.86) || encode(c, 'image/webp', 0.85) || c.toDataURL('image/png');
}

// world state only: the planet's permanent parameters, never frame state.
// The client proposes candidate stars (nearest-first) + the planet's visual
// extent; the SERVER decides the final star and orbit (capacity is enforced
// server-side, never here).
export async function createPlanetRemote({ clientRef, name, canvas, candidates, extent, derived, song = null, message = null, voice = null, revealAt = null }) {
  let image;
  try {
    image = flatten(canvas);
  } catch {
    return { fallback: true };
  }
  const look = derived.look || {};
  const body = {
    clientRef,
    name,
    image,
    candidates,
    extent,
    satelliteType: look.rings ? 'rings' : (look.moons && look.moons.length ? 'moons' : 'none'),
    satelliteConfig: { atmo: look.atmo || null, rings: look.rings || null, moons: look.moons || [] },
    surfaceType: derived.type,
    vibe: derived.vibe || null,
    scale: derived.scale,
    rotationSpeed: derived.rotationSpeed,
    tilt: derived.tilt,
    // a planet for someone: provider + bare id + start second (never the pasted
    // URL), and one line. The server re-validates both.
    song: song ? { provider: song.provider, id: song.id, start: song.start || 0 } : null,
    message: message || null,
    voice: voice || null,       // a browser recording as a data URL, <= 10s
    revealAt: revealAt || null, // sealed until this moment (ISO), or open from birth
  };
  try {
    const res = await fetch('/api/create-planet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 503) return { unavailable: true };
    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      if (j.error === 'planet_limit_reached') return { planetLimitReached: true }; // one planet per network
      return { nameTaken: true }; // someone already took that name
    }
    if (res.status === 400) {
      const j = await res.json().catch(() => ({}));
      if (j.error === 'invalid_voice') return { error: true, badVoice: true };
    }
    if (!res.ok) return IS_PROD ? { unavailable: true } : { error: true };
    const json = await res.json();
    if (json.fallback) return IS_PROD ? { unavailable: true } : { fallback: true };
    if (json.ok && json.planet) return { ok: true, planet: json.planet };
    return IS_PROD ? { unavailable: true } : { error: true };
  } catch {
    return IS_PROD ? { unavailable: true } : { error: true, offline: true };
  }
}

export async function fetchSharedPlanets() {
  try {
    const res = await fetch('/api/planets');
    if (!res.ok) return { planets: [], stars: [], unavailable: IS_PROD };
    const json = await res.json();
    return {
      planets: Array.isArray(json.planets) ? json.planets : [],
      stars: Array.isArray(json.stars) ? json.stars : [], // dynamically-minted stars
      unavailable: !!json.unavailable || (IS_PROD && !!json.fallback),
    };
  } catch {
    return { planets: [], stars: [], unavailable: IS_PROD };
  }
}

// Name search runs on the server (see api/search). Returns a small list of
// { name, createdAt, starId }; the client travels to the match with the
// existing travel system.
export async function searchPlanets(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return { results: [] };
    const json = await res.json();
    return { results: Array.isArray(json.results) ? json.results : [] };
  } catch {
    return { results: [] };
  }
}

// The exact lookup behind /p/<name>. Returns { planet } (name, createdAt,
// starId, artworkUrl, song, message) or { notFound } / { unavailable }.
export async function fetchPlanetByName(name, { fresh = false } = {}) {
  try {
    const res = await fetch(`/api/planet?name=${encodeURIComponent(name)}${fresh ? `&r=${Date.now()}` : ''}`);
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return { unavailable: true };
    const json = await res.json();
    return json && json.planet ? { planet: json.planet } : { notFound: true };
  } catch {
    return { unavailable: true };
  }
}

export async function reportPlanetRemote(planetId, reason = null) {
  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planetId, reason: reason || null }),
    });
    if (res.status === 503) return { ok: false, unavailable: true };
    if (!res.ok) return { ok: false, unavailable: IS_PROD };
    return await res.json();
  } catch {
    return { ok: false, unavailable: IS_PROD };
  }
}

// Artwork comes back from public storage as a URL; the renderer needs a canvas.
// Draw it at its native 512x256 — the stored image is 512x256, so the old
// 1024x512 canvas was a pure upscale that quadrupled GPU texture memory without
// adding any detail (the GPU's bilinear sampling reproduces it for free).
export function loadArtworkCanvas(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      canvas.getContext('2d').drawImage(img, 0, 0, 512, 256);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = url;
  });
}
