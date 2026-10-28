// One obituary: the deceased, the coroner's report, revival efforts and condolences.
import { el, icon, avatar, timeAgo, fmtDate, toast, moment, bump, plural } from '../ui.js';
import { api, post, patch, del } from '../api.js';
import { state, requireAuth } from '../state.js';
import { navigate } from '../router.js';
import { statusPill, emptyState, kicker } from '../components.js';
import { openResurrect, openReport, confirmDialog } from '../dialogs.js';
import { reveal } from '../motion.js';

const STATUS_COPY = { planning: 'Planning', building: 'Building', launched: 'Launched' };

export async function ideaView(main, ctx) {
  main.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'scan', text: 'Exhuming…' })));
  let idea;
  try { idea = await api(`/api/ideas/${encodeURIComponent(ctx.params.id)}`); }
  catch (err) {
    main.replaceChildren(el('div', { class: 'page' }, emptyState('This grave is empty', err.message, el('a', { class: 'btn', href: '/', 'data-link': true, text: 'Back to the graveyard' }))));
    return;
  }
  const paint = () => render(main, idea, next => { idea = next; paint(); });
  paint();

  const onLive = e => { if (e.detail?.id === idea.id) api(`/api/ideas/${idea.id}`).then(next => { idea = next; paint(); }).catch(() => {}); };
  document.addEventListener('graveyard:live', onLive);
  ctx.cleanup = () => document.removeEventListener('graveyard:live', onLive);
}

function render(main, idea, update) {
  document.title = `R.I.P. ${idea.title} · Idea Graveyard`;
  const head = el('header', { class: 'story-head' },
    kicker(idea),
    el('h1', { class: 'story-title', text: idea.title }),
    el('p', { class: 'story-deck', text: `“${idea.epitaph}”` }),
    el('div', { class: 'story-byline' }, 'Buried by ', el('a', { href: `/u/${encodeURIComponent(idea.author.username)}`, 'data-link': true, text: idea.author.displayName }),
      el('span', { text: `on ${fmtDate(idea.buriedAt)}` })),
    idea.tags?.length ? el('div', { class: 'story-tags' }, idea.tags.map(t => el('a', { class: 'tag', href: `/?tag=${encodeURIComponent(t)}`, 'data-link': true, text: `#${t}` }))) : null);

  const rail = el('aside', { class: 'story-rail' }, pulseCard(idea, update), shareBar(idea),
    el('div', { class: 'rail-tools' },
      idea.canDelete ? el('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
        if (!(await confirmDialog('Delete this obituary?', 'This permanently deletes the idea, its candles, condolences and revivals.', 'Delete'))) return;
        try { await del(`/api/ideas/${idea.id}`); toast('Obituary deleted.'); navigate('/'); } catch (e) { toast(e.message, 'error'); }
      } }, 'Delete obituary') : null,
      state.me && !idea.canDelete ? el('button', { class: 'btn btn-sm btn-text', onclick: () => openReport(idea) }, 'Report') : null));

  const cards = [certificateCard(idea), autopsyCard(idea, update), crewCard(idea, update), eulogyCard(idea, update)];
  // animate only on first paint, not on every in-place update
  if (!main.querySelector('.story')) reveal([head, ...cards]);

  main.replaceChildren(el('article', { class: 'page story' },
    el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, el('a', { href: '/', 'data-link': true, text: 'Obituaries' }), '/', el('span', { text: idea.cause })),
    head, el('div', { class: 'story-grid' }, el('div', { class: 'story-body' }, cards), rail)));
}

