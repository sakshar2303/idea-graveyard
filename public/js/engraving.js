// Generative ink engravings: every idea gets its own plate, seeded from its id.
const NS = 'http://www.w3.org/2000/svg';

function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const node = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// four plate styles: halftone, rings, hatching and sunburst, each clipped to an arch
const STYLES = [
  (g, r, S) => { // halftone dots that swell toward a random light source
    const lx = r() * S, ly = r() * S * 0.6, step = S / 18;
    for (let y = step / 2; y < S; y += step) for (let x = step / 2; x < S; x += step) {
      const d = Math.hypot(x - lx, y - ly) / S;
      const rad = Math.max(0.3, step * 0.48 * Math.min(1, d * 1.35));
      g.append(node('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: rad.toFixed(2) }));
    }
  },
  (g, r, S) => { // concentric rings from an off-centre point
    const cx = S * (0.25 + r() * 0.5), cy = S * (0.3 + r() * 0.5);
    for (let k = 1; k < 26; k++) g.append(node('circle', { cx, cy, r: (k * S / 22).toFixed(1), fill: 'none', 'stroke-width': (0.6 + (k % 3) * 0.5).toFixed(1) }));
  },
  (g, r, S) => { // cross hatching that thickens downward, like an etching
    const a = 30 + r() * 60;
    const lines = (angle, gap) => {
      const grp = node('g', { transform: `rotate(${angle} ${S / 2} ${S / 2})` });
      for (let y = -S; y < S * 2; y += gap) grp.append(node('line', { x1: -S, y1: y, x2: S * 2, y2: y, 'stroke-width': (0.5 + (y / S) * 1.1).toFixed(2) }));
      g.append(grp);
    };
    lines(a, S / 20);
    if (r() > 0.4) lines(a + 90, S / 14);
  },
  (g, r, S) => { // sunburst rays rising from the ground, a new dawn
    const cx = S * (0.3 + r() * 0.4), cy = S * 1.02, n = 36 + Math.floor(r() * 20);
    for (let k = 0; k < n; k++) {
      const t = Math.PI + (k / (n - 1)) * Math.PI;
      g.append(node('line', { x1: cx, y1: cy, x2: (cx + Math.cos(t) * S * 1.6).toFixed(1), y2: (cy + Math.sin(t) * S * 1.6).toFixed(1), 'stroke-width': k % 2 ? 0.6 : 1.4 }));
    }
    g.append(node('circle', { cx, cy, r: S * 0.16, fill: 'currentColor' }));
  },
];

export function engraving(id, title, { size = 120, label = true } = {}) {
  const S = 100, r = rng(id);
  const style = Math.floor(r() * STYLES.length);
  const uid = `p${String(id).replace(/[^a-z0-9]/gi, '').slice(0, 12)}${size}`;
  const svg = node('svg', { viewBox: `0 0 ${S} ${S * 1.25}`, width: size, height: size * 1.25, class: 'engraving', 'aria-hidden': 'true' });
  const defs = node('defs', {});
  const clip = node('clipPath', { id: uid });
  const arch = `M6 ${S * 1.25 - 4} V${S * 0.5} A${S / 2 - 6} ${S / 2 - 6} 0 0 1 ${S - 6} ${S * 0.5} V${S * 1.25 - 4} Z`;
  clip.append(node('path', { d: arch }));
  defs.append(clip);
  svg.append(defs);
  const g = node('g', { 'clip-path': `url(#${uid})`, fill: 'currentColor', stroke: 'currentColor' });
  STYLES[style](g, r, S * 1.25);
  svg.append(g);
  svg.append(node('path', { d: arch, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
  if (label) {
    // a paper roundel with the idea's initial, like a monogram on a headstone
    svg.append(node('circle', { cx: S / 2, cy: S * 0.72, r: 17, fill: 'var(--paper)', stroke: 'currentColor', 'stroke-width': 1.2 }));
    const t = node('text', { x: S / 2, y: S * 0.72 + 8, 'text-anchor': 'middle', class: 'engraving-initial' });
    t.textContent = (title || '?').trim()[0].toUpperCase();
    svg.append(t);
  }
  return svg;
}
