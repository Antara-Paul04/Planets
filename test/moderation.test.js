import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decide, APPROVED, REVIEW, REJECTED } from '../lib/moderation/decision.js';
import { getConfig } from '../lib/moderation/config.js';
import { validateSubmission } from '../lib/moderation/validate.js';
import { checkRateLimit } from '../lib/moderation/ratelimit.js';
import { submissionKey, cacheGet, cacheSet } from '../lib/moderation/cache.js';
import { runModeration } from '../lib/moderation/pipeline.js';

const cfg = getConfig();

const img = (score) => ({ ok: true, score, categories: {} });
const txt = (score) => ({ ok: true, score, categories: {} });
const ocr = (text, confidence = 0.9) => ({ ok: true, text, confidence });

// ---------------- decision matrix (the conceptual table) ----------------

test('image safe + no suspicious text = ALLOW', () => {
  assert.equal(decide({ image: img(0.02), textName: txt(0.01), textOcr: null, ocr: ocr(''), failures: 0 }, cfg), APPROVED);
});

test('safe drawing with no text at all = ALLOW', () => {
  assert.equal(decide({ image: img(0.05), textName: null, textOcr: null, ocr: ocr(''), failures: 0 }, cfg), APPROVED);
});

test('image suspicious + text safe = REVIEW', () => {
  assert.equal(decide({ image: img(0.55), textName: txt(0.01), textOcr: null, ocr: ocr(''), failures: 0 }, cfg), REVIEW);
});

test('image high-confidence unsafe = REJECT', () => {
  assert.equal(decide({ image: img(0.95), textName: txt(0.01), textOcr: null, ocr: ocr(''), failures: 0 }, cfg), REJECTED);
});

test('unsafe NAME rejects regardless of OCR confidence', () => {
  assert.equal(decide({ image: img(0.02), textName: txt(0.97), textOcr: null, ocr: ocr('', 0.1), failures: 0 }, cfg), REJECTED);
});

test('unsafe OCR text with confident OCR = REJECT', () => {
  assert.equal(decide({ image: img(0.02), textName: null, textOcr: txt(0.97), ocr: ocr('slur here', 0.9), failures: 0 }, cfg), REJECTED);
});

test('unsafe OCR text with LOW-confidence OCR = REVIEW (one signal never hard-rejects)', () => {
  assert.equal(decide({ image: img(0.02), textName: null, textOcr: txt(0.97), ocr: ocr('mayb slur?', 0.1), failures: 0 }, cfg), REVIEW);
});

test('borderline text = REVIEW, not reject', () => {
  assert.equal(decide({ image: img(0.02), textName: null, textOcr: txt(0.6), ocr: ocr('edgy'), failures: 0 }, cfg), REVIEW);
});

test('provider failure can never approve (fail closed)', () => {
  assert.equal(decide({ image: img(0.01), textName: txt(0.0), textOcr: null, ocr: ocr(''), failures: 1 }, cfg), REVIEW);
});

test('missing image signal = REVIEW', () => {
  assert.equal(decide({ image: null, textName: txt(0.0), textOcr: null, ocr: ocr(''), failures: 0 }, cfg), REVIEW);
});

test('unsafe image rejects even alongside provider failures', () => {
  assert.equal(decide({ image: img(0.95), textName: null, textOcr: null, ocr: null, failures: 1 }, cfg), REJECTED);
});

test('weird-but-harmless art is not penalized (low scores approve)', () => {
  // abstract blobs, innocent body-like shapes, odd doodles: low harm scores
  assert.equal(decide({ image: img(0.3), textName: txt(0.1), textOcr: txt(0.1), ocr: ocr('weird jokes', 0.4), failures: 0 }, cfg), APPROVED);
});

// ---------------- payload validation ----------------

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==' +
  'A'.repeat(90); // pad past the too_small floor

test('validate: accepts a real PNG data URL', () => {
  const v = validateSubmission({ image: tinyPng, name: 'ok' }, cfg);
  assert.equal(v.ok, true);
});

test('validate: rejects external URLs (no open proxy)', () => {
  assert.equal(validateSubmission({ image: 'https://example.com/x.png', name: '' }, cfg).ok, false);
});

