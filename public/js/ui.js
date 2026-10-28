// DOM helpers, icons, toasts and effects. User text only ever goes in via text nodes.

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') Object.assign(n.style, v);
    else if (k === 'vars') for (const [p, val] of Object.entries(v)) n.style.setProperty(p, val);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  append(n, kids);
  return n;
}

function append(n, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (s, root = document) => root.querySelector(s);

const ICONS = {
  candle: '<path class="flame" d="M12 2c1.8 2.2 3 3.9 3 5.6A3 3 0 0 1 12 10.6a3 3 0 0 1-3-3C9 5.9 10.2 4.2 12 2Z" fill="currentColor"/><rect x="9" y="12" width="6" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  same: '<path d="M7 11V7a2 2 0 1 1 4 0v4M11 10V5a2 2 0 1 1 4 0v6M15 9a2 2 0 1 1 4 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.6 14a2 2 0 0 1 3.2-2.4L8 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  res: '<path d="M12 21V9m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  eulogy: '<path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  shovel: '<path d="M14 4l6 6M17 7l-7.5 7.5M9.5 14.5l-3 3a2.1 2.1 0 1 1-3-3l3-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  linkedin: '<path d="M4 9h3.5v11H4zM5.7 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM10 9h3.3v1.6c.5-.9 1.7-1.9 3.6-1.9 3.6 0 4.1 2.3 4.1 5.3V20h-3.5v-5.3c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20H10z" fill="currentColor"/>',
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.4 3 5.4V20h10v-3.6c1.7-1 3-2.8 3-5.4a8 8 0 0 0-8-8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="11.5" r="1.6" fill="currentColor"/><circle cx="15" cy="11.5" r="1.6" fill="currentColor"/><path d="M10 20v-2M14 20v-2" stroke="currentColor" stroke-width="1.8"/>',
  spark: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" fill="currentColor"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  user: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};

const tpl = document.createElement('template');
export function icon(name) {
  tpl.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return tpl.content.firstChild.cloneNode(true);
}

export function avatar(user, size = '') {
  const name = user?.displayName || user?.username || '?';
  let h = 0;
  for (const c of user?.username || name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2);
  return el('a', { class: `avatar ${size}`, href: `/u/${encodeURIComponent(user.username)}`, 'data-link': true, vars: { '--h': h },
    'aria-label': name, title: name, text: initials });
}

export function timeAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, n] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? 's' : ''} ago`; }
  return 'just now';
}

export const fmtDate = t => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const IRREGULAR = { person: 'people', obituary: 'obituaries' };
export const plural = (n, word) => `${n} ${n === 1 ? word : IRREGULAR[word] || `${word}s`}`;

export function toast(message, kind = '') {
  const t = el('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}

// a dialog that cleans itself up; returns { dlg, close }
export function openDialog(build, { wide = false, label = 'Dialog', cls = '' } = {}) {
  const dlg = el('dialog', { class: `${wide ? 'wide' : ''} ${cls}`, 'aria-label': label });
  const close = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  append(dlg, [build(close)]);
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('[autofocus], input, textarea')?.focus();
  return { dlg, close };
}

export function dialogHead(title, close) {
  return el('div', { class: 'dlg-head' }, el('h2', { text: title }),
    el('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close')));
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// a rubber stamp that thumps onto the page for big moments: buried, revived, launched
export function moment(kind, word) {
  const label = { bury: 'Laid to rest', rise: 'Revival begun', launch: 'Revived' }[kind] || word;
  const stamp = el('div', { class: `stamp stamp-${kind}`, role: 'presentation', text: label });
  document.body.append(stamp);
  setTimeout(() => stamp.classList.add('out'), reduced() ? 900 : 1300);
  setTimeout(() => stamp.remove(), 1800);
}

export function bump(node) {
  node.classList.remove('pop');
  void node.offsetWidth;
  node.classList.add('pop');
}
