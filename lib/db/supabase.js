// Server-side Supabase access over plain fetch (PostgREST + Storage).
// No SDK dependency; only the handful of calls this app needs.
//
// The SERVICE ROLE key is used exclusively here, in server code. It is never
// imported by client code, never returned by any endpoint, never logged.
// Returns null when Supabase is not configured -- callers degrade gracefully.

// In production there is exactly ONE source of truth. When Supabase is
// unconfigured or unreachable there, endpoints refuse operations instead of
// silently falling back to local-only behavior. Local development keeps the
// graceful fallback exactly as before.
export function isProductionStrict() {
  return process.env.VERCEL_ENV === 'production';
}

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

    // Name-prefix search for "search the universe". Uses the name_key prefix
    // index. Returns ONLY name + birth date + star system id — never ids,
    // artwork, ip, report counts, or moderation state.
    async searchPlanetsByName(nameKeyPrefix, limit = 8) {
      const cols = 'name,created_at,star_id';
      const q = encodeURIComponent(nameKeyPrefix);
      return rest('GET', `planets?name_key=like.${q}*&status=eq.visible&select=${cols}&order=name_key.asc&limit=${limit}`);
    },

    async rpcReportPlanet(planetId, ipHash) {
      return rest('POST', 'rpc/report_planet', { p_planet_id: planetId, p_ip_hash: ipHash });
    },

    // The authoritative, atomic star-capacity assignment (migration 002).
    // Given candidate stars nearest-first, the DB picks the first with a free
    // slot (locking per-star), computes a fresh orbital band, and inserts the
    // planet — or mints a new star deterministically if every candidate is full.
    async rpcAssignPlanet({ clientRef, candidates, extent, planet, creatorIpHash }) {
      return rest('POST', 'rpc/assign_planet', {
        p_client_ref: clientRef,
        p_candidates: candidates,
        p_extent: extent,
        p_planet: planet,
        p_creator_ip_hash: creatorIpHash ?? null, // server-derived HMAC; raw IP never sent
      });
    },

    // Dynamically-minted stars only (ids >= DYNAMIC_STAR_ID_BASE). The initial
    // 8-10 deterministic stars are regenerated on the client, never read here.
    async selectDynamicStars() {
      const cols = 'id,star_type,seed,radius,position_x,position_y,position_z,plane_incl,plane_node';
      return rest('GET', `stars?id=gte.1000000&select=${cols}&limit=500`);
    },

    async uploadArtwork(path, buffer, contentType = 'image/png') {
      const res = await fetch(`${base}/storage/v1/object/planet-artwork/${path}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': contentType,
          // clientRef-keyed path is unique to this creation; upsert lets a
          // retry re-put its own artwork without touching any other planet's
          'x-upsert': 'true',
        },
        body: buffer,
      });
      return { status: res.status, ok: res.ok };
    },

    async deletePlanetByClientRef(clientRef) {
      return rest('DELETE', `planets?client_ref=eq.${encodeURIComponent(clientRef)}`, undefined, {
        Prefer: 'return=minimal',
      });
    },
  };
}