function shareBar(idea) {
  const url = `${location.origin}/idea/${idea.id}`;
  const text = `My idea "${idea.title}" just got buried at the Idea Graveyard. Epitaph: "${idea.epitaph}". Anyone want to resurrect it?`;
  return el('div', { class: 'share' },
    el('a', { class: 'btn btn-sm', target: '_blank', rel: 'noopener', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` }, 'LinkedIn'),
    el('button', { class: 'btn btn-sm', onclick: async () => {
      try {
        if (navigator.share && matchMedia('(hover: none)').matches) await navigator.share({ title: idea.title, text, url });
        else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Link and caption copied.'); }
      } catch {}
    } }, 'Copy link'),
    el('button', { class: 'btn btn-sm', onclick: () => downloadTombstone(idea) }, 'Clipping'));
}

function pulseCard(idea, update) {
  const mine = idea.mine || {};
  const tile = (kind, n, label, on, handler) => el('button', { class: `pulse ${kind}${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!!on), onclick: handler },
    el('b', { text: n }), el('span', { text: label }));
  const toggle = kind => async e => {
    const btn = e.currentTarget;
    if (!(await requireAuth(kind === 'candle' ? 'Sign in to light a candle.' : 'Sign in to say you have this problem too.'))) return;
    try {
      const r = await post(`/api/ideas/${idea.id}/${kind}`);
      bump(btn);
      update({ ...idea, counts: r.counts, mine: r.mine });
    } catch (err) { toast(err.message, 'error'); }
  };
  const resurrect = async () => {
    if (!(await requireAuth('Sign in to revive this idea.'))) return;
    if (mine.resurrected) return document.getElementById('crew')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    openResurrect(idea, update);
  };
  const same = idea.counts.same;
  return el('section', { class: 'respects', 'aria-label': 'Pay your respects' }, el('h2', { class: 'label', text: 'Pay your respects' }),
    el('div', { class: 'pulse-row' },
      tile('candle', idea.counts.candles, mine.candle ? 'Candle lit' : 'Light a candle', mine.candle, toggle('candle')),
      tile('same', same, mine.same ? 'You have this problem too' : 'I have this problem too', mine.same, toggle('same')),
      tile('res', idea.counts.resurrections, mine.resurrected ? 'You are reviving it' : 'Revive this idea', mine.resurrected, resurrect)),
    el('p', { class: 'pulse-hint', text: same >= 3
      ? `${plural(same, 'person')} said they have this problem. That is a signal worth building on.`
      : 'Every “me too” is real validation for whoever revives it.' }));
}

function certificateCard(idea) {
  const fact = (label, value, empty) => el('div', { class: 'fact' }, el('dt', { text: label }), el('dd', { class: value ? '' : 'dim', text: value || empty }));
  return el('section', { class: 'card' }, el('h2', { text: 'The deceased' }),
    el('dl', { class: 'facts' },
      fact('The problem', idea.problem, 'The founder did not say. Ask in the condolences.'),
      fact('Mourned by', idea.audience, 'Unknown'),
      fact('Cause of death', idea.cause),
      idea.story ? fact('What happened', idea.story) : null,
      fact('Time of death', fmtDate(idea.buriedAt))));
}

function autopsyCard(idea, update) {
  const card = el('section', { class: 'card', 'aria-live': 'polite' });
  const head = el('h2', { text: 'The coroner’s report' });
  if (idea.autopsy) {
    const a = idea.autopsy;
    card.append(head, el('div', { class: 'report' },
      el('div', { class: 'report-head' }, el('span', { text: 'Autopsy' }), el('span', { text: fmtDate(a.createdAt) })),
      el('div', { class: 'report-body' },
      el('p', { class: 'verdict', text: a.verdict }),
      el('div', { class: 'odds' }, el('div', { class: 'odds-ring', text: `${a.survivalOdds}%` }),
        el('p', {}, el('strong', { text: 'Odds of surviving a revival' }), a.whyNow)),
      el('div', { class: 'autopsy-grid' },
        el('div', {}, el('h3', { text: 'Root causes' }), el('ul', { class: 'cause-list' }, a.rootCauses.map(c => el('li', {}, el('b', { text: c.title }), el('span', { text: c.detail }))))),
        el('div', {}, el('h3', { text: 'How to revive it' }), el('ol', { class: 'plan' }, a.resurrectionPlan.map(s => el('li', {}, el('b', { text: s.step }), el('span', { text: s.detail }))))),
        el('div', {}, el('h3', { text: 'Ship this in 48 hours' }), el('div', { class: 'callout', text: a.mvp48h })),
        el('div', {}, el('h3', { text: 'Ask real users first' }), el('ol', { class: 'qs' }, a.validationQuestions.map(q => el('li', { text: q }))))),
      el('p', { class: 'ai-note', text: 'Performed by Claude. AI can be wrong, so check it with real users.' }))));
    return card;
  }
  if (!idea.aiEnabled) {
    card.append(head, el('div', { class: 'autopsy-cta' }, el('p', { text: 'The coroner is off duty. Reports switch on when the server has an Anthropic API key.' })));
    return card;
  }
  const btn = el('button', { class: 'btn btn-primary btn-lg', text: 'Request the coroner’s report' });
  btn.addEventListener('click', async () => {
    if (!(await requireAuth('Sign in to request the coroner’s report.'))) return;
    card.replaceChildren(head, el('div', { class: 'scan', text: 'The coroner is examining the body…' }));
    try {
      const r = await post(`/api/ideas/${idea.id}/autopsy`);
      update({ ...idea, autopsy: r.autopsy });
    } catch (err) {
      toast(err.message, 'error');
      update({ ...idea });
    }
  });
  card.append(head, el('div', { class: 'autopsy-cta' },
    el('p', { text: 'Claude examines the idea: why it really died, its odds in a second life, and a plan to ship it in 48 hours.' }), btn));
  return card;
}

function crewCard(idea, update) {
  const card = el('section', { class: 'card', id: 'crew' }, el('h2', {}, 'Revival efforts', el('span', { class: 'count', text: idea.resurrections.length }), el('span', { class: 'spacer' }),
    !idea.mine?.resurrected ? el('button', { class: 'btn btn-sm', onclick: async () => { if (await requireAuth('Sign in to revive this idea.')) openResurrect(idea, update); } }, 'Revive it') : null));
  if (!idea.resurrections.length) {
    card.append(el('p', { class: 'dlg-sub', text: 'Nobody is reviving this yet. Be the first to bring it back.' }));
    return card;
  }
  card.append(el('div', { class: 'crew' }, idea.resurrections.map(r => builderBlock(idea, r, update))));
  return card;
}

function builderBlock(idea, r, update) {
  const block = el('article', { class: 'builder' },
    el('div', { class: 'builder-head' }, avatar(r.user), el('a', { class: 'name', href: `/u/${encodeURIComponent(r.user.username)}`, 'data-link': true, text: r.user.displayName }),
      el('span', { class: 'spacer' }), statusPill(r.status)),
    r.link ? el('a', { class: 'link', href: r.link, target: '_blank', rel: 'noopener nofollow ugc' }, icon('link'), new URL(r.link).host) : null,
    el('ol', { class: 'timeline' }, [...r.updates].reverse().map(u => el('li', { class: `st-${u.status}` }, el('time', { text: `${STATUS_COPY[u.status]} · ${timeAgo(u.createdAt)}` }), u.note || `Moved to ${STATUS_COPY[u.status].toLowerCase()}.`))));

  if (r.mine) {
    const status = el('select', { class: 'select', 'aria-label': 'Status' }, Object.entries(STATUS_COPY).map(([v, l]) => el('option', { value: v, text: l })));
    status.value = r.status;
    const note = el('input', { class: 'input', maxlength: 400, placeholder: 'Post a progress update…' });
    const link = el('input', { class: 'input', type: 'url', maxlength: 300, placeholder: 'Project link', value: r.link });
    const save = el('button', { class: 'btn btn-soul btn-sm', text: 'Post update' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const next = await patch(`/api/resurrections/${r.id}`, { status: status.value, note: note.value, link: link.value });
        if (status.value === 'launched' && r.status !== 'launched') moment('launch', 'IT LIVES');
        else toast('Update posted.');
        update(next);
      } catch (e) { toast(e.message, 'error'); save.disabled = false; }
    });
    const abandon = el('button', { class: 'btn btn-ghost btn-sm btn-danger', text: 'Abandon', onclick: async () => {
      if (!(await confirmDialog('Abandon this revival?', 'Your plan and updates will be removed. The idea goes back to rest.', 'Abandon'))) return;
      try { update(await del(`/api/resurrections/${r.id}`)); toast('Revival abandoned.'); } catch (e) { toast(e.message, 'error'); }
    } });
    block.append(el('div', { class: 'mine-tools' }, note, el('div', { class: 'row' }, status, link), el('div', { class: 'row' }, save, el('span', { class: 'spacer' }), abandon)));
  }
  return block;
}

