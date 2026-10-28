// The front page: lead obituary, the rail, and the obituary columns.
import { el, toast, fmtDate, plural } from '../ui.js';
import { api } from '../api.js';
import { state, requireAuth } from '../state.js';
import { setQuery } from '../router.js';
import { graveCard, skeletonGrid, emptyState, kicker, actionBar, survivedBy, statusPill } from '../components.js';
import { openBury } from '../dialogs.js';
import { reveal, countWhenVisible } from '../motion.js';

const SORTS = [['new', 'Latest'], ['trending', 'Trending'], ['wanted', 'Most wanted'], ['risen', 'Revivals']];

export async function homeView(main, ctx) {
  document.title = 'Idea Graveyard · Obituaries for startup ideas';
  const f = { sort: ctx.query.get('sort') || 'new', cause: ctx.query.get('cause') || '', status: ctx.query.get('status') || '', tag: ctx.query.get('tag') || '', q: ctx.query.get('q') || '' };
  if (!SORTS.some(([v]) => v === f.sort)) f.sort = 'new';
  const write = async () => { if (await requireAuth('Create an account to write an obituary.')) openBury(); };

  // ----- above the fold -----
  const lead = el('article', { class: 'lead' }, el('div', { class: 'lead-skeleton' }));
  const stats = {};
  const stat = (k, label) => el('li', {}, stats[k] = el('b', { text: '0' }), el('span', { text: label }));
  const revivedList = el('ol', { class: 'rail-list' });
  const rail = el('aside', { class: 'rail' },
    el('section', { class: 'rail-box' }, el('h2', { class: 'label', text: 'In this edition' }),
      el('ul', { class: 'figures' }, stat('buried', 'ideas buried'), stat('validations', 'people said “me too”'), stat('risen', 'ideas being revived'), stat('launched', 'brought back to life'))),
    el('section', { class: 'rail-box' }, el('h2', { class: 'label', text: 'Back from the dead' }), revivedList),
    el('section', { class: 'rail-box invite' },
      el('p', { text: 'Got an idea dying in your notes app? Give it a proper send-off. Someone might bring it back.' }),
      el('button', { class: 'btn btn-primary', onclick: write, text: 'Write an obituary' })));

  const front = el('section', { class: 'front' }, lead, rail);

  // ----- the columns -----
  const grid = el('div', { class: 'obits', 'aria-live': 'polite', 'aria-busy': 'true' }, skeletonGrid(6));
  const more = el('div', { class: 'more' });
  const note = el('p', { class: 'result-note' });
  const tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Sort obituaries' });
  const causeSel = el('select', { class: 'select', 'aria-label': 'Cause of death' },
    el('option', { value: '', text: 'All causes of death' }), state.causes.map(c => el('option', { value: c, text: c })));
  causeSel.value = f.cause;
  causeSel.addEventListener('change', () => { f.cause = causeSel.value; reload(); });
  const paintTabs = () => tabs.replaceChildren(...SORTS.map(([v, l]) =>
    el('button', { class: 'tab', type: 'button', 'aria-pressed': String(f.sort === v), text: l, onclick: () => { f.sort = v; reload(); } })));

  const wall = el('section', { class: 'wall', id: 'wall' },
    el('div', { class: 'section-bar' }, el('h2', { class: 'section-title', text: 'Obituaries' }), el('div', { class: 'section-controls' }, tabs, causeSel)),
    note, grid, more);

  main.replaceChildren(el('div', { class: 'page' }, front, wall));
  paintTabs();
  reveal([lead, ...rail.children]);

  // stats, the lead story and the revival list load independently
  api('/api/stats').then(s => Object.entries(stats).forEach(([k, n]) => countWhenVisible(n, s[k] ?? 0))).catch(() => {});
  api('/api/ideas?sort=wanted').then(r => paintLead(r.ideas[0])).catch(() => lead.replaceChildren());
  api('/api/ideas?sort=risen').then(r => {
    const risen = r.ideas.filter(i => i.status !== 'dead').slice(0, 4);
    revivedList.replaceChildren(...(risen.length ? risen.map(i => el('li', {},
      el('a', { href: `/idea/${i.id}`, 'data-link': true, text: i.title }), statusPill(i.status))) :
      [el('li', { class: 'muted', text: 'Nothing has risen yet. Be the first to revive an idea.' })]));
  }).catch(() => {});

  function paintLead(idea) {
    if (!idea) { lead.replaceChildren(emptyState('No obituaries yet', 'The first one is yours to write.')); return; }
    lead.replaceChildren(
      el('div', { class: 'lead-flag', text: 'Most wanted this week' }),
      kicker(idea),
      el('h1', { class: 'lead-title' }, el('a', { href: `/idea/${idea.id}`, 'data-link': true, text: idea.title })),
      el('p', { class: 'lead-deck', text: `“${idea.epitaph}”` }),
      idea.problem ? el('p', { class: 'lead-body', text: idea.problem }) : null,
      el('p', { class: 'obit-meta' }, `Buried ${fmtDate(idea.buriedAt)} by `,
        el('a', { href: `/u/${encodeURIComponent(idea.author.username)}`, 'data-link': true, text: idea.author.displayName }),
        idea.audience ? ` · Mourned by ${idea.audience.toLowerCase()}` : ''),
      survivedBy(idea),
      el('div', { class: 'lead-foot' }, actionBar(idea, { onChange: updated => paintLead(Object.assign(idea, updated)) }),
        el('a', { class: 'read-more', href: `/idea/${idea.id}`, 'data-link': true, text: `Read the full obituary${idea.counts.eulogies ? ` · ${plural(idea.counts.eulogies, 'condolence')}` : ''}` })));
  }

  let seq = 0;
  async function load(offset = 0) {
    const mine = ++seq;
    const qs = new URLSearchParams({ sort: f.sort, offset });
    for (const k of ['cause', 'status', 'tag', 'q']) if (f[k]) qs.set(k, f[k]);
    try {
      const r = await api(`/api/ideas?${qs}`);
      if (mine !== seq) return;
      const cards = r.ideas.map(graveCard);
      if (offset === 0) grid.replaceChildren(...(cards.length ? cards : [emptyState('Nothing here', 'No obituaries match. Try another cause of death.')]));
      else grid.append(...cards);
      reveal(cards);
      grid.setAttribute('aria-busy', 'false');
      const filters = [f.q && `“${f.q}”`, f.tag && `#${f.tag}`, f.status].filter(Boolean);
      note.replaceChildren(...(filters.length ? [`${plural(r.total, 'obituary')} for ${filters.join(', ')}. `,
        el('button', { class: 'link-btn', text: 'Clear', onclick: () => { f.q = f.tag = f.status = ''; reload(); } })] : []));
      more.replaceChildren(...(r.nextOffset != null ? [el('button', { class: 'btn', text: 'Older obituaries', onclick: e => { e.currentTarget.disabled = true; load(r.nextOffset); } })] : []));
    } catch (err) {
      grid.replaceChildren(emptyState('The presses jammed', err.message, el('button', { class: 'btn', text: 'Try again', onclick: () => load() })));
    }
  }

  function reload() {
    setQuery(f.sort === 'new' ? { ...f, sort: '' } : f);
    paintTabs();
    grid.replaceChildren(...skeletonGrid(3));
    load();
  }

  const onLive = () => load();
  document.addEventListener('graveyard:live', onLive);
  ctx.cleanup = () => document.removeEventListener('graveyard:live', onLive);

  load();
  if (ctx.query.get('sort') || ctx.query.get('tag') || ctx.query.get('q')) requestAnimationFrame(() => wall.scrollIntoView());
  if (ctx.query.get('welcome')) toast('Welcome to the graveyard.');
}
