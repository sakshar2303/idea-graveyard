// App shell: nav, notifications, live ticker, keyboard shortcuts and routes.
import { el, icon, avatar, timeAgo, toast } from './ui.js';
import { api, post } from './api.js';
import { state, setMe, onAuth, requireAuth } from './state.js';
import { route, startRouter, navigate, render } from './router.js';
import { openAuth, openBury, openPalette, openSettings } from './dialogs.js';
import { homeView } from './views/home.js';
import { ideaView } from './views/idea.js';
import { profileView, leaderboardView, adminView } from './views/people.js';
import { startMotion } from './motion.js';

const NOTE_COPY = {
  resurrected: 'started reviving',
  same: 'has the same problem as',
  eulogy: 'left a eulogy on',
  launched: 'brought back to life',
  progress: 'posted progress on',
};

function closeMenus() { document.querySelectorAll('.menu').forEach(m => m.remove()); }
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });

function menuButton(trigger, build) {
  const wrap = el('div', { class: 'menu-wrap' }, trigger);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.addEventListener('click', async e => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    closeMenus();
    if (open) return trigger.setAttribute('aria-expanded', 'false');
    const menu = el('div', { class: 'menu', role: 'menu' });
    wrap.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
    await build(menu);
  });
  return wrap;
}

function paintNav() {
  const box = document.getElementById('navActions');
  const me = state.me;
  if (!me) {
    box.replaceChildren(
      el('button', { class: 'btn btn-text', onclick: () => openAuth(null, 'login'), text: 'Sign in' }),
      el('button', { class: 'btn btn-primary', 'aria-label': 'Bury an idea', onclick: async () => { if (await requireAuth('Create an account to bury your first idea.')) openBury(); } }, el('span', { class: 'lbl', text: 'Write an obituary' }), el('span', { class: 'lbl-short', text: 'Write' })));
    return;
  }
  const bell = el('button', { class: 'btn icon-btn', 'aria-label': `Notifications${me.unread ? `, ${me.unread} unread` : ''}` }, icon('bell'),
    me.unread ? el('span', { class: 'badge', text: me.unread > 9 ? '9+' : me.unread }) : null);
  const notes = menuButton(bell, async menu => {
    menu.append(el('div', { class: 'menu-head', text: 'Notifications' }));
    try {
      const r = await api('/api/notifications');
      menu.append(...(r.items.length ? r.items.map(n => el('a', { class: `menu-item ${n.read ? '' : 'unread'}`, role: 'menuitem', href: n.idea ? `/idea/${n.idea.id}` : '/', 'data-link': true, onclick: closeMenus },
        n.actor ? avatar(n.actor, 'avatar-sm') : null,
        el('span', {}, el('b', { text: n.actor?.displayName || 'Someone' }), ` ${NOTE_COPY[n.kind] || 'interacted with'} `, el('b', { text: n.idea?.title || 'your idea' }), el('time', { text: timeAgo(n.createdAt) })))) :
        [el('div', { class: 'palette-empty', text: 'No news yet. Write an obituary and the readers will come.' })]));
      if (r.unread) { await post('/api/notifications/read'); setMe({ ...state.me, unread: 0 }); }
    } catch (e) { menu.append(el('div', { class: 'palette-empty', text: e.message })); }
  });
  const user = menuButton(el('button', { class: 'btn btn-ghost icon-btn', 'aria-label': 'Account menu' }, avatar(me, 'avatar-sm')), menu => {
    const item = (label, fn) => el('button', { class: 'menu-item', role: 'menuitem', type: 'button', text: label, onclick: () => { closeMenus(); fn(); } });
    menu.append(el('div', { class: 'menu-head' }, el('span', { text: me.displayName }), el('span', { text: `@${me.username}` })),
      item('My obituaries', () => navigate(`/u/${me.username}`)),
      item('Reviving', () => navigate(`/u/${me.username}?tab=resurrecting`)),
      item('Edit profile', openSettings),
      me.admin ? item('Moderation', () => navigate('/admin')) : null,
      el('div', { class: 'menu-sep' }),
      item('Sign out', async () => { await post('/api/auth/logout').catch(() => {}); setMe(null); toast('Signed out.'); render(); }));
  });
  box.replaceChildren(notes, el('button', { class: 'btn btn-primary', 'aria-label': 'Bury an idea', onclick: openBury }, el('span', { class: 'lbl', text: 'Write an obituary' }), el('span', { class: 'lbl-short', text: 'Write' })), user);
}

