const $ = s => document.querySelector(s);
const state = { ideas: [], causes: [], filter: 'All', sort: 'new', resId: null };

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach(k => n.append(k));
  return n;
};
const ago = t => {
  const d = Math.floor((Date.now() - t) / 86400000);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
};
const toast = msg => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
};
const api = async (url, opts) => {
  const r = await fetch(url, opts && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
};

async function refresh() {
  const j = await api('/api/ideas');
  state.ideas = j.ideas; state.causes = j.causes;
  render();
}

function render() {
  const { ideas, causes } = state;
  const alive = ideas.filter(i => i.resurrections.length).length;
  $('#stats').replaceChildren(
    ...[['Buried', ideas.length], ['Resurrected', alive], ['Builders', new Set(ideas.flatMap(i => i.resurrections.map(r => r.name.toLowerCase()))).size]]
      .map(([k, v]) => el('div', {}, el('b', { textContent: v }), k))
  );

  $('#chips').replaceChildren(...['All', ...causes].map(c =>
    el('button', { className: 'chip', textContent: c, onclick: () => { state.filter = c; render(); } }, )
  ));
  [...$('#chips').children].forEach(b => b.setAttribute('aria-pressed', b.textContent === state.filter));

  let list = ideas.filter(i => state.filter === 'All' || i.cause === state.filter);
  list = [...list].sort((a, b) =>
    state.sort === 'hot' ? b.resurrections.length - a.resurrections.length || b.buriedAt - a.buriedAt
    : state.sort === 'old' ? a.buriedAt - b.buriedAt : b.buriedAt - a.buriedAt);

  $('#grid').replaceChildren(...(list.length ? list.map(card) : [el('div', { className: 'empty', textContent: 'Nothing buried here yet. Be the first.' })]));
}

function card(i) {
  const n = i.resurrections.length;
  const names = i.resurrections.slice(0, 2).map(r => r.name).join(', ');
  return el('article', { className: 'stone' + (n ? ' alive' : '') },
    el('div', { className: 'rip', textContent: n ? 'RISEN' : 'R.I.P.' }),
    el('h3', { textContent: i.title }),
    el('p', { className: 'epitaph', textContent: '“' + i.epitaph + '”' }),
    el('div', {}, el('span', { className: 'cause', textContent: i.cause })),
    i.why ? el('p', { className: 'why', textContent: i.why }) : '',
    el('div', { className: 'meta', textContent: 'Buried ' + ago(i.buriedAt) + ' by ' + i.author }),
    el('div', { className: 'res' },
      el('div', { className: 'n', textContent: n ? `${n} builder${n > 1 ? 's' : ''} resurrecting: ${names}${n > 2 ? '…' : ''}` : '' }),
      el('button', { textContent: n ? 'Join the resurrection' : 'Resurrect', onclick: () => openRes(i) })
    )
  );
}

// bury
const buryDlg = $('#buryDlg');
$('#buryBtn').onclick = () => { $('#bErr').textContent = ''; buryDlg.showModal(); $('#bTitle').focus(); };
$('#bCancel').onclick = () => buryDlg.close();
$('#bEpitaph').oninput = e => $('#epCount').textContent = e.target.value.length + '/140';
$('#buryForm').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('/api/ideas', {
      title: $('#bTitle').value, epitaph: $('#bEpitaph').value, cause: $('#bCause').value,
      why: $('#bWhy').value, author: $('#bAuthor').value, website: $('#bWebsite').value,
    });
    $('#buryForm').reset(); $('#epCount').textContent = '0/140';
    buryDlg.close(); state.filter = 'All'; state.sort = 'new'; $('#sort').value = 'new';
    await refresh(); toast('Rest in peace.');
  } catch (err) { $('#bErr').textContent = err.message; }
};

// resurrect
const resDlg = $('#resDlg');
function openRes(i) {
  state.resId = i.id; $('#rErr').textContent = '';
  $('#resTitle').textContent = i.title;
  try { $('#rName').value = localStorage.getItem('ig-name') || ''; } catch {}
  resDlg.showModal(); $('#rName').focus();
}
$('#rCancel').onclick = () => resDlg.close();
$('#resForm').onsubmit = async e => {
  e.preventDefault();
  try {
    await api(`/api/ideas/${state.resId}/resurrect`, { name: $('#rName').value, contact: $('#rContact').value });
    try { localStorage.setItem('ig-name', $('#rName').value); } catch {}
    resDlg.close(); await refresh(); toast('It lives!');
  } catch (err) { $('#rErr').textContent = err.message; }
};

$('#sort').onchange = e => { state.sort = e.target.value; render(); };

refresh().then(() => {
  $('#bCause').replaceChildren(...state.causes.map(c => el('option', { value: c, textContent: c })));
}).catch(() => { $('#grid').textContent = 'Could not reach the graveyard. Is the server running?'; });
