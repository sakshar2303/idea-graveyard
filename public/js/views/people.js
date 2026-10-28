// Profiles, the Hall of Souls leaderboard, and the moderation queue.
import { el, icon, avatar, fmtDate, toast } from '../ui.js';
import { api, post } from '../api.js';
import { state } from '../state.js';
import { graveCard, emptyState, statusPill } from '../components.js';
import { openSettings, openBury } from '../dialogs.js';
import { reveal } from '../motion.js';

export async function profileView(main, ctx) {
  let p;
  try { p = await api(`/api/users/${encodeURIComponent(ctx.params.username)}`); }
  catch (err) { main.replaceChildren(el('div', { class: 'page' }, emptyState('No such soul', err.message))); return; }
  document.title = `${p.displayName} · Idea Graveyard`;
  const isMe = state.me?.username.toLowerCase() === p.username.toLowerCase();
  let tab = ctx.query.get('tab') === 'resurrecting' ? 'resurrecting' : 'buried';
  const grid = el('div', { class: 'grid' });
  const tabs = el('div', { class: 'tabs' });
  const paint = () => {
    tabs.replaceChildren(
      el('button', { class: 'tab', 'aria-pressed': String(tab === 'buried'), text: `Buried (${p.stats.buried})`, onclick: () => { tab = 'buried'; paint(); } }),
      el('button', { class: 'tab', 'aria-pressed': String(tab === 'resurrecting'), text: `Resurrecting (${p.stats.resurrecting})`, onclick: () => { tab = 'resurrecting'; paint(); } }));
    const list = tab === 'buried' ? p.buried : p.resurrecting.map(r => r.idea);
    const cards = list.map(graveCard);
    reveal(cards, { kind: 'rise' });
    grid.replaceChildren(...(cards.length ? cards : [emptyState(
      tab === 'buried' ? 'No graves dug yet' : 'Not resurrecting anything yet',
      isMe ? (tab === 'buried' ? 'Bury the first idea from your notes app.' : 'Find an idea worth a second life.') : 'Check back later.',
      isMe && tab === 'buried' ? el('button', { class: 'btn btn-primary', onclick: openBury }, icon('shovel'), 'Bury an idea') : null)]));
  };
  const stat = (n, l) => el('div', {}, el('b', { text: n }), l);
  main.replaceChildren(el('div', { class: 'page' },
    el('section', { class: 'profile-head' }, avatar(p, 'avatar-lg'),
      el('div', {}, el('h1', { text: p.displayName }), el('div', { class: 'handle', text: `@${p.username} · joined ${fmtDate(p.joinedAt)}` }),
        p.bio ? el('p', { class: 'bio', text: p.bio }) : null,
        el('div', { class: 'mini-stats' }, stat(p.stats.buried, 'ideas buried'), stat(p.stats.resurrecting, 'resurrecting'), stat(p.stats.launched, 'brought back to life'), stat(p.stats.candles, 'candles received'))),
      el('span', { class: 'spacer' }),
      isMe ? el('button', { class: 'btn', onclick: openSettings, text: 'Edit profile' }) : null),
    el('div', { class: 'toolbar' }, tabs), grid));
  paint();
}

