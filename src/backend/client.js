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
  // PNG is the last-resort fallback for browsers that encode neither.
  return encode(c, 'image/webp', 0.85) || encode(c, 'image/jpeg', 0.85) || c.toDataURL('image/png');
}

// world state only: the planet's permanent parameters, never frame state.
// The client proposes candidate stars (nearest-first) + the planet's visual
// extent; the SERVER decides the final star and orbit (capacity is enforced
// server-side, never here).
export async function createPlanetRemote({ clientRef, name, canvas, candidates, extent, derived }) {
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
  };
  try {
    const res = await fetch('/api/create-planet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 503) return { unavailable: true };
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

export async function reportPlanetRemote(planetId) {
  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planetId }),
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
