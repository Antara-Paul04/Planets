// Browser side of the backend. The client only ever talks to our own /api
// endpoints -- no Supabase keys, no direct database access.
//
// Local development: an unconfigured backend degrades to the app's
// original local-only behavior (unchanged).
// Production builds: the backend is the ONE source of truth. If it is
// unconfigured or unreachable, operations return { unavailable: true }
// and the app shows a minimal unavailable state instead of pretending.

const IS_PROD = import.meta.env.PROD;

function flatten(canvas, w = 512, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1e30';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/png');
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

// artwork comes back from public storage as a URL; the renderer needs a canvas
export function loadArtworkCanvas(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 512;
      canvas.getContext('2d').drawImage(img, 0, 0, 1024, 512);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = url;
  });
}
