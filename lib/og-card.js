// The unfurl card: the image a planet's link previews as in iMessage, WhatsApp,
// X, Slack. 1200x630, the planet as a lit coin, its name, the line the maker
// left, the song if there is one, and its address. Rendered on the server
// with @vercel/og (satori -> resvg), so it works with no browser and no
// native canvas. Nothing here touches the visitor: crawlers fetch it.

import { ImageResponse } from '@vercel/og';
import { slugForName } from './song.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const BG = '#0a0d1c';
const INK = '#f2f4f8';
const INK_DIM = 'rgba(230, 232, 236, 0.62)';
const INK_FAINT = 'rgba(230, 232, 236, 0.38)';
const AMBER = '#ff7a2f';
const HAIR = 'rgba(230, 232, 236, 0.22)';

// ---- fonts: the app's own faces, fetched once per instance as TTF ----------
// Google Fonts hands back TTF or WOFF (both readable by satori; WOFF2 is not)
// when the request looks like an old browser. Any failure falls back to
// @vercel/og's bundled sans, so a card is always produced.
const FONT_CSS = {
  tech: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@600&display=swap',
  serif: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@1,400&display=swap',
  mono: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap',
};
const OLD_UA = 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0';
let fontCache = null;

async function loadFont(cssUrl, timeoutMs = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const css = await (await fetch(cssUrl, { headers: { 'User-Agent': OLD_UA }, signal: ctl.signal })).text();
    const m = /src:\s*url\(([^)]+\.(?:ttf|otf|woff))\)/.exec(css);
    if (!m) return null;
    const res = await fetch(m[1], { signal: ctl.signal });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function loadFonts() {
  if (fontCache) return fontCache;
  const [tech, serif, mono] = await Promise.all([loadFont(FONT_CSS.tech), loadFont(FONT_CSS.serif), loadFont(FONT_CSS.mono)]);
  const fonts = [];
  if (tech) fonts.push({ name: 'Tech', data: tech, weight: 600, style: 'normal' });
  if (serif) fonts.push({ name: 'Serif', data: serif, weight: 400, style: 'italic' });
  if (mono) fonts.push({ name: 'Mono', data: mono, weight: 400, style: 'normal' });
  fontCache = fonts;
  return fonts;
}

// artwork as a data URL so satori never has to fetch during layout
// resvg decodes PNG and JPEG only; older WebP artwork renders as a bare coin
export function bufferToDataUrl(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return `data:image/png;base64,${buf.toString('base64')}`;
  if (buf[0] === 0xff && buf[1] === 0xd8) return `data:image/jpeg;base64,${buf.toString('base64')}`;
  return null; // webp or unknown
}

