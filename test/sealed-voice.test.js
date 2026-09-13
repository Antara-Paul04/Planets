import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRevealAt, isSealed, sealCargo } from '../lib/reveal.js';
import { decodeVoice, MAX_VOICE_BYTES } from '../lib/validate-voice.js';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const DAY = 86400 * 1000;

test('reveal: only a real future moment inside the window becomes a seal', () => {
  assert.equal(sanitizeRevealAt(null, NOW), null);
  assert.equal(sanitizeRevealAt('', NOW), null);
  assert.equal(sanitizeRevealAt('yesterday', NOW), null);
  assert.equal(sanitizeRevealAt(new Date(NOW - DAY).toISOString(), NOW), null, 'the past is not a seal');
  assert.equal(sanitizeRevealAt(new Date(NOW + 30 * 1000).toISOString(), NOW), null, 'the next minute is not a seal');
  assert.equal(sanitizeRevealAt(new Date(NOW + 3 * DAY).toISOString(), NOW), new Date(NOW + 3 * DAY).toISOString());
  assert.equal(sanitizeRevealAt(new Date(NOW + 500 * DAY).toISOString(), NOW), null, 'too far out');
});

test('sealed cargo leaves the server stripped; open cargo leaves whole', () => {
  const cargo = { message: 'hi', song: { provider: 'youtube', id: 'dQw4w9WgXcQ', start: 0 }, voiceUrl: 'https://x/v.webm', revealAt: new Date(NOW + DAY).toISOString() };
  const sealed = sealCargo(cargo, NOW);
  assert.equal(sealed.sealed, true);
  assert.equal(sealed.message, null);
  assert.equal(sealed.song, null);
  assert.equal(sealed.voiceUrl, null);
  assert.deepEqual([sealed.hasMessage, sealed.hasSong, sealed.hasVoice], [true, true, true]);
  assert.equal(sealed.revealAt, cargo.revealAt);
  const open = sealCargo(cargo, NOW + 2 * DAY);
  assert.equal(open.sealed, false);
  assert.equal(open.message, 'hi');
  assert.equal(open.voiceUrl, 'https://x/v.webm');
  assert.equal(isSealed(null), false);
});

test('voice: browser recordings pass, anything else is rejected, size is capped', () => {
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(600, 1)]);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.alloc(600, 1)]);
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(600, 1)]);
  const url = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;
  assert.equal(decodeVoice(url('audio/webm;codecs=opus', webm)).ext, 'webm');
  assert.equal(decodeVoice(url('audio/mp4', mp4)).ext, 'mp4');
  assert.equal(decodeVoice(url('audio/ogg;codecs=opus', ogg)).ext, 'ogg');
  assert.equal(decodeVoice(url('audio/webm', mp4)).ok, false, 'declared type must match the bytes');
  assert.equal(decodeVoice(url('audio/mpeg', webm)).ok, false, 'mp3 uploads are not browser recordings');
  assert.equal(decodeVoice('https://evil/voice.webm').ok, false);
  assert.equal(decodeVoice(url('audio/webm', Buffer.concat([webm, Buffer.alloc(MAX_VOICE_BYTES, 1)]))).error, 'too_large');
  assert.deepEqual(decodeVoice(null), { ok: true, empty: true });
  assert.deepEqual(decodeVoice(undefined), { ok: true, empty: true });
});
