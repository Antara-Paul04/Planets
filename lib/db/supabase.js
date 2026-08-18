// Server-side Supabase access over plain fetch (PostgREST + Storage).
// No SDK dependency; only the handful of calls this app needs.
//
// The SERVICE ROLE key is used exclusively here, in server code. It is never
// imported by client code, never returned by any endpoint, never logged.
// Returns null when Supabase is not configured -- callers degrade gracefully.

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const base = url.replace(/\/$/, '');

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  async function rest(method, path, body, extraHeaders = {}) {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch { /* non-JSON body */ }
    return { status: res.status, ok: res.ok, json };
  }

  return {
    publicArtworkUrl(path) {
      return `${base}/storage/v1/object/public/planet-artwork/${path}`;
    },

    async upsertStar(star) {
      // first write wins: existing star rows are never overwritten
      return rest('POST', 'stars?on_conflict=id', star, {
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      });
    },

    async insertPlanet(row) {
      return rest('POST', 'planets', row, { Prefer: 'return=representation' });
    },

    async findPlanetByClientRef(clientRef) {
      return rest('GET', `planets?client_ref=eq.${encodeURIComponent(clientRef)}&select=*`);
    },

    async setArtworkPath(id, artworkPath) {
      return rest('PATCH', `planets?id=eq.${encodeURIComponent(id)}`, { artwork_path: artworkPath }, {
        Prefer: 'return=minimal',
      });
    },

    async deletePlanet(id) {
      return rest('DELETE', `planets?id=eq.${encodeURIComponent(id)}`, undefined, {
        Prefer: 'return=minimal',
      });
    },

    async selectVisiblePlanets() {
      const cols = [
        'id', 'name', 'artwork_path', 'star_id', 'created_at',
        'position_x', 'position_y', 'position_z',
        'orbit_radius', 'orbit_angle', 'orbit_speed', 'orbit_inclination', 'orbit_node',
        'satellite_type', 'satellite_config', 'surface_type', 'vibe',
        'scale', 'rotation_speed', 'tilt',
      ].join(',');
      return rest('GET', `planets?status=eq.visible&select=${cols}&order=created_at.asc&limit=500`);
    },

    async rpcReportPlanet(planetId, ipHash) {
      return rest('POST', 'rpc/report_planet', { p_planet_id: planetId, p_ip_hash: ipHash });
    },

    async uploadArtwork(path, buffer, contentType = 'image/png') {
      const res = await fetch(`${base}/storage/v1/object/planet-artwork/${path}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': contentType,
          'x-upsert': 'false', // never overwrite existing artwork
        },
        body: buffer,
      });
      return { status: res.status, ok: res.ok };
    },
  };
}