// live ticker over server-sent events
function startLive() {
  if (!window.EventSource) return;
  const ticker = document.getElementById('ticker');
  const text = document.getElementById('tickerText');
  let hideTimer;
  const show = (verb, d, kind) => {
    text.replaceChildren(el('b', { text: d.by }), ` ${verb} `, el('a', { href: `/idea/${d.id}`, 'data-link': true }, el('b', { text: d.title })));
    ticker.hidden = false;
    ticker.classList.remove('show'); void ticker.offsetWidth; ticker.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => ticker.classList.remove('show'), 7000);
    document.dispatchEvent(new CustomEvent('graveyard:live', { detail: { ...d, kind } }));
  };
  const es = new EventSource('/api/events');
  es.addEventListener('buried', e => show('published an obituary for', JSON.parse(e.data), 'buried'));
  es.addEventListener('resurrected', e => show('started reviving', JSON.parse(e.data), 'resurrected'));
  es.addEventListener('launched', e => show('relaunched', JSON.parse(e.data), 'launched'));
}

// the news wire: a slow, endless strip of the latest epitaphs
async function startWire() {
  const wire = document.getElementById('wire');
  const track = document.getElementById('wireTrack');
  if (!wire) return;
  const paint = async () => {
    const r = await api('/api/ideas?sort=new').catch(() => null);
    const items = r?.ideas.slice(0, 12) || [];
    if (!items.length) return;
    const row = () => items.map(i => el('a', { class: 'wire-item', href: `/idea/${i.id}`, 'data-link': true },
      el('em', { text: `“${i.epitaph}”` }), el('span', { text: i.title })));
    // two copies so the loop is seamless; the second is hidden from screen readers
    track.replaceChildren(el('div', { class: 'wire-run' }, row()), el('div', { class: 'wire-run', 'aria-hidden': 'true' }, row()));
    track.style.setProperty('--wire-s', `${Math.max(40, items.length * 7)}s`);
    wire.hidden = false;
  };
  await paint();
  document.addEventListener('graveyard:live', e => { if (e.detail?.kind === 'buried') paint(); });
}

function shortcuts() {
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!document.querySelector('dialog[open]')) openPalette(); }
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (e.key === '/') { e.preventDefault(); openPalette(); }
    if (e.key.toLowerCase() === 'b') { e.preventDefault(); requireAuth('Sign in to bury your idea.').then(ok => ok && openBury()); }
    if (e.key === 'Escape') closeMenus();
  });
}

function notFound(main) {
  document.title = 'Lost · Idea Graveyard';
  main.replaceChildren(el('div', { class: 'page notfound' }, el('h1', { text: '404' }), el('p', { text: 'This page has passed away. It was never born, really.' }),
    el('a', { class: 'btn btn-primary', href: '/', 'data-link': true, text: 'Back to the front page' })));
}

async function boot() {
  startMotion();
  const edition = document.getElementById('edition');
  if (edition) edition.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('searchBtn').addEventListener('click', openPalette);
  try {
    const r = await api('/api/me');
    state.causes = r.causes;
    state.aiEnabled = r.aiEnabled;
    state.me = r.user;
  } catch { /* render signed out */ }
  onAuth(paintNav);
  paintNav();
  route('/', homeView);
  route('/idea/:id', ideaView);
  route('/u/:username', profileView);
  route('/leaderboard', leaderboardView);
  route('/admin', adminView);
  startRouter(notFound);
  startLive();
  startWire();
  shortcuts();
}

boot();
