import { getSupabase, isProductionStrict } from '../lib/db/supabase.js';
import { normalizeNameKey } from '../lib/name.js';

// GET /api/search?q=...
// Public name search for "search the universe". Returns at most a few VISIBLE
// planets whose name starts with the query. Exposes ONLY name, birth date, and
// the star-system id (so the client can travel there). Never ids, artwork, ip,
// report counts, or moderation state. The anonymous nature is unchanged.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  const raw = req.query ? (req.query.q ?? req.query.query) : '';
  const qkey = normalizeNameKey(Array.isArray(raw) ? raw[0] : raw);
  if (!qkey) { res.status(200).json({ results: [] }); return; }

  const db = getSupabase();
  if (!db) { res.status(200).json({ results: [], unavailable: isProductionStrict() }); return; }

  try {
    const out = await db.searchPlanetsByName(qkey, 8);
    if (!out.ok || !Array.isArray(out.json)) { res.status(200).json({ results: [] }); return; }
    const results = out.json.map((p) => ({
      name: p.name,
      createdAt: p.created_at,
      starId: p.star_id,
    }));
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).json({ results });
  } catch {
    res.status(200).json({ results: [] });
  }
}
