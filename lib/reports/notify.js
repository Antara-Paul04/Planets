// When a planet is reported, the project owner hears about it right away and
// can act from the message itself: every notification carries signed
// one-click links to hide or restore the planet (api/moderate.js). Delivery
// is by webhook (Discord/Slack-compatible JSON) and/or email (Resend),
// whichever is configured; with neither, reports are still recorded and the
// three-networks rule still applies -- this is the human layer on top.
//
//   REPORT_WEBHOOK_URL      a Discord or Slack incoming webhook
//   RESEND_API_KEY          + REPORT_NOTIFY_EMAIL (to) [+ REPORT_FROM_EMAIL]
//   MODERATION_SECRET       signs the hide/unhide links (falls back to the
//                           service-role key, like the IP salt does)
//
// Nothing personal is included: the reporter is a hashed network, never an
// address; the message names the planet, the reason, and the count.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_REASON_CHARS = 200;
export const REASONS = ['spam', 'hateful', 'private info', 'not for kids', 'other'];

export function sanitizeReason(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS);
  return s || null;
}

function secret() {
  return process.env.MODERATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'planets-dev-moderation';
}

export const MOD_ACTIONS = ['hide', 'unhide'];

export function moderationSig(planetId, action) {
  return createHmac('sha256', secret()).update(`${action}:${planetId}`).digest('hex').slice(0, 40);
}

export function verifyModerationSig(planetId, action, sig) {
  if (!MOD_ACTIONS.includes(action) || typeof sig !== 'string' || sig.length !== 40) return false;
  const want = Buffer.from(moderationSig(planetId, action));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function moderationLink(origin, planetId, action) {
  return `${origin}/api/moderate?planet=${encodeURIComponent(planetId)}&action=${action}&sig=${moderationSig(planetId, action)}`;
}

// the message, once, in plain text -- both channels use it
export function composeReport({ planet, reason, distinct, hidden, origin, slug }) {
  const lines = [
    `⚑ planet reported: “${planet.name}”`,
    reason ? `reason: ${reason}` : 'reason: (none given)',
    `reports from distinct networks: ${distinct ?? '?'}${hidden ? ' · now HIDDEN by the three-networks rule' : ''}`,
    `see it: ${origin}/p/${slug}`,
    hidden ? `restore: ${moderationLink(origin, planet.id, 'unhide')}` : `hide now: ${moderationLink(origin, planet.id, 'hide')}`,
    hidden ? '' : `(and if it's fine, do nothing)`,
  ].filter(Boolean);
  return { subject: `[ASTRAY] report: ${planet.name}`, text: lines.join('\n') };
}

async function withTimeout(promise, ms = 3000) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('notify timeout')), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}

// returns which channels actually delivered; never throws
export async function notifyOwner(report, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const msg = composeReport(report);
  const delivered = [];
  const jobs = [];

  if (env.REPORT_WEBHOOK_URL) {
    // Discord reads `content`, Slack reads `text`; sending both is harmless
    jobs.push(withTimeout(fetchImpl(env.REPORT_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg.text, text: msg.text, username: 'ASTRAY reports' }),
    })).then((r) => { if (r && r.ok) delivered.push('webhook'); }).catch(() => {}));
  }

  if (env.RESEND_API_KEY && env.REPORT_NOTIFY_EMAIL) {
    jobs.push(withTimeout(fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.REPORT_FROM_EMAIL || 'ASTRAY reports <onboarding@resend.dev>',
        to: [env.REPORT_NOTIFY_EMAIL],
        subject: msg.subject,
        text: msg.text,
      }),
    })).then((r) => { if (r && r.ok) delivered.push('email'); }).catch(() => {}));
  }

  await Promise.all(jobs);
  return { delivered, configured: jobs.length > 0, message: msg };
}