function eulogyCard(idea, update) {
  const body = el('textarea', { class: 'textarea', maxlength: 500, placeholder: state.me ? 'A few words for the departed…' : 'Sign in to leave a condolence', rows: 2 });
  const send = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Post' });
  const form = el('form', { class: 'compose', onsubmit: async e => {
    e.preventDefault();
    if (!(await requireAuth('Sign in to leave a condolence.'))) return;
    send.disabled = true;
    try { update(await post(`/api/ideas/${idea.id}/eulogies`, { body: body.value })); }
    catch (err) { toast(err.message, 'error'); send.disabled = false; }
  } }, body, send);
  return el('section', { class: 'card' }, el('h2', {}, 'Condolences', el('span', { class: 'count', text: idea.eulogies.length })),
    idea.eulogies.length ? idea.eulogies.map(e => el('div', { class: 'eulogy' }, avatar(e.user),
      el('div', { class: 'eulogy-body' },
        el('div', { class: 'eulogy-meta' }, el('a', { href: `/u/${encodeURIComponent(e.user.username)}`, 'data-link': true, text: e.user.displayName }), timeAgo(e.createdAt),
          e.canDelete ? el('button', { class: 'btn btn-ghost btn-sm del', 'aria-label': 'Delete condolence', onclick: async () => {
            try { update(await del(`/api/eulogies/${e.id}`)); } catch (err) { toast(err.message, 'error'); }
          } }, 'Delete') : null),
        el('p', { text: e.body })))) : el('p', { class: 'dlg-sub', text: 'No condolences yet. Say something kind, or honest.' }),
    form);
}

