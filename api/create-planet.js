import { getSupabase, isProductionStrict } from '../lib/db/supabase.js';
import { decodeArtwork } from '../lib/validate-image.js';

// POST /api/create-planet
// body: {
//   clientRef: uuid,          -- idempotency: retries return the same planet
//   name, image (png dataURL),
//   candidates: [{ id, type, seed, x, y, z, radius, plane_incl, plane_node }, ...] nearest-first,
//   extent: number,          -- the planet's visual reach, for orbit spacing
//   satelliteType, satelliteConfig, surfaceType, vibe, scale, rotationSpeed, tilt
// }
//
// The SERVER decides the star + orbit atomically via assign_planet() —
// capacity is enforced in the database, never trusted from the browser. The
// browser only proposes candidate stars (nearest-first). Flow:
//   validate -> assign_planet RPC (row inserted with artwork_path) ->
//   upload artwork (keyed by clientRef) -> return the assignment.
// On upload failure the row is removed, so no broken planet is left behind.
// Without Supabase configured, responds {fallback:true} (dev) or 503 (prod).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => (Number.isFinite(v) ? v : null);

function sanitizeCandidates(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list.slice(0, 64)) {
    if (!c || !Number.isInteger(c.id)) continue;
    out.push({
      id: c.id,
      type: typeof c.type === 'string' ? c.type.slice(0, 16) : 'yellow',
      seed: num(c.seed) ?? 0,
      x: num(c.x) ?? 0, y: num(c.y) ?? 0, z: num(c.z) ?? 0,
      radius: num(c.radius) ?? 16,
      plane_incl: num(c.plane_incl) ?? 0,
      plane_node: num(c.plane_node) ?? 0,
    });
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const db = getSupabase();
  if (!db) {
    if (isProductionStrict()) {
      res.status(503).json({ error: 'universe_unavailable' });
      return;
    }
    res.status(200).json({ ok: false, fallback: true });
    return;
  }

  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 64) : '';
  if (!name) { res.status(400).json({ error: 'invalid_name' }); return; }
  if (typeof b.clientRef !== 'string' || !UUID_RE.test(b.clientRef)) {
    res.status(400).json({ error: 'invalid_client_ref' }); return;
  }
  const art = decodeArtwork(b.image);
  if (!art.ok) { res.status(400).json({ error: 'invalid_artwork' }); return; }
  const candidates = sanitizeCandidates(b.candidates);
  if (!candidates.length) { res.status(400).json({ error: 'no_candidate_stars' }); return; }

  const extent = Math.min(200, Math.max(1, num(b.extent) ?? 3));
  const artworkPath = `planets/${b.clientRef}.png`;
  const planet = {
    name,
    artwork_path: artworkPath,
    satellite_type: ['none', 'moons', 'rings'].includes(b.satelliteType) ? b.satelliteType : 'none',
    satellite_config: b.satelliteConfig && typeof b.satelliteConfig === 'object' ? b.satelliteConfig : null,
    surface_type: typeof b.surfaceType === 'string' ? b.surfaceType.slice(0, 16) : null,
    vibe: typeof b.vibe === 'string' ? b.vibe.slice(0, 16) : null,
    scale: num(b.scale) ?? 2.4,
    rotation_speed: num(b.rotationSpeed) ?? 0.12,
    tilt: num(b.tilt) ?? 0.25,
  };

  try {
    const rpc = await db.rpcAssignPlanet({ clientRef: b.clientRef, candidates, extent, planet });
    if (!rpc.ok || !Array.isArray(rpc.json) || !rpc.json[0]) {
      if (isProductionStrict()) { res.status(503).json({ error: 'universe_unavailable' }); return; }
      res.status(500).json({ error: 'create_failed' });
      return;
    }
    const a = rpc.json[0];

    // upload artwork unless this was an idempotent retry (already uploaded)
    if (!a.deduplicated) {
      const up = await db.uploadArtwork(artworkPath, art.buffer);
      if (!up.ok) {
        await db.deletePlanetByClientRef(b.clientRef); // no broken planet left behind
        res.status(500).json({ error: 'artwork_upload_failed' });
        return;
      }
    }

    console.log(JSON.stringify({
      at: 'create-planet', ts: new Date().toISOString(),
      id: a.planet_id, starId: a.star_id, newStar: a.star_is_new, dedup: a.deduplicated,
    }));
    res.status(200).json({ ok: true, planet: shape(db, a, artworkPath) });
  } catch {
    if (isProductionStrict()) { res.status(503).json({ error: 'universe_unavailable' }); return; }
    res.status(500).json({ error: 'create_failed' });
  }
}

function shape(db, a, artworkPath) {
  return {
    id: a.planet_id,
    name: undefined, // name echoes back via the toast on the client
    createdAt: a.created_at,
    artworkUrl: db.publicArtworkUrl(artworkPath),
    star: {
      id: a.star_id, type: a.star_type, seed: a.star_seed, radius: a.star_radius,
      x: a.star_x, y: a.star_y, z: a.star_z,
      plane_incl: a.star_plane_incl, plane_node: a.star_plane_node,
      isNew: a.star_is_new,
    },
    orbit: {
      radius: a.o_radius, angle: a.o_angle, speed: a.o_speed, incl: a.o_incl, node: a.o_node,
    },
  };
}