export async function leaderboardView(main) {
  document.title = 'Hall of Souls · Idea Graveyard';
  main.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'scan', text: 'Counting souls…' })));
  let lb;
  try { lb = await api('/api/leaderboard'); }
  catch (err) { main.replaceChildren(el('div', { class: 'page' }, emptyState('The hall is locked', err.message))); return; }

  const rank = (items, val, sub) => items.length ? items.map((u, i) => el('a', { class: 'rank', href: `/u/${encodeURIComponent(u.username)}`, 'data-link': true },
    el('span', { class: 'n', text: i + 1 }), avatar(u, 'avatar-sm'), el('span', { class: 'who' }, el('b', { text: u.displayName }), el('span', { text: sub(u) })),
    el('span', { class: 'val', text: val(u) }))) : el('p', { class: 'dlg-sub', text: 'Nobody yet. This could be you.' });
  const ideaRank = (items, val, label) => items.map((it, i) => el('a', { class: 'rank', href: `/idea/${it.id}`, 'data-link': true },
    el('span', { class: 'n', text: i + 1 }), el('span', { class: 'who' }, el('b', { text: it.title }), el('span', { text: `“${it.epitaph}”` })),
    it.status !== 'dead' ? statusPill(it.status) : null, el('span', { class: 'val', title: label, text: val(it) })));
  const maxCause = Math.max(1, ...lb.causes.map(c => c.count));
  const bars = el('div', { class: 'bars' }, lb.causes.map(c => el('div', { class: 'bar-row' }, el('span', { text: c.cause }),
    el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', 'data-w': `${(c.count / maxCause) * 100}%` })), el('b', { text: c.count }))));

  main.replaceChildren(el('div', { class: 'page' },
    el('section', { class: 'lb-hero' }, el('h1', { text: 'Hall of Souls' }), el('p', { text: 'The builders who raise the dead, and the problems the community wants solved most.' })),
    el('div', { class: 'lb' },
      el('section', { class: 'card' }, el('h2', {}, icon('res'), 'Top resurrectionists'),
        rank(lb.builders, u => u.launched ? `${u.launched}★` : u.resurrections, u => `${u.resurrections} resurrected · ${u.launched} alive · ${u.building} building`)),
      el('section', { class: 'card' }, el('h2', {}, icon('same'), 'Most wanted problems'), ideaRank(lb.mostWanted, it => it.counts.same, 'people with this problem')),
      el('section', { class: 'card' }, el('h2', {}, icon('candle'), 'Most mourned'), ideaRank(lb.mostMourned, it => it.counts.candles, 'candles')),
      el('section', { class: 'card' }, el('h2', {}, icon('shovel'), 'Top gravediggers'), rank(lb.gravediggers, u => u.buried, u => `${u.candles} candles received`)),
      el('section', { class: 'card' }, el('h2', {}, icon('skull'), 'Leading causes of death'), bars))));
  reveal([...main.querySelectorAll('.lb .card')]);
  const barsCard = bars.closest('.card');
  barsCard.addEventListener('reveal', () => main.querySelectorAll('.bar-fill').forEach(b => { b.style.width = b.dataset.w; }), { once: true });
  if (barsCard.classList.contains('in')) main.querySelectorAll('.bar-fill').forEach(b => { b.style.width = b.dataset.w; });
}

export async function adminView(main) {
  document.title = 'Groundskeeper · Idea Graveyard';
  if (!state.me?.admin) { main.replaceChildren(el('div', { class: 'page' }, emptyState('Groundskeepers only', 'You need admin access to see this page.'))); return; }
  const list = el('div');
  const load = async () => {
    const { reports } = await api('/api/admin/reports');
    list.replaceChildren(...(reports.length ? reports.map(r => el('div', { class: 'admin-row' },
      el('div', { class: 'info' }, el('a', { href: `/idea/${r.idea_id}`, 'data-link': true, text: r.title }),
        el('p', { text: `“${r.reason}” · reported by @${r.username} · ${fmtDate(r.created_at)}${r.hidden ? ' · hidden' : ''}` })),
      ['dismiss', r.hidden ? 'restore' : 'hide'].map(action => el('button', { class: `btn btn-sm ${action === 'hide' ? 'btn-danger' : ''}`, text: action[0].toUpperCase() + action.slice(1),
        onclick: async () => { try { await post(`/api/admin/ideas/${r.idea_id}/${action}`); toast('Done.'); load(); } catch (e) { toast(e.message, 'error'); } } })))) :
      [el('p', { class: 'dlg-sub', text: 'No open reports. The graveyard is peaceful.' })]));
  };
  main.replaceChildren(el('div', { class: 'page' }, el('section', { class: 'lb-hero' }, el('h1', { text: 'Groundskeeper' }), el('p', { text: 'Reported graves waiting for review.' })),
    el('section', { class: 'card' }, el('h2', { text: 'Open reports' }), list)));
  load().catch(e => toast(e.message, 'error'));
}
