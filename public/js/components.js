// Tombstone card and the candle / me-too / resurrect actions shared across pages.
import { el, icon, fmtDate, tilt, bump, toast } from './ui.js';
import { post } from './api.js';
import { requireAuth } from './state.js';
import { openResurrect } from './dialogs.js';

const STATUS_LABEL = { dead: 'Deceased', planning: 'Stirring', building: 'Rising', launched: 'Alive' };
export const statusPill = s => el('span', { class: `status-pill st-${s}`, text: STATUS_LABEL[s] || s });

export const ripLabel = status => status === 'launched' ? 'IT LIVES' : status === 'dead' ? 'R.I.P.' : 'RISING';

export function stoneFace(idea, { big = false } = {}) {
  const wrap = el('div', { class: `grave ${idea.status === 'launched' ? 'launched' : idea.status !== 'dead' ? 'risen' : ''}` });
  // the title link stretches over the whole stone; footer controls sit above it
  const title = big ? idea.title : el('a', { class: 'stone-link', href: `/idea/${idea.id}`, 'data-link': true, text: idea.title });
  const stone = el('div', { class: 'stone' },
    el('div', { class: 'rip', text: ripLabel(idea.status) }),
    el(big ? 'h1' : 'h3', { class: 'engraved' }, title),
    el('p', { class: 'epitaph', text: `“${idea.epitaph}”` }),
    el('div', { class: 'cause' }, idea.cause, el('span', { class: 'dot', text: '·' }), fmtDate(idea.buriedAt)),
    big && idea.tags?.length ? el('div', { class: 'tags' }, idea.tags.map(t => el('a', { class: 'tag', href: `/?tag=${encodeURIComponent(t)}`, 'data-link': true, text: `#${t}` }))) : null,
  );
  wrap.append(stone);
  if (!big) tilt(stone);
  return { wrap, stone };
}

export function actionBar(idea, { onChange } = {}) {
  const mine = idea.mine || {};
  const mk = (kind, label, ic, count, on) => el('button', {
    class: `act ${kind}${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!!on), 'aria-label': `${label} (${count})`, title: label,
    onclick: async e => {
      e.preventDefault(); e.stopPropagation();
      const btn = e.currentTarget;
      if (kind === 'res') {
        if (!(await requireAuth('Sign in to resurrect this idea.'))) return;
        if (idea.mine?.resurrected) return toast('You are already resurrecting this one.');
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
  }, icon(ic), String(count));
  return el('div', { class: 'actions' },
    mk('candle', 'Light a candle', 'candle', idea.counts.candles, mine.candle),
    mk('same', 'I have this problem too', 'same', idea.counts.same, mine.same),
    mk('res', mine.resurrected ? 'You are resurrecting this' : 'Resurrect', 'res', idea.counts.resurrections, mine.resurrected),
  );
}

export function graveCard(idea) {
  const holder = el('div', { class: 'cell' });
  const paint = () => {
    const { wrap, stone } = stoneFace(idea);
    const foot = el('div', { class: 'stone-foot' },
      actionBar(idea, { onChange: updated => { Object.assign(idea, updated); paint(); } }),
      el('div', { class: 'byline' }, 'by ', el('a', { href: `/u/${encodeURIComponent(idea.author.username)}`, 'data-link': true, text: idea.author.displayName })));
    stone.append(foot);
    holder.replaceChildren(wrap);
  };
  paint();
  return holder;
}

export function skeletonGrid(n = 8) {
  return Array.from({ length: n }, () => el('div', { class: 'grave skeleton' },
    el('div', { class: 'stone' }, el('div', { class: 'bar', style: { width: '30%' } }), el('div', { class: 'bar', style: { width: '80%', height: '22px' } }),
      el('div', { class: 'bar', style: { width: '60%' } }), el('div', { class: 'bar', style: { width: '70%' } }))));
}

export function emptyState(title, text, action) {
  return el('div', { class: 'empty' }, el('div', { class: 'big', text: '⚰️' }), el('h3', { text: title }), el('p', { text }), action || null);
}
