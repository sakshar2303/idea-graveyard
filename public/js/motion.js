// Scroll motion: reveal-on-scroll, a reading progress bar and scroll-linked drawing.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

let observer;
function getObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      e.target.dispatchEvent(new CustomEvent('reveal'));
      observer.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  return observer;
}

// mark nodes to animate in; `stagger` delays siblings one after another
export function reveal(nodes, { stagger = true, kind = '' } = {}) {
  const list = [].concat(nodes).filter(Boolean);
  list.forEach((n, i) => {
    n.setAttribute('data-reveal', kind);
    if (stagger) n.style.setProperty('--d', String(i % 8));
    if (reduced.matches) n.classList.add('in');
    else getObserver().observe(n);
  });
  return nodes;
}

// elements that move with scroll progress through the viewport
const linked = new Set();
export function scrollLinked(node, fn) {
  linked.add({ node, fn });
  tick();
}

let ticking = false;
function tick() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(frame);
}

function frame() {
  ticking = false;
  const y = scrollY, h = innerHeight;
  const doc = document.documentElement.scrollHeight - h;
  document.documentElement.style.setProperty('--scroll-p', doc > 0 ? (y / doc).toFixed(4) : '0');
  document.body.classList.toggle('scrolled', y > 40);
  if (reduced.matches) return;

  for (const item of linked) {
    if (!item.node.isConnected) { linked.delete(item); continue; }
    const r = item.node.getBoundingClientRect();
    // 0 when the node's top enters the bottom of the screen, 1 when its top reaches the middle
    const p = Math.max(0, Math.min(1, (h - r.top) / (h * 0.6)));
    item.fn(p);
  }
}

export function startMotion() {
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', tick);
  tick();
}

// count a number up when it scrolls into view
export function countWhenVisible(node, to) {
  const run = () => {
    if (reduced.matches || to < 3) { node.textContent = to.toLocaleString('en-IN'); return; }
    const start = performance.now(), dur = 1100;
    const step = now => {
      const p = Math.min(1, (now - start) / dur);
      node.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString('en-IN');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (node.classList.contains('in') || reduced.matches) return run();
  reveal(node, { stagger: false, kind: 'none' });
  node.addEventListener('reveal', run, { once: true });
}
