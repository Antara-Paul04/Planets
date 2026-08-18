import { getConfig } from '../lib/moderation/config.js';
import { validateSubmission } from '../lib/moderation/validate.js';
import { checkRateLimit } from '../lib/moderation/ratelimit.js';
import { runModeration } from '../lib/moderation/pipeline.js';
import { submissionKey, cacheGet, cacheSet } from '../lib/moderation/cache.js';
import { getStore } from '../lib/moderation/store.js';

// POST /api/report
// body: { name: string, solarSystemId?: number, image?: dataURL }
//
// A report NEVER hides or deletes a planet by itself. It records the report
// and, when artwork is included, re-runs it through the moderation pipeline
// so a reviewer has a fresh signal. Action stays a human decision.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const cfg = getConfig();
  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(ip, cfg)) { // one shared budget per IP across endpoints
    res.status(429).json({ ok: true }); // reports are quiet even when limited
    return;
  }

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.slice(0, cfg.maxNameLength) : '';
  const solarSystemId = Number.isInteger(body.solarSystemId) ? body.solarSystemId : null;

  let recheck = null;
  if (typeof body.image === 'string') {
    const v = validateSubmission({ image: body.image, name }, cfg);
    if (v.ok) {
      const key = submissionKey(v.image, v.name);
      recheck = cacheGet(key, cfg);
      if (!recheck) {
        try {
          recheck = (await runModeration({ image: v.image, name: v.name, cfg })).decision;
          if (recheck !== 'review') cacheSet(key, recheck, cfg);
        } catch {
          recheck = 'review';
        }
      }
    }
  }

  try {
    await getStore(cfg).saveReport({
      planet_name: name || null,
      solar_system_id: solarSystemId,
      recheck_status: recheck,
    });
  } catch {
    /* recording must not fail the ack */
  }

  console.log(JSON.stringify({
    at: 'report', ts: new Date().toISOString(), solarSystemId, recheck,
  }));

  res.status(200).json({ ok: true });
}
