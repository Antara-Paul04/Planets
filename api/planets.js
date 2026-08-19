import { getSupabase, isProductionStrict } from '../lib/db/supabase.js';

// GET /api/planets
// The public universe query: VISIBLE planets only, only the fields the
// renderer needs, capped at 500 rows (free-plan friendly; pagination can
// come when the universe outgrows it). Hidden planets never leave the
// database through this path.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const db = getSupabase();
  if (!db) {
    if (isProductionStrict()) {
      res.status(200).json({ planets: [], unavailable: true });
      return;
    }
    res.status(200).json({ planets: [], fallback: true });
    return;
  }

  try {
    // one batched pair of reads: visible planets + any dynamically-minted
    // stars. No per-star queries (no N+1), no per-frame querying.
    const [out, starsOut] = await Promise.all([
      db.selectVisiblePlanets(),
      db.selectDynamicStars(),
    ]);
    if (!out.ok || !Array.isArray(out.json)) {
      res.status(200).json({ planets: [], stars: [], degraded: true, unavailable: isProductionStrict() });
      return;
    }
    const stars = (starsOut.ok && Array.isArray(starsOut.json) ? starsOut.json : []).map((s) => ({
      id: s.id, type: s.star_type, seed: s.seed, radius: s.radius,
      x: s.position_x, y: s.position_y, z: s.position_z,
      plane_incl: s.plane_incl, plane_node: s.plane_node,
    }));
    const planets = out.json.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      artworkUrl: p.artwork_path ? db.publicArtworkUrl(p.artwork_path) : null,
      starId: p.star_id,
      position: { x: p.position_x, y: p.position_y, z: p.position_z },
      orbit: p.orbit_radius != null ? {
        radius: p.orbit_radius,
        angle: p.orbit_angle,
        speed: p.orbit_speed,
        incl: p.orbit_inclination,
        node: p.orbit_node,
      } : null,
      satelliteType: p.satellite_type,
      satelliteConfig: p.satellite_config,
      surfaceType: p.surface_type,
      vibe: p.vibe,
      scale: p.scale,
      rotationSpeed: p.rotation_speed,
      tilt: p.tilt,
    }));
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.status(200).json({ planets, stars });
  } catch {
    res.status(200).json({ planets: [], stars: [], degraded: true, unavailable: isProductionStrict() });
  }
}
