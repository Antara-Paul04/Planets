import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeArtwork } from '../lib/validate-image.js';

// Artwork may be uploaded as WebP or JPEG (small, storage-friendly) or PNG
// (fallback for browsers that can't encode the others). The validator must
// accept all three, report the true content-type + extension so the file is
// stored and served correctly, and still reject anything whose bytes don't
// match its declared type or isn't a raster data URL at all.

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

function dataUrl(mime, magic) {
  const buf = Buffer.alloc(128); // comfortably above the 64-byte floor
  magic.forEach((b, i) => { buf[i] = b; });
  return `data:${mime};base64,` + buf.toString('base64');
}

test('accepts png/webp/jpeg and reports content-type + canonical extension', () => {
  const png = decodeArtwork(dataUrl('image/png', PNG));
  assert.deepEqual([png.ok, png.contentType, png.ext], [true, 'image/png', 'png']);
  const webp = decodeArtwork(dataUrl('image/webp', WEBP));
  assert.deepEqual([webp.ok, webp.contentType, webp.ext], [true, 'image/webp', 'webp']);
  const jpg = decodeArtwork(dataUrl('image/jpeg', JPEG));
  assert.deepEqual([jpg.ok, jpg.contentType, jpg.ext], [true, 'image/jpeg', 'jpg']);
});

test('rejects a data URL whose bytes do not match its declared type', () => {
  const lying = decodeArtwork(dataUrl('image/webp', PNG)); // claims webp, carries png bytes
  assert.equal(lying.ok, false);
  assert.equal(lying.error, 'magic_mismatch');
});

test('still rejects external URLs and non-raster / disallowed formats', () => {
  assert.equal(decodeArtwork('https://example.com/x.png').ok, false);
  assert.equal(decodeArtwork('data:image/gif;base64,AAAAAAAA').ok, false);
  assert.equal(decodeArtwork('data:image/svg+xml;base64,AAAAAAAA').ok, false);
  assert.equal(decodeArtwork('not a data url').ok, false);
});
