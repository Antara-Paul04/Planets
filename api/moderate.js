import { getConfig } from '../lib/moderation/config.js';
import { validateSubmission } from '../lib/moderation/validate.js';
import { checkRateLimit } from '../lib/moderation/ratelimit.js';
import { submissionKey, cacheGet, cacheSet } from '../lib/moderation/cache.js';
import { runModeration } from '../lib/moderation/pipeline.js';

// POST /api/moderate
// body: { image: dataURL(png|jpeg, capped), name: string }
// response: { decision: "approved" | "review" | "rejected" }
//
// The browser talks only to this endpoint; provider keys live server-side.
// Responses expose the decision and nothing else -- no category breakdown,
// no provider output, nothing to reverse-engineer.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const cfg = getConfig();

  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(ip, cfg)) {
    res.status(429).json({ decision: 'review', error: 'rate_limited' });
    return;
  }

  const v = validateSubmission(req.body, cfg);
  if (!v.ok) {
    res.status(400).json({ error: 'invalid_submission' });
    return;
  }

  const key = submissionKey(v.image, v.name);
  const cached = cacheGet(key, cfg);
  if (cached) {
    res.status(200).json({ decision: cached });
    return;
  }

  try {
    const { decision } = await runModeration({ image: v.image, name: v.name, cfg });
    cacheSet(key, decision, cfg);
    res.status(200).json({ decision });
  } catch {
    // pipeline-level failure: fail closed, reveal nothing
    res.status(200).json({ decision: 'review' });
  }
}
