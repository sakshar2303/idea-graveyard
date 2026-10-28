// One grave: death certificate, AI autopsy, resurrection crew and eulogies.
import { el, icon, avatar, timeAgo, fmtDate, toast, moment, bump, plural } from '../ui.js';
import { api, post, patch, del } from '../api.js';
import { state, requireAuth } from '../state.js';
import { navigate } from '../router.js';
import { stoneFace, statusPill, emptyState } from '../components.js';
import { openResurrect, openReport, confirmDialog } from '../dialogs.js';

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
  const { wrap } = stoneFace(idea, { big: true });
  wrap.querySelector('.stone').append(el('div', { class: 'stone-foot' },
    el('div', { class: 'byline' }, avatar(idea.author, 'avatar-sm'), 'Buried by ',
      el('a', { href: `/u/${encodeURIComponent(idea.author.username)}`, 'data-link': true, text: idea.author.displayName }), ` · ${timeAgo(idea.buriedAt)}`)));

  const left = el('div', {}, wrap, shareBar(idea),
    el('div', { class: 'share' },
      idea.canDelete ? el('button', { class: 'btn btn-ghost btn-sm btn-danger', onclick: async () => {
        if (!(await confirmDialog('Exhume this grave?', 'This permanently deletes the idea, its candles, eulogies and resurrections.', 'Exhume'))) return;
        try { await del(`/api/ideas/${idea.id}`); toast('Exhumed.'); navigate('/'); } catch (e) { toast(e.message, 'error'); }
      } }, icon('trash'), 'Exhume') : null,
      state.me && !idea.canDelete ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openReport(idea) }, icon('flag'), 'Report') : null));

  const right = el('div', {}, pulseCard(idea, update), certificateCard(idea), autopsyCard(idea, update), crewCard(idea, update), eulogyCard(idea, update));

  main.replaceChildren(el('div', { class: 'page' },
    el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, el('a', { href: '/', 'data-link': true, text: 'Graveyard' }), '/', el('span', { text: idea.title })),
    el('div', { class: 'detail' }, left, right)));
}

