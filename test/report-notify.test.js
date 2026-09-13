import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeReason, moderationSig, verifyModerationSig, moderationLink, composeReport, notifyOwner } from '../lib/reports/notify.js';
import moderate from '../api/moderate.js';

const PID = '11111111-2222-4333-8444-555555555555';
const planet = { id: PID, name: 'pinku blobu' };

test('report reasons are trimmed, cleaned and capped; empty becomes null', () => {
  assert.equal(sanitizeReason('  spam · selling\nstuff  '), 'spam · selling stuff');
  assert.equal(sanitizeReason('x'.repeat(500)).length, 200);
  assert.equal(sanitizeReason(''), null);
  assert.equal(sanitizeReason(42), null);
});

test('moderation links are signed per (action, planet); a link cannot be bent to another action or planet', () => {
  const hide = moderationSig(PID, 'hide');
  assert.equal(verifyModerationSig(PID, 'hide', hide), true);
  assert.equal(verifyModerationSig(PID, 'unhide', hide), false, 'hide sig does not unhide');
  assert.equal(verifyModerationSig('99999999-2222-4333-8444-555555555555', 'hide', hide), false, 'not another planet');
  assert.equal(verifyModerationSig(PID, 'delete', hide), false, 'no such action');
  assert.equal(verifyModerationSig(PID, 'hide', hide.slice(0, 39) + '0'), false);
  assert.match(moderationLink('https://go-astray.vercel.app', PID, 'hide'), /\/api\/moderate\?planet=.*&action=hide&sig=[0-9a-f]{40}$/);
});

test('the owner message names the planet, the reason, the count and the right one-click link', () => {
  const open = composeReport({ planet, reason: 'hateful', distinct: 1, hidden: false, origin: 'https://x', slug: 'pinku-blobu' });
  assert.match(open.text, /pinku blobu/);
  assert.match(open.text, /reason: hateful/);
  assert.match(open.text, /distinct networks: 1/);
  assert.match(open.text, /hide now: https:\/\/x\/api\/moderate\?planet=.*action=hide/);
  assert.doesNotMatch(open.text, /unhide/);
  const gone = composeReport({ planet, reason: null, distinct: 3, hidden: true, origin: 'https://x', slug: 'pinku-blobu' });
  assert.match(gone.text, /now HIDDEN/);
  assert.match(gone.text, /restore: .*action=unhide/);
  assert.match(gone.text, /reason: \(none given\)/);
});

test('notifyOwner posts to the webhook and Resend when configured, never throws, reports what delivered', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
  const env = { REPORT_WEBHOOK_URL: 'https://discord.test/hook', RESEND_API_KEY: 'k', REPORT_NOTIFY_EMAIL: 'antara@example.com' };
  const out = await notifyOwner({ planet, reason: 'spam', distinct: 1, hidden: false, origin: 'https://x', slug: 'p' }, { fetchImpl, env });
  assert.deepEqual(out.delivered.sort(), ['email', 'webhook']);
  const hook = calls.find((c) => c.url === env.REPORT_WEBHOOK_URL);
  assert.match(hook.body.content, /planet reported/);
  assert.equal(hook.body.text, hook.body.content, 'discord and slack shapes both present');
  const mail = calls.find((c) => c.url.includes('resend'));
  assert.deepEqual(mail.body.to, ['antara@example.com']);
  assert.match(mail.body.subject, /pinku blobu/);
  // nothing configured -> nothing sent, still fine
  const none = await notifyOwner({ planet, reason: null, distinct: 1, hidden: false, origin: 'https://x', slug: 'p' }, { fetchImpl, env: {} });
  assert.equal(none.configured, false);
  // a dead webhook is swallowed
  const dead = await notifyOwner({ planet, reason: null, distinct: 1, hidden: false, origin: 'https://x', slug: 'p' }, { fetchImpl: async () => { throw new Error('down'); }, env: { REPORT_WEBHOOK_URL: 'https://x' } });
  assert.deepEqual(dead.delivered, []);
});

test('api/moderate refuses a bad or missing signature before touching anything', async () => {
  const mk = () => { const r = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; }, json(b) { this.body = b; } }; return r; };
  let res = mk();
  await moderate({ method: 'GET', query: { planet: PID, action: 'hide', sig: 'nope' } }, res);
  assert.equal(res.code, 403);
  res = mk();
  await moderate({ method: 'GET', query: { planet: 'not-a-uuid', action: 'hide', sig: moderationSig('not-a-uuid', 'hide') } }, res);
  assert.equal(res.code, 403);
  res = mk();
  await moderate({ method: 'POST', query: {} }, res);
  assert.equal(res.code, 405);
});
