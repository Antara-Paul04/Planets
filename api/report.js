import { getSupabase, isProductionStrict } from '../lib/db/supabase.js';
import { reporterIp } from '../lib/reports/ip.js';
import { hashReporterIp } from '../lib/reports/hash.js';
import { addReport } from '../lib/reports/store.js';

// POST /api/report
// body: { planetId: uuid }
//
// The complete moderation rule: three DIFFERENT IP addresses report a
// planet -> the planet becomes HIDDEN. One report per IP per planet.
//
// - The reporter IP comes ONLY from trusted proxy headers (lib/reports/ip.js);
//   anything in the body is ignored by construction.
// - The IP is stored only as a server-side HMAC digest.
// - With Supabase configured, the insert + distinct count + hide transition
//   run atomically in the report_planet() database function (unique
//   constraint on planet_id + reporter_ip_hash).
// - Without Supabase, an in-memory per-instance store enforces the same
//   rule for local development.
//
// Responses never reveal counts or progress -- just a quiet acknowledgement.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const planetId = req.body && typeof req.body.planetId === 'string' ? req.body.planetId : null;
  if (!planetId || !UUID_RE.test(planetId)) {
    res.status(400).json({ error: 'invalid_planet' });
    return;
  }

  const ip = reporterIp(req); // server-derived; body.ip is never read
  const ipHash = hashReporterIp(ip);

  const db = getSupabase();
  if (!db && isProductionStrict()) {
    // a report that cannot be recorded must never look successful
    res.status(503).json({ error: 'universe_unavailable' });
    return;
  }
  try {
    let hidden = false;
    if (db) {
      const out = await db.rpcReportPlanet(planetId, ipHash);
      if (!out.ok && isProductionStrict()) {
        res.status(503).json({ error: 'universe_unavailable' });
        return;
      }
      if (out.ok && Array.isArray(out.json) && out.json[0]) {
        hidden = !!out.json[0].hidden;
      }
    } else {
      hidden = addReport(planetId, ipHash).hidden;
    }
    console.log(JSON.stringify({ at: 'report', ts: new Date().toISOString(), hidden }));
    res.status(200).json({ ok: true, hidden });
  } catch {
    if (isProductionStrict()) {
      res.status(503).json({ error: 'universe_unavailable' });
      return;
    }
    res.status(200).json({ ok: true, hidden: false }); // dev reports stay quiet
  }
}
