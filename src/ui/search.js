import { normalizeNameKey } from '../../lib/name.js';

// "search the universe" — a compact floating field that drops out of the search
// icon. It never covers or blurs the universe: the stars stay fully visible
// behind it. Typing queries the server live (debounced); choosing a result
// hands its name back to the caller, which flies there with the existing travel
// system. Just a quiet field and a short list.
export function createSearch({ query, onSelect }) {
  const overlay = document.createElement('div');
  overlay.id = 'search-panel';
  overlay.innerHTML = `
    <input class="search-input" type="text" placeholder="search the universe…"
      autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="24" />
    <div class="search-results"></div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.search-input');
  const list = overlay.querySelector('.search-results');
  const MAX_RESULTS = 5;
  let seq = 0;
  let debounce = null;

  function fmtDate(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function render(results, hadQuery) {
    list.innerHTML = '';
    if (!hadQuery) return; // empty field -> no list card at all
    if (!results.length) {
      const e = document.createElement('div');
      e.className = 'search-empty';
      e.textContent = 'no planet found';
      list.appendChild(e);
      return;
    }
    for (const r of results.slice(0, MAX_RESULTS)) {
      const b = document.createElement('button');
      b.className = 'search-result';
      const name = document.createElement('span');
      name.className = 'sr-name';
      name.textContent = r.name;
      const meta = document.createElement('span');
      meta.className = 'sr-meta';
      meta.textContent = r.createdAt ? `born ${fmtDate(r.createdAt)}` : '';
      b.append(name, meta);
      b.addEventListener('click', () => { close(); onSelect(r); });
      list.appendChild(b);
    }
  }

  async function run(raw) {
    const q = raw.trim();
    const mine = ++seq;
    if (!q) { render([], false); return; }
    const { results } = await query(q);
    if (mine !== seq) return; // a newer keystroke already superseded this one
    // exact prefix first, then the rest — pleasant ordering for autocomplete
    const key = normalizeNameKey(q);
    results.sort((a, b) => {
      const pa = normalizeNameKey(a.name).startsWith(key) ? 0 : 1;
      const pb = normalizeNameKey(b.name).startsWith(key) ? 0 : 1;
      return pa - pb;
    });
    render(results, true);
  }

  // live results while typing — never waits for Enter
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => run(input.value), 180);
  });

  // Enter is a convenience: pick the first result. Escape closes.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector('.search-result');
      if (first) { e.preventDefault(); first.click(); }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  const isOpen = () => overlay.classList.contains('open');
  const open = () => {
    overlay.classList.add('open');
    input.value = '';
    render([], false);
    setTimeout(() => input.focus(), 30);
  };
  const close = () => { overlay.classList.remove('open'); clearTimeout(debounce); };

  // no full-screen backdrop to catch clicks, so watch the document: a press
  // anywhere outside the field/results (and not on the toggle button, which
  // manages itself) closes search.
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen()) return;
    if (overlay.contains(e.target)) return;
    const btn = document.getElementById('search-btn');
    if (btn && (btn === e.target || btn.contains(e.target))) return;
    close();
  }, true);

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  return { open, close, isOpen };
}