export async function loadArtwork(url, timeoutMs = 2500) {
  if (!url) return null;
  if (url.startsWith('data:')) return /^data:image\/(png|jpeg);/.test(url) ? url : null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return null;
    return bufferToDataUrl(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const h = (type, style, children, extra = {}) => ({ type, props: { style, children, ...extra } });

// "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)" ->
// "Rick Astley - Never Gonna Give You Up": the card has one line for it
export function displayTitle(title, max = 44) {
  if (!title) return null;
  let t = String(title).replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|remaster|hd|4k|visuali[sz]er|mv)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return t || String(title).slice(0, max);
}

// the planet as a lit coin: the middle of the equirectangular art in a circle,
// a day/night terminator falling to the lower right, a faint atmosphere
function coin(artworkDataUrl, size) {
  const face = artworkDataUrl
    ? h('img', { position: 'absolute', left: -size / 2, top: 0, width: size * 2, height: size }, undefined, { src: artworkDataUrl })
    : h('div', { position: 'absolute', inset: 0, background: '#1a1e30' });
  return h('div', {
    position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
  }, [
    // atmosphere glow
    h('div', {
      position: 'absolute', left: -size * 0.14, top: -size * 0.14, width: size * 1.28, height: size * 1.28,
      borderRadius: '50%', background: 'radial-gradient(circle, rgba(150,180,255,0.30) 55%, rgba(150,180,255,0) 72%)',
    }),
    h('div', {
      position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      display: 'flex', background: '#12162a',
    }, [
      face,
      // terminator
      h('div', {
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'radial-gradient(circle at 34% 32%, rgba(0,0,0,0) 22%, rgba(0,0,0,0.14) 58%, rgba(0,0,0,0.72) 100%)',
      }),
      // day-side rim
      h('div', {
        position: 'absolute', inset: 0, borderRadius: '50%',
        border: '2px solid rgba(255,240,214,0.28)',
      }),
    ]),
  ]);
}

function stars(seed = 7) {
  const dots = [];
  for (let i = 0; i < 70; i++) {
    const x = ((i * 137.5 + seed * 31) % OG_WIDTH);
    const y = ((i * 89.3 + seed * 17) % OG_HEIGHT);
    const s = 1 + (i % 3);
    dots.push(h('div', { position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: '50%', background: `rgba(255,255,255,${0.18 + (i % 5) * 0.09})` }));
  }
  return dots;
}

// planet: { name, message, song:{title,provider}|null, artworkDataUrl }
export function cardElement(planet, { origin = 'https://go-astray.vercel.app' } = {}) {
  const name = planet && planet.name ? planet.name : 'a planet';
  const message = planet && planet.message ? planet.message : null;
  const song = planet && planet.song ? planet.song : null;
  const address = `${origin.replace(/^https?:\/\//, '')}/p/${planet && planet.name ? slugForName(planet.name) : ''}`;
  const kicker = message || song ? 'someone made this for you' : 'a planet in ASTRAY';
  const nameSize = name.length > 18 ? 56 : name.length > 11 ? 68 : 84;

  return h('div', {
    width: OG_WIDTH, height: OG_HEIGHT, display: 'flex', position: 'relative',
    background: BG, color: INK, fontFamily: 'Tech, sans-serif', overflow: 'hidden',
  }, [
    h('div', { position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 28% 50%, rgba(40,52,96,0.55) 0%, rgba(10,13,28,0) 60%)' }),
    ...stars(name.length),
    // corner ticks, like the instrument HUD
    h('div', { position: 'absolute', left: 36, top: 36, width: 22, height: 22, borderLeft: `1px solid ${AMBER}`, borderTop: `1px solid ${AMBER}` }),
    h('div', { position: 'absolute', right: 36, bottom: 36, width: 22, height: 22, borderRight: `1px solid ${AMBER}`, borderBottom: `1px solid ${AMBER}` }),

    // left: the coin
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 470, height: OG_HEIGHT }, [
      coin(planet && planet.artworkDataUrl, 330),
    ]),

    // right: the words
    h('div', { display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 730, height: OG_HEIGHT, paddingRight: 72, paddingLeft: 6 }, [
      h('div', { display: 'flex', alignItems: 'center', fontFamily: 'Mono, monospace', fontSize: 17, letterSpacing: 4, color: AMBER, textTransform: 'uppercase' }, [
        h('div', { width: 7, height: 7, borderRadius: '50%', background: AMBER, marginRight: 12 }),
        kicker,
      ]),
      h('div', { fontSize: nameSize, lineHeight: 1.02, letterSpacing: 4, textTransform: 'uppercase', marginTop: 18, color: INK, display: 'flex' }, name),
      message
        ? h('div', { fontFamily: 'Serif, serif', fontStyle: 'italic', fontSize: message.length > 48 ? 30 : 36, lineHeight: 1.25, color: 'rgba(244,241,232,0.92)', marginTop: 22, display: 'flex' }, `“${message}”`)
        : h('div', { fontFamily: 'Serif, serif', fontStyle: 'italic', fontSize: 30, color: INK_DIM, marginTop: 22, display: 'flex' }, 'tap to fly there'),
      song
        ? h('div', { display: 'flex', alignItems: 'center', fontFamily: 'Mono, monospace', fontSize: 17, letterSpacing: 2, color: INK_DIM, marginTop: 26, textTransform: 'uppercase' }, [
          h('div', { display: 'flex', alignItems: 'flex-end', height: 16, marginRight: 12 }, [3, 11, 7, 14].map((hh) => h('div', { width: 3, height: hh, background: AMBER, marginRight: 3 }))),
          (displayTitle(song.title) || 'a song') + (song.provider ? `  ·  ${song.provider}` : ''),
        ])
        : null,
      h('div', { display: 'flex', alignItems: 'center', marginTop: 34, paddingTop: 18, borderTop: `1px solid ${HAIR}`, fontFamily: 'Mono, monospace', fontSize: 16, letterSpacing: 2, color: INK_FAINT }, address),
    ]),
  ]);
}

export async function renderCard(planet, opts = {}) {
  const [fonts, artworkDataUrl] = await Promise.all([loadFonts(), loadArtwork(planet && planet.artworkUrl)]);
  const el = cardElement({ ...(planet || {}), artworkDataUrl }, opts);
  const res = new ImageResponse(el, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts.length ? fonts : undefined,
  });
  return Buffer.from(await res.arrayBuffer());
}
