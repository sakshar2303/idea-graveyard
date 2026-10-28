// The graveyard: hero, live stats, filters and the tombstone wall.
import { el, icon, toast } from '../ui.js';
import { api } from '../api.js';
import { state, requireAuth } from '../state.js';
import { setQuery } from '../router.js';
import { graveCard, skeletonGrid, emptyState } from '../components.js';
import { openBury } from '../dialogs.js';

const SORTS = [['trending', 'Trending'], ['new', 'Fresh graves'], ['wanted', 'Most wanted'], ['mourned', 'Most mourned'], ['risen', 'Risen'], ['old', 'Ancient']];
const STATUSES = [['', 'All souls'], ['dead', 'Resting'], ['risen', 'Rising'], ['launched', 'Alive again']];

function countUp(node, to) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || to < 3) { node.textContent = to.toLocaleString('en-IN'); return; }
  const start = performance.now(), dur = 900;
  const tick = now => {
    const p = Math.min(1, (now - start) / dur);
    node.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString('en-IN');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export async function homeView(main, ctx) {
  document.title = 'Idea Graveyard · Bury ideas. Resurrect them.';
  const f = {
    sort: ctx.query.get('sort') || 'trending', status: ctx.query.get('status') || '', cause: ctx.query.get('cause') || '',
    tag: ctx.query.get('tag') || '', q: ctx.query.get('q') || '',
  };

  const statNodes = {};
  const stat = (key, label, cls = '') => el('div', { class: `stat ${cls}` }, statNodes[key] = el('b', { text: '·' }), el('span', { text: label }));
  const hero = el('section', { class: 'hero' },
    el('span', { class: 'eyebrow' }, el('span', { class: 'ticker-dot' }), 'Where startup ideas go to rest, and come back'),
    el('h1', {}, 'Every idea deserves', el('br'), 'a ', el('em', { text: 'second life' }), '.'),
    el('p', { text: 'Bury the ideas dying in your notes app. Light a candle for the problems you feel too. Resurrect someone else\'s idea and build it.' }),
    el('div', { class: 'hero-cta' },
      el('button', { class: 'btn btn-primary btn-lg', onclick: async () => { if (await requireAuth('Sign in to bury your idea.')) openBury(); } }, icon('shovel'), 'Bury an idea'),
      el('a', { class: 'btn btn-lg', href: '/?sort=wanted', 'data-link': true }, icon('res'), 'Find one to resurrect')),
    el('div', { class: 'stats' }, stat('buried', 'Buried'), stat('validations', 'Me too’s', ''), stat('risen', 'Resurrected', 'soul'), stat('launched', 'Alive again', 'gold')));

  const grid = el('div', { class: 'grid', 'aria-live': 'polite', 'aria-busy': 'true' }, skeletonGrid());
  const note = el('p', { class: 'result-note' });
  const more = el('div', { class: 'more' });
  const tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Sort' });
  const statusSel = el('select', { class: 'select', 'aria-label': 'Filter by status' }, STATUSES.map(([v, l]) => el('option', { value: v, text: l })));
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Cause of death' });
  statusSel.value = f.status;

  const paintControls = () => {
    tabs.replaceChildren(...SORTS.map(([v, l]) => el('button', { class: 'tab', type: 'button', 'aria-pressed': String(f.sort === v), text: l, onclick: () => { f.sort = v; reload(); } })));
    chips.replaceChildren(...['', ...state.causes].map(c => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(f.cause === c), text: c || 'Any cause', onclick: () => { f.cause = c; reload(); } })),
      ...[f.tag ? el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', text: `#${f.tag} ✕`, onclick: () => { f.tag = ''; reload(); } }) : null,
        f.q ? el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', text: `“${f.q}” ✕`, onclick: () => { f.q = ''; reload(); } }) : null].filter(Boolean));
  };
  statusSel.addEventListener('change', () => { f.status = statusSel.value; reload(); });

  main.replaceChildren(el('div', { class: 'page' }, hero, el('div', { class: 'toolbar' }, tabs, statusSel), chips, note, grid, more));
  paintControls();

  api('/api/stats').then(s => Object.entries(statNodes).forEach(([k, n]) => countUp(n, s[k] ?? 0))).catch(() => {});

  let seq = 0;
  async function load(offset = 0) {
    const mine = ++seq;
    const qs = new URLSearchParams({ sort: f.sort, offset });
    for (const k of ['status', 'cause', 'tag', 'q']) if (f[k]) qs.set(k, f[k]);
    try {
      const r = await api(`/api/ideas?${qs}`);
      if (mine !== seq) return;
      const cards = r.ideas.map(graveCard);
      if (offset === 0) grid.replaceChildren(...(cards.length ? cards : [emptyState('No graves here yet', 'Nothing matches these filters. Try another, or bury the first one.')]));
      else grid.append(...cards);
      grid.setAttribute('aria-busy', 'false');
      note.textContent = f.q || f.tag || f.cause || f.status ? `${r.total} ${r.total === 1 ? 'grave' : 'graves'} found` : '';
      more.replaceChildren(r.nextOffset != null ? el('button', { class: 'btn', text: 'Dig deeper', onclick: e => { e.currentTarget.disabled = true; load(r.nextOffset); } }) : '');
    } catch (err) {
      grid.replaceChildren(emptyState('The fog is too thick', err.message, el('button', { class: 'btn', text: 'Try again', onclick: () => load() })));
    }
  }

  function reload() {
    setQuery(f);
    paintControls();
    grid.replaceChildren(...skeletonGrid(4));
    load();
  }

  // live: a fresh burial or resurrection quietly refreshes the wall
  const onLive = () => { if (window.scrollY < 600) load(); };
  document.addEventListener('graveyard:live', onLive);
  ctx.cleanup = () => document.removeEventListener('graveyard:live', onLive);

  load();
  if (ctx.query.get('welcome')) toast('Welcome to the graveyard.');
}
