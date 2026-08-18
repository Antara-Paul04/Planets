// Browser side of the backend. The client only ever talks to our own /api
// endpoints -- no Supabase keys, no direct database access. When the
// backend is not configured (local prototyping), every call degrades to
// the app's original local-only behavior.

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

// world state only: the planet's permanent parameters, never frame state
export async function createPlanetRemote({ clientRef, name, canvas, star, position, orbit, derived }) {
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
    star: star ? {
      id: star.id,
      type: star.type,
      seed: star.seed,
      x: star.position.x, y: star.position.y, z: star.position.z,
    } : null,
    position: { x: position.x, y: position.y, z: position.z },
    orbit: orbit ? {
      radius: orbit.radius, angle: orbit.angle, speed: orbit.speed,
      incl: orbit.incl || 0, node: orbit.node || 0,
    } : null,
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
    if (!res.ok) return { error: true };
    const json = await res.json();
    if (json.fallback) return { fallback: true };
    if (json.ok && json.planet) return { ok: true, planet: json.planet };
    return { error: true };
  } catch {
    return { error: true, offline: true };
  }
}

export async function fetchSharedPlanets() {
  try {
    const res = await fetch('/api/planets');
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.planets) ? json.planets : [];
  } catch {
    return [];
  }
}

export async function reportPlanetRemote(planetId) {
  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planetId }),
    });
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
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
