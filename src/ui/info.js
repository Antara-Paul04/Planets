// The info sheet: a calm, self-chosen note from the universe. It never opens
// on its own and never blocks — no acceptance, no checkbox, no gate. Opened
// from the persistent ⓘ button; closed by ×, Escape, or clicking the dark.
//
// Copy is deliberately human: community guidelines + a little orientation.
// The technical moderation mechanism (IP hashing, database, backend) is never
// exposed — only "reported by three different people."

export function createInfoSheet() {
  const overlay = document.createElement('div');
  overlay.id = 'info-sheet';
  overlay.innerHTML = `
    <div class="info-inner">
      <button class="info-close" title="close" aria-label="close">&times;</button>

      <section class="info-block">
        <h2>a note from the universe</h2>
        <p>Everyone gets a place here.</p>
        <p>Make something weird. Make something beautiful. Make something completely pointless.</p>
        <p>Just don't use your planet to:</p>
        <ul>
          <li>harass or target people</li>
          <li>spread hate or racism</li>
          <li>attack a community</li>
          <li>create hateful or abusive content</li>
        </ul>
        <p>This is a shared universe. If a planet is reported by three different people, it will be removed from the universe.</p>
        <p class="info-quiet">There are no accounts. There are no owners. Just planets.</p>
      </section>

      <div class="info-cols">
        <section class="info-block">
          <h3>how to move</h3>
          <ul class="info-plain">
            <li>drag to look around</li>
            <li>scroll to zoom</li>
            <li>click a planet or a distant sun to travel</li>
            <li>stop, and the universe drifts on its own</li>
          </ul>
        </section>

        <section class="info-block">
          <h3>make a planet</h3>
          <ul class="info-plain">
            <li>draw a little world</li>
            <li>give it a name</li>
            <li>launch it into the universe</li>
          </ul>
        </section>

        <section class="info-block">
          <h3>about the universe</h3>
          <ul class="info-plain">
            <li>the stars are already here</li>
            <li>the planets are made by visitors</li>
            <li>solar systems grow as people add worlds</li>
            <li>when they fill up, the universe makes room</li>
          </ul>
        </section>

        <section class="info-block">
          <h3>reporting</h3>
          <ul class="info-plain">
            <li>a planet that doesn't belong can be reported</li>
            <li>three different people, and it's gone</li>
          </ul>
        </section>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.classList.remove('open');
  const open = () => overlay.classList.add('open');
  const isOpen = () => overlay.classList.contains('open');

  overlay.querySelector('.info-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }); // click the dark to close
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  return { open, close, isOpen };
}
