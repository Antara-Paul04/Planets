import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSongLink, parseStart, sanitizeSong, sanitizeMessage, slugForName, nameFromSlug, songUrl } from '../lib/song.js';

const SP = '4uLU6hMCjMI75M1A2tKUQC';
const YT = 'dQw4w9WgXcQ';

test('spotify: share links in every shape resolve to the bare track id', () => {
  for (const u of [
    `https://open.spotify.com/track/${SP}`,
    `https://open.spotify.com/track/${SP}?si=abc123&nd=1`,
    `open.spotify.com/track/${SP}`,
    `https://open.spotify.com/intl-de/track/${SP}`,
    `https://open.spotify.com/embed/track/${SP}`,
    `spotify:track:${SP}`,
  ]) assert.deepEqual(parseSongLink(u), { provider: 'spotify', id: SP, start: 0 }, u);
});

test('youtube: watch, short, shorts, music, embed links resolve, with the start offset', () => {
  assert.deepEqual(parseSongLink(`https://www.youtube.com/watch?v=${YT}`), { provider: 'youtube', id: YT, start: 0 });
  assert.deepEqual(parseSongLink(`https://youtu.be/${YT}?t=63`), { provider: 'youtube', id: YT, start: 63 });
  assert.deepEqual(parseSongLink(`https://youtu.be/${YT}?t=1m3s`), { provider: 'youtube', id: YT, start: 63 });
  assert.deepEqual(parseSongLink(`https://www.youtube.com/watch?v=${YT}&t=90s&list=PLx`), { provider: 'youtube', id: YT, start: 90 });
  assert.deepEqual(parseSongLink(`https://music.youtube.com/watch?v=${YT}`), { provider: 'youtube', id: YT, start: 0 });
  assert.deepEqual(parseSongLink(`https://www.youtube.com/shorts/${YT}`), { provider: 'youtube', id: YT, start: 0 });
  assert.deepEqual(parseSongLink(`https://www.youtube.com/embed/${YT}?start=42`), { provider: 'youtube', id: YT, start: 42 });
});

test('anything that is not a spotify track or youtube video is rejected', () => {
  for (const u of [
    '', '   ', 'hello', 'https://example.com/track/' + SP,
    'https://open.spotify.com/album/' + SP,          // albums are not songs
    'https://open.spotify.com/playlist/' + SP,
    'https://open.spotify.com/track/short',
    'https://www.youtube.com/watch?v=tooshort',
    'https://www.youtube.com/channel/UCxyz',
    'javascript:alert(1)',
    'https://evil.com/?u=https://youtu.be/' + YT,     // host is what counts
    'x'.repeat(600),
    null, undefined, 42, {},
  ]) assert.equal(parseSongLink(u), null, String(u));
});

test('start offsets are clamped and never negative or absurd', () => {
  assert.equal(parseStart('-5'), 0);
  assert.equal(parseStart('abc'), 0);
  assert.equal(parseStart('999999999'), 6 * 3600);
  assert.equal(parseStart('1h2m3s'), 3723);
  assert.equal(parseStart('1:23'), 83);
  assert.equal(parseStart('1:02:03'), 3723);
  assert.equal(parseStart('0:07'), 7);
});

test('sanitizeSong: only a well-formed stored shape survives; the pasted URL never does', () => {
  assert.deepEqual(sanitizeSong({ provider: 'spotify', id: SP, start: '12' }), { provider: 'spotify', id: SP, start: 12 });
  assert.deepEqual(sanitizeSong({ provider: 'youtube', id: YT }), { provider: 'youtube', id: YT, start: 0 });
  assert.equal(sanitizeSong({ provider: 'soundcloud', id: 'x' }), null);
  assert.equal(sanitizeSong({ provider: 'youtube', id: '<script>' }), null);
  assert.equal(sanitizeSong('https://youtu.be/' + YT), null);
  assert.equal(sanitizeSong(null), null);
});

