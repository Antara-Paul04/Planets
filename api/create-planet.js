import { getSupabase, isProductionStrict } from '../lib/db/supabase.js';
import { decodeArtwork } from '../lib/validate-image.js';

// POST /api/create-planet
// body: {
//   clientRef: uuid,          -- idempotency: retries return the same planet
//   name, image (png dataURL),
//   star: { id, type, seed, x, y, z },
//   position: {x,y,z}, orbit: {radius, angle, speed, incl, node} | null,
//   satelliteType: 'none'|'moons'|'rings', satelliteConfig, surfaceType,
//   vibe, scale, rotationSpeed, tilt
// }
//
// Flow: validate -> upsert star -> insert planet row -> upload artwork ->
// set artwork_path. If the upload fails the row is deleted, so no broken
// planet is left behind. Without Supabase configured, responds
// {fallback:true} and the client keeps its local-only behavior.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => (Number.isFinite(v) ? v : null);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const db = getSupabase();
  if (!db) {
    if (isProductionStrict()) {
      // production has one source of truth -- creation cannot succeed
      res.status(503).json({ error: 'universe_unavailable' });
      return;
    }
    res.status(200).json({ ok: false, fallback: true });
    return;
  }

  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 64) : '';
  if (!name) {
    res.status(400).json({ error: 'invalid_name' });
    return;
  }
  if (typeof b.clientRef !== 'string' || !UUID_RE.test(b.clientRef)) {
    res.status(400).json({ error: 'invalid_client_ref' });
    return;
  }
  const art = decodeArtwork(b.image);
  if (!art.ok) {
    res.status(400).json({ error: 'invalid_artwork' });
    return;
  }
  const satelliteType = ['none', 'moons', 'rings'].includes(b.satelliteType) ? b.satelliteType : 'none';
  const pos = b.position || {};
  const orbit = b.orbit || null;

  try {
    // deterministic star sync -- first write wins, later writes can't tamper
    if (b.star && Number.isInteger(b.star.id)) {
      await db.upsertStar({
        id: b.star.id,
        star_type: String(b.star.type || 'yellow').slice(0, 16),
        seed: num(b.star.seed) ?? 0,
        position_x: num(b.star.x) ?? 0,
        position_y: num(b.star.y) ?? 0,
        position_z: num(b.star.z) ?? 0,
      });
    }

    const row = {
      client_ref: b.clientRef,
      name,
      status: 'visible',
      star_id: b.star && Number.isInteger(b.star.id) ? b.star.id : null,
      position_x: num(pos.x), position_y: num(pos.y), position_z: num(pos.z),
      orbit_radius: orbit ? num(orbit.radius) : null,
      orbit_angle: orbit ? num(orbit.angle) : null,
      orbit_speed: orbit ? num(orbit.speed) : null,
      orbit_inclination: orbit ? num(orbit.incl) : null,
      orbit_node: orbit ? num(orbit.node) : null,
      satellite_type: satelliteType,
      satellite_config: b.satelliteConfig && typeof b.satelliteConfig === 'object' ? b.satelliteConfig : null,
      surface_type: typeof b.surfaceType === 'string' ? b.surfaceType.slice(0, 16) : null,
      vibe: typeof b.vibe === 'string' ? b.vibe.slice(0, 16) : null,
      scale: num(b.scale), rotation_speed: num(b.rotationSpeed), tilt: num(b.tilt),
    };

    let planet = null;
    const ins = await db.insertPlanet(row);
    if (ins.ok && Array.isArray(ins.json) && ins.json[0]) {
      planet = ins.json[0];
    } else if (ins.status === 409) {
      // idempotent retry: this clientRef already created a planet
      const existing = await db.findPlanetByClientRef(b.clientRef);
      if (existing.ok && existing.json && existing.json[0]) {
        const p = existing.json[0];
        res.status(200).json({
          ok: true,
          planet: publicShape(db, p),
          deduplicated: true,
        });
        return;
      }
      res.status(500).json({ error: 'create_failed' });
      return;
    } else {
      res.status(500).json({ error: 'create_failed' });
      return;
    }

    const artworkPath = `planets/${planet.id}.png`;
    const up = await db.uploadArtwork(artworkPath, art.buffer);
    if (!up.ok) {
      await db.deletePlanet(planet.id); // no broken half-planets
      res.status(500).json({ error: 'artwork_upload_failed' });
      return;
    }
    await db.setArtworkPath(planet.id, artworkPath);
    planet.artwork_path = artworkPath;

    console.log(JSON.stringify({
      at: 'create-planet', ts: new Date().toISOString(), id: planet.id, starId: row.star_id,
    }));
    res.status(200).json({ ok: true, planet: publicShape(db, planet) });
  } catch {
    res.status(500).json({ error: 'create_failed' });
  }
}

function publicShape(db, p) {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    artworkUrl: p.artwork_path ? db.publicArtworkUrl(p.artwork_path) : null,
  };
}
