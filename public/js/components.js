// Obituary entries and the candle / me-too / revive actions shared across pages.
import { el, fmtDate, bump, toast, plural } from './ui.js';
import { post } from './api.js';
import { requireAuth } from './state.js';
import { openResurrect } from './dialogs.js';

const STATUS_LABEL = { dead: 'Deceased', planning: 'Revival planned', building: 'Revival underway', launched: 'Revived' };
export const statusPill = s => el('span', { class: `status st-${s}`, text: STATUS_LABEL[s] || s });

// small-caps line above a headline: the status for revived ideas, the cause otherwise
export function kicker(idea) {
  return idea.status === 'dead'
    ? el('div', { class: 'kicker' }, el('span', { text: 'Cause of death' }), idea.cause)
    : el('div', { class: `kicker revived st-${idea.status}` }, el('span', { text: STATUS_LABEL[idea.status] }), idea.cause);
}

export function survivedBy(idea) {
  const n = idea.counts.same;
  if (!n) return null;
  return el('p', { class: 'survived', text: `Survived by ${plural(n, 'person')} with the same problem.` });
}

export function actionBar(idea, { onChange } = {}) {
  const mine = idea.mine || {};
  const mk = (kind, label, count, on) => el('button', {
    class: `act ${kind}${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!!on),
    onclick: async e => {
      e.preventDefault(); e.stopPropagation();
      const btn = e.currentTarget;
      if (kind === 'res') {
        if (!(await requireAuth('Sign in to revive this idea.'))) return;
        if (idea.mine?.resurrected) return toast('You are already reviving this one.');
        return openResurrect(idea, updated => onChange?.(updated));
      }
      if (!(await requireAuth(kind === 'candle' ? 'Sign in to light a candle.' : 'Sign in to say you have this problem too.'))) return;
      try {
        const r = await post(`/api/ideas/${idea.id}/${kind}`);
        Object.assign(idea, { counts: r.counts, mine: r.mine });
        bump(btn);
        if (kind === 'same' && r.on) toast('Counted. That is real validation for this problem.');
        onChange?.(idea);
      } catch (err) { toast(err.message, 'error'); }
    },
  }, el('span', { class: 'act-label', text: label }), el('span', { class: 'act-n', text: count }));
  return el('div', { class: 'actions' },
    mk('candle', mine.candle ? 'Candle lit' : 'Candle', idea.counts.candles, mine.candle),
    mk('same', 'Me too', idea.counts.same, mine.same),
    mk('res', mine.resurrected ? 'Reviving' : 'Revive', idea.counts.resurrections, mine.resurrected));
}

// one obituary in the columns
export function graveCard(idea) {
  const holder = el('div', { class: 'cell' });
  const paint = () => {
    const entry = el('article', { class: `obit${idea.status !== 'dead' ? ' is-revived' : ''}` },
      kicker(idea),
      el('h3', { class: 'obit-title' }, el('a', { class: 'stone-link', href: `/idea/${idea.id}`, 'data-link': true, text: idea.title })),
      el('p', { class: 'obit-epitaph', text: `“${idea.epitaph}”` }),
      el('p', { class: 'obit-meta' }, `Buried ${fmtDate(idea.buriedAt)} by `,
        el('a', { href: `/u/${encodeURIComponent(idea.author.username)}`, 'data-link': true, text: idea.author.displayName })),
      survivedBy(idea),
      actionBar(idea, { onChange: updated => { Object.assign(idea, updated); paint(); } }));
    holder.replaceChildren(entry);
  };
  paint();
  return holder;
}

// a press clipping of an idea, used for the live preview when burying
export function stoneFace(idea) {
  const wrap = el('div', { class: 'clipping' },
    el('div', { class: 'clipping-head', text: 'Obituary' }),
    kicker(idea),
    el('h3', { class: 'obit-title', text: idea.title }),
    el('p', { class: 'obit-epitaph', text: `“${idea.epitaph}”` }),
    el('p', { class: 'obit-meta', text: `Buried ${fmtDate(idea.buriedAt)}` }),
    idea.tags?.length ? el('p', { class: 'obit-tags', text: idea.tags.map(t => `#${t}`).join('  ') }) : null);
  return { wrap, stone: wrap };
}

export function skeletonGrid(n = 6) {
  return Array.from({ length: n }, () => el('div', { class: 'cell skeleton' },
    el('div', { class: 'obit' }, el('i', { class: 'bar w30' }), el('i', { class: 'bar w80 tall' }), el('i', { class: 'bar w60' }), el('i', { class: 'bar w70' }))));
}

export function emptyState(title, text, action) {
  return el('div', { class: 'empty' }, el('h3', { text: title }), el('p', { text }), action || null);
}