test('message: trimmed, collapsed, control chars gone, capped at 80, empty -> null', () => {
  assert.equal(sanitizeMessage('  for you,   always  '), 'for you, always');
  assert.equal(sanitizeMessage('a b\nc'), 'a b c');
  assert.equal(sanitizeMessage('x'.repeat(200)).length, 80);
  assert.equal(sanitizeMessage(''), null);
  assert.equal(sanitizeMessage('   '), null);
  assert.equal(sanitizeMessage(42), null);
});

test('slugs: spaces become hyphens and round-trip back to the name key', () => {
  assert.equal(slugForName('pinku blobu'), 'pinku-blobu');
  assert.equal(nameFromSlug('pinku-blobu'), 'pinku blobu');
  assert.equal(nameFromSlug('Pinku%20Blobu'), 'Pinku Blobu');
  assert.equal(slugForName('  weird   name '), 'weird-name');
});

test('songUrl carries the start for youtube and never for spotify', () => {
  assert.equal(songUrl({ provider: 'youtube', id: YT, start: 63 }), `https://www.youtube.com/watch?v=${YT}&t=63s`);
  assert.equal(songUrl({ provider: 'spotify', id: SP, start: 30 }), `https://open.spotify.com/track/${SP}`);
});

import { fetchSongTitle, oembedUrl } from '../lib/song-meta.js';

test('song title: fetched from the provider oEmbed with only the bare id, cleaned, null on any failure', async () => {
  const yt = { provider: 'youtube', id: YT, start: 0 };
  const sp = { provider: 'spotify', id: SP, start: 0 };
  assert.match(oembedUrl(yt), /^https:\/\/www\.youtube\.com\/oembed\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DdQw4w9WgXcQ/);
  assert.match(oembedUrl(sp), /^https:\/\/open\.spotify\.com\/oembed\?url=/);
  const okFetch = async () => ({ ok: true, json: async () => ({ title: '  Never Gonna\nGive You Up ', author_name: 'Rick Astley' }) });
  assert.equal(await fetchSongTitle(yt, { fetchImpl: okFetch }), 'Never Gonna Give You Up');
  assert.equal(await fetchSongTitle(sp, { fetchImpl: okFetch }), 'Never Gonna Give You Up — Rick Astley');
  assert.equal(await fetchSongTitle(yt, { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await fetchSongTitle(yt, { fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await fetchSongTitle(yt, { fetchImpl: async () => ({ ok: true, json: async () => ({ title: 'x'.repeat(500) }) }) }).then((t) => t.length), 120);
  assert.equal(await fetchSongTitle(null), null);
});

import { displayTitle } from '../lib/og-card.js';
import { describe as describeCard, ogTags } from '../api/p.js';

test('unfurl card: song titles lose their video junk and fit one line', () => {
  assert.equal(displayTitle('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)'), 'Rick Astley - Never Gonna Give You Up');
  assert.equal(displayTitle('Song Name [Official Lyric Video] | Label'), 'Song Name');
  assert.equal(displayTitle('x'.repeat(100)).length <= 45, true);
  assert.equal(displayTitle(null), null);
});

test('unfurl card: /p/<slug> tags point og:image at /api/og with 1200x630 declared, for known and unknown planets', () => {
  const known = describeCard({ name: 'dear maya', message: 'hi', song: { provider: 'youtube', title: 'T' }, artworkUrl: 'https://x/art.jpg' }, 'dear-maya', 'https://go-astray.vercel.app');
  assert.equal(known.image, 'https://go-astray.vercel.app/api/og?name=dear-maya');
  const tags = ogTags(known);
  assert.match(tags, /og:image:width" content="1200"/);
  assert.match(tags, /og:image:height" content="630"/);
  assert.match(tags, /twitter:card" content="summary_large_image"/);
  const unknown = describeCard(null, 'gone', 'https://go-astray.vercel.app');
  assert.equal(unknown.image, 'https://go-astray.vercel.app/api/og?name=gone');
});
