// Dev-only FPS / draw-call readout with stress-test buttons.
// Press "p" to hide it.

export function createPerfPanel({ renderer, field, onSetCount }) {
  const el = document.createElement('div');
  el.id = 'perf';
  el.innerHTML =
    '<span class="perf-stats">measuring…</span>' +
    '<span class="perf-buttons">' +
    [50, 100, 250, 500, 1000].map((n) => `<button data-n="${n}">${n}</button>`).join(' ') +
    '</span>';
  document.body.appendChild(el);
  el.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => onSetCount(Number(b.dataset.n)))
  );
  const stats = el.querySelector('.perf-stats');

  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'p') el.style.display = el.style.display === 'none' ? '' : 'none';
  });

  let frames = 0;
  let acc = 0;
  return {
    tick(dt) {
      frames++;
      acc += dt;
      if (acc >= 0.5) {
        const fps = Math.round(frames / acc);
        const tris = Math.round(renderer.info.render.triangles / 1000);
        stats.textContent = `${fps} fps · ${field.planets.length} planets · ${renderer.info.render.calls} calls · ${tris}k tris`;
        frames = 0;
        acc = 0;
      }
    },
  };
}
