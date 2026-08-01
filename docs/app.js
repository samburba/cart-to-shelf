// The shelf. Each spine moves on its own — click one to send that book over,
// or move them all. Travel distance is measured from the live layout rather
// than assumed, since the shelf labels change the geometry.

(function () {
  const rack = document.getElementById('rack');
  if (!rack) return;

  const from = rack.querySelector('[data-role="from"]');
  const to = rack.querySelector('[data-role="to"]');
  const counts = {
    from: rack.querySelector('[data-count="from"]'),
    to: rack.querySelector('[data-count="to"]'),
  };
  const spines = [...rack.querySelectorAll('.spine')];
  const all = document.getElementById('all');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  let timers = [];

  const label = (n) => `${n} book${n === 1 ? '' : 's'}`;

  function measure() {
    // Bottom edge to bottom edge: the line each row of spines stands on.
    const drop = to.getBoundingClientRect().bottom - from.getBoundingClientRect().bottom;
    rack.style.setProperty('--drop', `${Math.round(drop)}px`);
  }

  function tally() {
    const moved = spines.filter((s) => s.classList.contains('moved')).length;
    counts.from.textContent = label(spines.length - moved);
    counts.to.textContent = label(moved);
    all.textContent = moved === spines.length ? 'send them back' : 'move them all';
  }

  function move(spine, moved) {
    spine.classList.toggle('moved', moved);
    spine.setAttribute('aria-pressed', String(moved));
    tally();
  }

  for (const spine of spines) {
    spine.setAttribute('aria-pressed', 'false');
    spine.addEventListener('click', () => {
      measure();
      move(spine, !spine.classList.contains('moved'));
    });
  }

  function moveAll(moved) {
    timers.forEach(clearTimeout);
    timers = [];
    measure();

    const stagger = reduced.matches ? 0 : 140;
    spines.forEach((spine, i) => {
      timers.push(setTimeout(() => move(spine, moved), i * stagger));
    });
  }

  all.addEventListener('click', () => {
    const done = spines.every((s) => s.classList.contains('moved'));
    moveAll(!done);
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 150);
  });

  measure();
  tally();

  // Play once when it comes into view, so the idea lands without being asked.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        setTimeout(() => moveAll(true), 400);
      }
    },
    { threshold: 0.3 }
  );
  observer.observe(rack);
})();
