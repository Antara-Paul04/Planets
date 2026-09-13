import { getSupabase, isProductionStrict } from '../lib/db/supabase.js';
import { reporterIp } from '../lib/reports/ip.js';
import { hashReporterIp } from '../lib/reports/hash.js';
import { addReport } from '../lib/reports/store.js';
import { sanitizeReason, notifyOwner } from '../lib/reports/notify.js';
import { slugForName } from '../lib/song.js';

// POST /api/report
// body: { planetId: uuid, reason?: string (<= 200 chars) }
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

  const reason = sanitizeReason(req.body && req.body.reason);
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
    let added = false;
    if (db) {
      const out = await db.rpcReportPlanet(planetId, ipHash);
      if (!out.ok && isProductionStrict()) {
        res.status(503).json({ error: 'universe_unavailable' });
        return;
      }
      if (out.ok && Array.isArray(out.json) && out.json[0]) {
        hidden = !!out.json[0].hidden;
        added = !!out.json[0].added;
      }
      if (added && reason) await db.setReportReason(planetId, ipHash, reason).catch(() => {});
    } else {
      const r = addReport(planetId, ipHash);
      hidden = r.hidden;
      added = r.added !== false;
    }
    console.log(JSON.stringify({ at: 'report', ts: new Date().toISOString(), hidden, reason: !!reason }));
    // acknowledge first; the owner's notification must never slow or fail a report
    res.status(200).json({ ok: true, hidden });

    // tell the project owner (a repeat report from the same network is not re-sent)
    if (added && db) {
      try {
        const [found, count] = await Promise.all([db.findPlanetById(planetId), db.countDistinctReporters(planetId)]);
        const planet = found.ok && Array.isArray(found.json) ? found.json[0] : null;
        if (planet) {
          const distinct = count.ok && Array.isArray(count.json) ? new Set(count.json.map((r) => r.reporter_ip_hash)).size : null;
          const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
          const origin = `${proto}://${req.headers['x-forwarded-host'] || req.headers.host || 'go-astray.vercel.app'}`;
          await notifyOwner({ planet, reason, distinct, hidden, origin, slug: slugForName(planet.name) });
        }
      } catch { /* the report is already recorded */ }
    }
  } catch {
    if (isProductionStrict()) {
      res.status(503).json({ error: 'universe_unavailable' });
      return;
    }
    res.status(200).json({ ok: true, hidden: false }); // dev reports stay quiet
  }
}
