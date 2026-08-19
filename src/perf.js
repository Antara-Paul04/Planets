// Dev-only FPS / draw-call readout. Press "p" to hide it.
// (Planet stress-test buttons were removed: planets are user-generated only,
// so nothing may inject non-user planets into the universe.)

export function createPerfPanel({ renderer, field }) {
  const el = document.createElement('div');
  el.id = 'perf';
  el.innerHTML = '<span class="perf-stats">measuring…</span>';
  document.body.appendChild(el);
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