test('validate: rejects non-image data URLs', () => {
  assert.equal(validateSubmission({ image: 'data:text/html;base64,PGI+aGk8L2I+', name: '' }, cfg).ok, false);
});

test('validate: rejects oversized payloads', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024);
  assert.equal(validateSubmission({ image: big, name: '' }, cfg).ok, false);
});

test('validate: rejects mismatched magic bytes', () => {
  const fake = 'data:image/png;base64,' + Buffer.from('this is not a png at all, honestly').toString('base64');
  assert.equal(validateSubmission({ image: fake, name: '' }, cfg).ok, false);
});

test('validate: caps the name length', () => {
  const v = validateSubmission({ image: tinyPng, name: 'x'.repeat(500) }, cfg);
  assert.equal(v.ok, true);
  assert.equal(v.name.length, cfg.maxNameLength);
});

// ---------------- rate limiting ----------------

test('rate limit: allows a burst then blocks within the minute', () => {
  const rlCfg = { ...cfg, ratePerMinute: 3, ratePerHour: 100 };
  const now = 1_000_000;
  const ip = 'test-ip-1';
  assert.equal(checkRateLimit(ip, rlCfg, now), true);
  assert.equal(checkRateLimit(ip, rlCfg, now + 1), true);
  assert.equal(checkRateLimit(ip, rlCfg, now + 2), true);
  assert.equal(checkRateLimit(ip, rlCfg, now + 3), false);
  // window rolls over
  assert.equal(checkRateLimit(ip, rlCfg, now + 61_000), true);
});

// ---------------- cache ----------------

test('cache: identical artwork is not re-moderated', () => {
  const key = submissionKey('data:image/png;base64,AAA', 'same');
  cacheSet(key, 'approved', cfg, 5000);
  assert.equal(cacheGet(key, cfg, 6000), 'approved');
  assert.equal(cacheGet(key, cfg, 6000 + cfg.cacheTtlMs + 1), null); // expired
});

// ---------------- full pipeline with mock providers ----------------

const mockCfg = { ...cfg, mock: true };

test('pipeline: safe doodle approves', async () => {
  const r = await runModeration({ image: tinyPng, name: 'gentle meadow', cfg: mockCfg });
  assert.equal(r.decision, APPROVED);
});

test('pipeline: unsafe imagery rejects', async () => {
  const r = await runModeration({ image: tinyPng, name: 'x __unsafe_image__', cfg: mockCfg });
  assert.equal(r.decision, REJECTED);
});

test('pipeline: hateful hidden text rejects (OCR -> text moderation)', async () => {
  const r = await runModeration({ image: tinyPng, name: 'x __unsafe_text__', cfg: mockCfg });
  assert.equal(r.decision, REJECTED);
});

test('pipeline: ambiguous imagery goes to review, not deletion', async () => {
  const r = await runModeration({ image: tinyPng, name: 'x __odd_image__', cfg: mockCfg });
  assert.equal(r.decision, REVIEW);
});

test('pipeline: borderline text goes to review', async () => {
  const r = await runModeration({ image: tinyPng, name: 'x __edgy_text__', cfg: mockCfg });
  assert.equal(r.decision, REVIEW);
});

test('pipeline: OCR provider failure fails closed to review', async () => {
  const r = await runModeration({ image: tinyPng, name: 'x __ocr_fail__', cfg: mockCfg });
  assert.equal(r.decision, REVIEW);
});

test('pipeline: low-confidence unsafe OCR goes to review, not rejection', async () => {
  const r = await runModeration({ image: tinyPng, name: 'x __lowconf_text__', cfg: mockCfg });
  assert.equal(r.decision, REVIEW);
});

test('pipeline: image provider failure fails closed to review', async () => {
  const r = await runModeration({ image: tinyPng, name: 'x __image_fail__', cfg: mockCfg });
  assert.equal(r.decision, REVIEW);
});

test('pipeline: unconfigured providers fail closed to review', async () => {
  const bare = { ...cfg, mock: false, openaiKey: null };
  const r = await runModeration({ image: tinyPng, name: 'anything', cfg: bare });
  assert.equal(r.decision, REVIEW);
});
