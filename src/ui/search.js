import { normalizeNameKey } from '../../lib/name.js';

// "search the universe" — a quiet field that finds planets by name. Typing
// queries the server (debounced); choosing a result hands its name back to the
// caller, which flies there with the existing travel system. No page, no
// dashboard — just a field and a short list.
export function createSearch({ query, onSelect }) {
  const overlay = document.createElement('div');
  overlay.id = 'search-panel';
  overlay.innerHTML = `
    <div class="search-inner">
      <input class="search-input" type="text" placeholder="search the universe…"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="24" />
      <div class="search-results"></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.search-input');
  const list = overlay.querySelector('.search-results');
  let seq = 0;
  let debounce = null;

  function fmtDate(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function render(results) {
    list.innerHTML = '';
    if (!results.length) {
      const e = document.createElement('div');
      e.className = 'search-empty';
      e.textContent = 'no planet by that name — yet';
      list.appendChild(e);
      return;
    }
    for (const r of results) {
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
    if (!q) { list.innerHTML = ''; return; }
    const { results } = await query(q);
    if (mine !== seq) return; // a newer keystroke already superseded this one
    // exact prefix first, then the rest — pleasant ordering for autocomplete
    const key = normalizeNameKey(q);
    results.sort((a, b) => {
      const pa = normalizeNameKey(a.name).startsWith(key) ? 0 : 1;
      const pb = normalizeNameKey(b.name).startsWith(key) ? 0 : 1;
      return pa - pb;
    });
    render(results);
  }

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => run(input.value), 200);
  });

  const open = () => {
    overlay.classList.add('open');
    input.value = '';
    list.innerHTML = '';
    setTimeout(() => input.focus(), 40);
  };
  const close = () => { overlay.classList.remove('open'); clearTimeout(debounce); };
  const isOpen = () => overlay.classList.contains('open');

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  return { open, close, isOpen };
}
