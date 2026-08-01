// The hero migration: spines leave the cart rail and land on the shelf, one at
// a time, at roughly the pace the extension actually works at.

(function () {
  const rack = document.getElementById('rack');
  const tally = document.getElementById('tally');
  if (!rack || !tally) return;

  const spines = [...rack.querySelectorAll('.spine')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function setTally(n) {
    tally.textContent = `${n} book${n === 1 ? '' : 's'}`;
  }

  function run() {
    if (reduced.matches) {
      rack.classList.add('running');
      setTally(spines.length);
      return;
    }
    rack.classList.remove('running');
    setTally(0);
    // Next frame, so removing and re-adding the class actually re-triggers.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rack.classList.add('running');
        spines.forEach((_, i) => setTimeout(() => setTally(i + 1), 300 + i * 260));
      });
    });
  }

  // Hold until the rack is on screen, so the one animation isn't spent offscreen.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        setTimeout(run, 350);
      }
    },
    { threshold: 0.4 }
  );
  observer.observe(rack);

  const replay = document.createElement('button');
  replay.className = 'replay';
  replay.type = 'button';
  replay.textContent = 'Run it again';
  replay.addEventListener('click', run);
  rack.append(replay);
})();
