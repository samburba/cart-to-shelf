// The hero migration: spines leave the cart rail and land on the shelf below,
// one at a time. The travel distance is measured from the live layout rather
// than assumed — guessing it from spine height plus gap ignored the label rows
// and dropped the books on top of them.

(function () {
  const rack = document.getElementById('rack');
  if (!rack) return;

  const from = rack.querySelector('[data-role="from"]');
  const to = rack.querySelector('[data-role="to"]');
  const fromCount = rack.querySelector('[data-count="from"]');
  const toCount = rack.querySelector('[data-count="to"]');
  const spines = [...rack.querySelectorAll('.spine')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const STAGGER = 220;
  let timers = [];

  const label = (n) => `${n} book${n === 1 ? '' : 's'}`;

  function measure() {
    // Bottom edge to bottom edge: the shelf line each row of spines sits on.
    const drop = to.getBoundingClientRect().bottom - from.getBoundingClientRect().bottom;
    rack.style.setProperty('--drop', `${Math.round(drop)}px`);
  }

  function setCounts(moved) {
    fromCount.textContent = label(spines.length - moved);
    toCount.textContent = label(moved);
  }

  function run() {
    timers.forEach(clearTimeout);
    timers = [];
    measure();

    if (reduced.matches) {
      rack.classList.add('running');
      setCounts(spines.length);
      return;
    }

    rack.classList.remove('running');
    setCounts(0);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rack.classList.add('running');
        spines.forEach((_, i) => {
          timers.push(setTimeout(() => setCounts(i + 1), 420 + i * STAGGER));
        });
      });
    });
  }

  // Re-measure on resize; the shelves stack on narrow screens.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 150);
  });

  setCounts(0);
  measure();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        setTimeout(run, 300);
      }
    },
    { threshold: 0.3 }
  );
  observer.observe(rack);

  const replay = rack.querySelector('.replay') || document.createElement('button');
  replay.className = 'replay';
  replay.type = 'button';
  replay.textContent = 'Run it again';
  replay.addEventListener('click', run);
  rack.append(replay);
})();