function shareBar(idea) {
  const url = `${location.origin}/idea/${idea.id}`;
  const text = `My idea "${idea.title}" just got buried at the Idea Graveyard. Epitaph: "${idea.epitaph}". Anyone want to resurrect it?`;
  return el('div', { class: 'share' },
    el('a', { class: 'btn btn-sm', target: '_blank', rel: 'noopener', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` }, icon('linkedin'), 'Share'),
    el('button', { class: 'btn btn-sm', onclick: async () => {
      try {
        if (navigator.share && matchMedia('(hover: none)').matches) await navigator.share({ title: idea.title, text, url });
        else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Link and caption copied.'); }
      } catch {}
    } }, icon('link'), 'Copy'),
    el('button', { class: 'btn btn-sm', onclick: () => downloadTombstone(idea) }, icon('download'), 'Image'));
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
    if (!(await requireAuth('Sign in to resurrect this idea.'))) return;
    if (mine.resurrected) return document.getElementById('crew')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    openResurrect(idea, update);
  };
  const same = idea.counts.same;
  return el('section', { class: 'card', 'aria-label': 'Community pulse' },
    el('div', { class: 'pulse-row' },
      tile('candle', idea.counts.candles, mine.candle ? 'Candle lit' : 'Light a candle', mine.candle, toggle('candle')),
      tile('same', same, mine.same ? 'You have it too' : 'I have this problem', mine.same, toggle('same')),
      tile('res', idea.counts.resurrections, mine.resurrected ? 'You are on it' : 'Resurrect it', mine.resurrected, resurrect)),
    el('p', { class: 'pulse-hint', text: same >= 3
      ? `${plural(same, 'person')} said they have this problem. That is a signal worth building on.`
      : 'Every "I have this problem" is a real validation signal for whoever resurrects it.' }));
}

function certificateCard(idea) {
  const fact = (label, value, empty) => el('div', { class: 'fact' }, el('dt', { text: label }), el('dd', { class: value ? '' : 'dim', text: value || empty }));
  return el('section', { class: 'card' }, el('h2', { text: 'Death certificate' }),
    el('dl', { class: 'facts' },
      fact('The problem', idea.problem, 'The founder did not say. Ask in the eulogies.'),
      fact('Who suffered', idea.audience, 'Unknown'),
      fact('Cause of death', idea.cause),
      idea.story ? fact('What happened', idea.story) : null,
      fact('Time of death', fmtDate(idea.buriedAt))));
}

function autopsyCard(idea, update) {
  const card = el('section', { class: 'card', 'aria-live': 'polite' });
  const head = el('h2', {}, icon('spark'), 'AI autopsy');
  if (idea.autopsy) {
    const a = idea.autopsy;
    card.append(head,
      el('p', { class: 'verdict', text: a.verdict }),
      el('div', { class: 'odds' }, el('div', { class: 'odds-ring', vars: { '--p': a.survivalOdds }, text: `${a.survivalOdds}%` }),
        el('p', {}, el('strong', { text: 'Survival odds if resurrected' }), a.whyNow)),
      el('div', { class: 'autopsy-grid' },
        el('div', {}, el('h3', { text: 'Root causes' }), el('ul', { class: 'cause-list' }, a.rootCauses.map(c => el('li', {}, el('b', { text: c.title }), el('span', { text: c.detail }))))),
        el('div', {}, el('h3', { text: 'Resurrection plan' }), el('ol', { class: 'plan' }, a.resurrectionPlan.map(s => el('li', {}, el('b', { text: s.step }), el('span', { text: s.detail }))))),
        el('div', {}, el('h3', { text: 'Ship this in 48 hours' }), el('div', { class: 'callout', text: a.mvp48h })),
        el('div', {}, el('h3', { text: 'Ask real users first' }), el('ol', { class: 'qs' }, a.validationQuestions.map(q => el('li', { text: q }))))),
      el('p', { class: 'ai-note', text: `Performed by Claude on ${fmtDate(a.createdAt)}. AI can be wrong, so validate with real users.` }));
    return card;
  }
  if (!idea.aiEnabled) {
    card.append(head, el('div', { class: 'autopsy-cta' }, el('p', { text: 'The coroner is off duty. Autopsies switch on when the server has an Anthropic API key.' })));
    return card;
  }
  const btn = el('button', { class: 'btn btn-soul btn-lg' }, icon('spark'), 'Perform the autopsy');
  btn.addEventListener('click', async () => {
    if (!(await requireAuth('Sign in to request an autopsy.'))) return;
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
    el('p', { text: 'Let Claude examine this idea: why it really died, the odds it survives a second life, and a plan to ship it in 48 hours.' }), btn));
  return card;
}

function crewCard(idea, update) {
  const card = el('section', { class: 'card', id: 'crew' }, el('h2', {}, 'Resurrection crew', el('span', { class: 'count', text: idea.resurrections.length }), el('span', { class: 'spacer' }),
    !idea.mine?.resurrected ? el('button', { class: 'btn btn-soul btn-sm', onclick: async () => { if (await requireAuth('Sign in to resurrect this idea.')) openResurrect(idea, update); } }, icon('res'), 'Resurrect') : null));
  if (!idea.resurrections.length) {
    card.append(el('p', { class: 'dlg-sub', text: 'Nobody has picked up the shovel yet. Be the first to bring it back.' }));
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
      if (!(await confirmDialog('Abandon this resurrection?', 'Your plan and updates will be removed. The idea goes back to rest.', 'Abandon'))) return;
      try { update(await del(`/api/resurrections/${r.id}`)); toast('Back to the earth it goes.'); } catch (e) { toast(e.message, 'error'); }
    } });
    block.append(el('div', { class: 'mine-tools' }, note, el('div', { class: 'row' }, status, link), el('div', { class: 'row' }, save, el('span', { class: 'spacer' }), abandon)));
  }
  return block;
}

function eulogyCard(idea, update) {
  const body = el('textarea', { class: 'textarea', maxlength: 500, placeholder: state.me ? 'Say a few words for the departed…' : 'Sign in to leave a eulogy', rows: 2 });
  const send = el('button', { class: 'btn', type: 'submit' }, icon('eulogy'), 'Post');
  const form = el('form', { class: 'compose', onsubmit: async e => {
    e.preventDefault();
    if (!(await requireAuth('Sign in to leave a eulogy.'))) return;
    send.disabled = true;
    try { update(await post(`/api/ideas/${idea.id}/eulogies`, { body: body.value })); }
    catch (err) { toast(err.message, 'error'); send.disabled = false; }
  } }, body, send);
  return el('section', { class: 'card' }, el('h2', {}, 'Eulogies', el('span', { class: 'count', text: idea.eulogies.length })),
    idea.eulogies.length ? idea.eulogies.map(e => el('div', { class: 'eulogy' }, avatar(e.user),
      el('div', { class: 'eulogy-body' },
        el('div', { class: 'eulogy-meta' }, el('a', { href: `/u/${encodeURIComponent(e.user.username)}`, 'data-link': true, text: e.user.displayName }), timeAgo(e.createdAt),
          e.canDelete ? el('button', { class: 'btn btn-ghost btn-sm del', 'aria-label': 'Delete eulogy', onclick: async () => {
            try { update(await del(`/api/eulogies/${e.id}`)); } catch (err) { toast(err.message, 'error'); }
          } }, icon('trash')) : null),
        el('p', { text: e.body })))) : el('p', { class: 'dlg-sub', text: 'No eulogies yet. Say something nice. Or honest.' }),
    form);
}

// draws a shareable 1080x1350 tombstone card
async function downloadTombstone(idea) {
  await document.fonts?.ready;
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 1350);
  sky.addColorStop(0, '#111827'); sky.addColorStop(1, '#05060a');
  g.fillStyle = sky; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = 'rgba(255,250,225,.9)'; g.shadowColor = 'rgba(255,250,225,.5)'; g.shadowBlur = 60;
  g.beginPath(); g.arc(880, 170, 70, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;

  const x = 190, y = 260, w = 700, h = 900, rad = 330;
  const stone = g.createLinearGradient(0, y, 0, y + h);
  const alive = idea.status !== 'dead';
  stone.addColorStop(0, '#4a5262'); stone.addColorStop(.5, '#2d333f'); stone.addColorStop(1, '#1c2029');
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + rad); g.arc(x + w / 2, y + rad, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath();
  g.shadowColor = alive ? 'rgba(141,232,180,.45)' : 'rgba(0,0,0,.8)'; g.shadowBlur = 80;
  g.fillStyle = stone; g.fill(); g.shadowBlur = 0;
  g.strokeStyle = alive ? 'rgba(141,232,180,.6)' : 'rgba(255,255,255,.15)'; g.lineWidth = 3; g.stroke();

  const wrapText = (text, font, color, top, maxW, lh, maxLines = 4) => {
    g.font = font; g.fillStyle = color; g.textAlign = 'center';
    const words = text.split(/\s+/); const lines = []; let line = '';
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
    }
    lines.push(line);
    lines.slice(0, maxLines).forEach((l, i) => g.fillText(l, 540, top + i * lh));
    return top + Math.min(lines.length, maxLines) * lh;
  };
  wrapText(alive ? 'IT LIVES' : 'R . I . P .', '700 34px Cinzel', alive ? '#8de8b4' : '#9aa0ab', 420, 600, 40);
  let ty = wrapText(idea.title, '700 64px Cinzel', '#ece9e2', 530, 560, 74, 4);
  ty = wrapText(fmtDate(idea.buriedAt).toUpperCase(), '500 26px Cinzel', '#7d828f', ty + 20, 560, 30);
  ty = wrapText(`“${idea.epitaph}”`, 'italic 500 46px "Cormorant Garamond"', '#cfccc4', ty + 50, 560, 54, 4);
  wrapText(`Cause of death: ${idea.cause}`, '600 26px Inter', '#ffb547', ty + 40, 560, 32);
  wrapText('Resurrect it at Idea Graveyard', '600 30px Inter', '#ece9e2', 1250, 900, 36);
  wrapText(location.host, '500 24px Inter', '#7d828f', 1292, 900, 30);

  const a = document.createElement('a');
  a.download = `rip-${idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
  toast('Tombstone saved. Post it on LinkedIn.');
}
