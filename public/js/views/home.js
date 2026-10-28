// The graveyard: hero, how it works, and the tombstone wall.
import { el, icon, toast } from '../ui.js';
import { api } from '../api.js';
import { state, requireAuth } from '../state.js';
import { setQuery } from '../router.js';
import { graveCard, skeletonGrid, emptyState } from '../components.js';
import { openBury } from '../dialogs.js';
import { reveal, scrollLinked, countWhenVisible } from '../motion.js';

const SORTS = [['trending', 'Trending'], ['new', 'Fresh'], ['wanted', 'Most wanted'], ['risen', 'Risen']];

const STEPS = [
  ['I', 'Bury it', 'Give the idea in your notes app a proper funeral: the problem, who had it, and how it died.', 'shovel'],
  ['II', 'Let people feel it', 'Others light candles and tap “I have this problem too”. That is real validation, counted.', 'same'],
  ['III', 'Raise it', 'A builder resurrects it, posts progress, and ships it. The grave turns gold.', 'res'],
];

export async function homeView(main, ctx) {
  document.title = 'Idea Graveyard · Bury ideas. Resurrect them.';
  const f = { sort: ctx.query.get('sort') || 'trending', cause: ctx.query.get('cause') || '', status: ctx.query.get('status') || '', tag: ctx.query.get('tag') || '', q: ctx.query.get('q') || '' };
  if (!SORTS.some(([v]) => v === f.sort)) f.sort = 'trending';

  const bury = async () => { if (await requireAuth('Create an account to bury your idea.')) openBury(); };

  // ----- hero -----
  const nums = {};
  const num = (k, label, cls = '') => el('span', { class: `hero-stat ${cls}` }, nums[k] = el('b', { text: '0' }), label);
  const hero = el('section', { class: 'hero' }, el('div', { class: 'hero-inner' },
    el('span', { class: 'eyebrow' }, el('span', { class: 'ticker-dot' }), 'Where ideas rest, and come back'),
    el('h1', {}, 'Every idea deserves', el('br'), 'a ', el('em', { text: 'second life' }), '.'),
    el('p', { text: 'Bury the ideas dying in your notes app. Resurrect someone else’s and build it.' }),
    el('div', { class: 'hero-cta' },
      el('button', { class: 'btn btn-primary btn-lg', onclick: bury }, icon('shovel'), 'Bury an idea'),
      el('a', { class: 'btn btn-ghost btn-lg', href: '#wall' }, 'Explore the graves', icon('arrow'))),
    el('div', { class: 'hero-stats' }, num('buried', 'buried'), num('validations', 'me too’s'), num('risen', 'resurrected', 'soul'), num('launched', 'alive again', 'gold'))),
    el('a', { class: 'scroll-cue', href: '#how', 'aria-label': 'Scroll down' }, el('span')));

  // ----- how it works -----
  const line = el('div', { class: 'how-line' }, el('i'));
  const steps = STEPS.map(([n, t, d, ic]) => el('article', { class: 'how-step' },
    el('div', { class: 'how-num', text: n }), el('div', { class: 'how-icon' }, icon(ic)), el('h3', { text: t }), el('p', { text: d })));
  const how = el('section', { class: 'how', id: 'how' },
    el('h2', { class: 'section-head' }, el('small', { text: 'How it works' }), 'From the notes app to the afterlife, and back.'),
    el('div', { class: 'how-track' }, line, steps));
  reveal(how.querySelector('.section-head'), { stagger: false });
  reveal(steps);
  scrollLinked(how, p => line.style.setProperty('--draw', String(Math.min(1, p * 1.15))));

  // ----- wall -----
  const grid = el('div', { class: 'grid', 'aria-live': 'polite', 'aria-busy': 'true' }, skeletonGrid(6));
  const more = el('div', { class: 'more' });
  const note = el('p', { class: 'result-note' });
  const tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Sort' });
  const causeSel = el('select', { class: 'select', 'aria-label': 'Cause of death' },
    el('option', { value: '', text: 'Any cause of death' }), state.causes.map(c => el('option', { value: c, text: c })));
  causeSel.value = f.cause;
  causeSel.addEventListener('change', () => { f.cause = causeSel.value; reload(); });

  const paintTabs = () => tabs.replaceChildren(...SORTS.map(([v, l]) =>
    el('button', { class: 'tab', type: 'button', 'aria-pressed': String(f.sort === v), text: l, onclick: () => { f.sort = v; reload(); } })));
  const head = el('div', { class: 'wall-head' },
    el('h2', { class: 'section-head left' }, el('small', { text: 'The graveyard' }), 'Pick one to raise'),
    el('div', { class: 'wall-controls' }, tabs, causeSel));
  reveal(head, { stagger: false });

  const wall = el('section', { class: 'wall', id: 'wall' }, head, note, grid, more);
  main.replaceChildren(el('div', { class: 'page' }, hero, how, wall));
  paintTabs();

  api('/api/stats').then(s => Object.entries(nums).forEach(([k, n]) => countWhenVisible(n, s[k] ?? 0))).catch(() => {});

  let seq = 0;
  async function load(offset = 0) {
    const mine = ++seq;
    const qs = new URLSearchParams({ sort: f.sort, offset });
    for (const k of ['cause', 'status', 'tag', 'q']) if (f[k]) qs.set(k, f[k]);
    try {
      const r = await api(`/api/ideas?${qs}`);
      if (mine !== seq) return;
      const cards = r.ideas.map(graveCard);
      if (offset === 0) grid.replaceChildren(...(cards.length ? cards : [emptyState('No graves here yet', 'Nothing matches. Try another cause, or bury the first one.')]));
      else grid.append(...cards);
      reveal(cards, { kind: 'rise' });
      grid.setAttribute('aria-busy', 'false');
      const filters = [f.q && `“${f.q}”`, f.tag && `#${f.tag}`, f.status].filter(Boolean);
      note.replaceChildren(...(filters.length ? [`${r.total} ${r.total === 1 ? 'grave' : 'graves'} for ${filters.join(', ')} `,
        el('button', { class: 'link-btn', text: 'Clear', onclick: () => { f.q = f.tag = f.status = ''; reload(); } })] : []));
      more.replaceChildren(...(r.nextOffset != null ? [el('button', { class: 'btn', text: 'Dig deeper', onclick: e => { e.currentTarget.disabled = true; load(r.nextOffset); } })] : []));
    } catch (err) {
      grid.replaceChildren(emptyState('The fog is too thick', err.message, el('button', { class: 'btn', text: 'Try again', onclick: () => load() })));
    }
  }

  function reload() {
    setQuery(f);
    paintTabs();
    grid.replaceChildren(...skeletonGrid(3));
    load();
  }

  const onLive = () => { if (wall.getBoundingClientRect().top > innerHeight) load(); };
  document.addEventListener('graveyard:live', onLive);
  ctx.cleanup = () => document.removeEventListener('graveyard:live', onLive);

  load();
  if (ctx.query.toString() && ctx.query.get('sort')) requestAnimationFrame(() => wall.scrollIntoView());
  if (ctx.query.get('welcome')) toast('Welcome to the graveyard.');
}