// draws a shareable 1080x1350 newspaper clipping of the obituary
async function downloadTombstone(idea) {
  await document.fonts?.ready;
  const W = 1080, H = 1350, M = 96;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#161514'; g.textAlign = 'center';

  const rule = (y, w = 2) => { g.fillRect(M, y, W - 2 * M, w); };
  g.font = '400 92px "Instrument Serif"'; g.fillText('Idea Graveyard', W / 2, 190);
  rule(222, 2); rule(230, 2);
  g.font = '500 22px "IBM Plex Mono"'; g.fillStyle = '#77716a';
  g.fillText(`OBITUARIES  ·  ${fmtDate(idea.buriedAt).toUpperCase()}`, W / 2, 272);

  const wrap = (text, font, color, top, lh, maxLines) => {
    g.font = font; g.fillStyle = color;
    const words = text.split(/\s+/); const lines = []; let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (g.measureText(t).width > W - 2 * M - 40 && line) { lines.push(line); line = w; } else line = t;
    }
    lines.push(line);
    lines.slice(0, maxLines).forEach((l, i) => g.fillText(l, W / 2, top + i * lh));
    return top + Math.min(lines.length, maxLines) * lh;
  };
  const revived = idea.status !== 'dead';
  g.font = '500 24px "IBM Plex Mono"'; g.fillStyle = revived ? '#2c6a4c' : '#b3321d';
  g.fillText(revived ? 'REVIVED' : `CAUSE OF DEATH  ·  ${idea.cause.toUpperCase()}`, W / 2, 400);
  let y = wrap(idea.title, '400 112px "Instrument Serif"', '#161514', 520, 112, 4);
  y = wrap(`“${idea.epitaph}”`, 'italic 400 52px "Instrument Serif"', '#3b3833', y + 40, 62, 4);
  if (idea.counts.same) wrap(`Survived by ${plural(idea.counts.same, 'person')} with the same problem.`, '400 30px Inter', '#3b3833', y + 50, 40, 2);
  rule(H - 210, 1);
  g.font = '400 40px "Instrument Serif"'; g.fillStyle = '#161514'; g.fillText('Revive it at Idea Graveyard', W / 2, H - 140);
  g.font = '500 22px "IBM Plex Mono"'; g.fillStyle = '#77716a'; g.fillText(location.host, W / 2, H - 98);

  const a = document.createElement('a');
  a.download = `obituary-${idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
  toast('Clipping saved. Post it on LinkedIn.');
}
