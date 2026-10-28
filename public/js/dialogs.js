// Modal flows: sign in, bury an idea, resurrect, search palette, settings, report, confirm.
import { el, icon, openDialog, dialogHead, toast, moment } from './ui.js';
import { api, post, patch } from './api.js';
import { state, setMe, setAuthPrompt } from './state.js';
import { navigate } from './router.js';
import { stoneFace } from './components.js';

function field(label, input, hint) {
  const id = input.id || (input.id = 'f' + Math.random().toString(36).slice(2, 8));
  const h = hint instanceof Node ? hint : hint ? el('span', { class: 'hint', text: hint }) : null;
  return el('div', { class: 'field' }, el('label', { for: id }, label, h), input);
}

function counter(input, max) {
  const c = el('span', { class: 'hint', text: `0/${max}` });
  const upd = () => { c.textContent = `${input.value.length}/${max}`; };
  input.addEventListener('input', upd);
  upd();
  return c;
}

const busy = (btn, on, text) => {
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = text; } else if (btn.dataset.label) btn.textContent = btn.dataset.label;
};

// ---------- auth ----------
export function openAuth(reason, mode = 'login') {
  return new Promise(resolve => {
    let done = false;
    const { dlg } = openDialog(close => {
      const body = el('div', { class: 'dlg-body' });
      const paint = () => {
        const isLogin = mode === 'login';
        const username = el('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, maxlength: 20, autofocus: true, placeholder: 'e.g. sakshar' });
        const display = el('input', { class: 'input', name: 'displayName', autocomplete: 'name', maxlength: 40, placeholder: 'How your name shows on graves' });
        const password = el('input', { class: 'input', name: 'password', type: 'password', autocomplete: isLogin ? 'current-password' : 'new-password', required: true, minlength: isLogin ? 1 : 8 });
        const err = el('p', { class: 'err', role: 'alert' });
        const submit = el('button', { class: 'btn btn-soul btn-lg', type: 'submit', text: isLogin ? 'Enter the graveyard' : 'Dig my plot' });
        const form = el('form', {
          onsubmit: async e => {
            e.preventDefault();
            err.textContent = '';
            busy(submit, true, isLogin ? 'Opening the gates…' : 'Digging…');
            try {
              const r = await post(`/api/auth/${isLogin ? 'login' : 'signup'}`, { username: username.value, password: password.value, displayName: display.value });
              setMe(r.user);
              done = true;
              toast(isLogin ? `Welcome back, ${r.user.displayName}.` : `Welcome, ${r.user.displayName}. Your plot is ready.`, 'soul');
              resolve(true);
              close();
            } catch (ex) { err.textContent = ex.message; busy(submit, false); }
          },
        },
          el('div', { class: 'auth-tabs', role: 'tablist' },
            el('button', { class: 'tab', type: 'button', role: 'tab', 'aria-pressed': String(isLogin), onclick: () => { mode = 'login'; paint(); }, text: 'Sign in' }),
            el('button', { class: 'tab', type: 'button', role: 'tab', 'aria-pressed': String(!isLogin), onclick: () => { mode = 'signup'; paint(); }, text: 'Create account' })),
          field('Username', username),
          isLogin ? null : field('Display name', display, 'optional'),
          field('Password', password, isLogin ? null : 'at least 8 characters'),
          err,
          el('div', { class: 'dlg-foot' }, submit));
        body.replaceChildren(...[reason ? el('p', { class: 'dlg-sub', text: reason }) : null, form].filter(Boolean));
        username.focus();
      };
      paint();
      return [dialogHead(mode === 'login' ? 'Welcome to the graveyard' : 'Join the graveyard', close), body];
    }, { label: 'Sign in' });
    dlg.addEventListener('close', () => { if (!done) resolve(false); });
  });
}
setAuthPrompt(openAuth);

// ---------- bury ----------
export async function openBury() {
  const draft = { title: '', epitaph: '', cause: state.causes[0] || 'No time', problem: '', audience: '', story: '', tags: '' };
  try { Object.assign(draft, JSON.parse(localStorage.getItem('ig-draft') || '{}')); } catch {}
  const saveDraft = () => { try { localStorage.setItem('ig-draft', JSON.stringify(draft)); } catch {} };
  let step = 0;

  openDialog(close => {
    const body = el('div', { class: 'dlg-body' });
    const preview = el('div', { class: 'bury-preview' });
    const paintPreview = () => {
      const { wrap } = stoneFace({
        id: 'preview', title: draft.title || 'Your idea', epitaph: draft.epitaph || 'Its last words…', cause: draft.cause,
        tags: draft.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 5), buriedAt: Date.now(), status: 'dead',
      }, { big: true });
      preview.replaceChildren(el('div', { class: 'preview-label', text: 'Live preview' }), wrap);
    };
    const bind = (input, key) => {
      input.value = draft[key];
      input.addEventListener('input', () => { draft[key] = input.value; saveDraft(); paintPreview(); });
      return input;
    };

    const paint = () => {
      const err = el('p', { class: 'err', role: 'alert' });
      const stepsBar = el('div', { class: 'steps' }, [0, 1, 2].map(i => el('i', { class: i <= step ? 'on' : '' })));
      let content, next;
      if (step === 0) {
        const title = bind(el('input', { class: 'input', maxlength: 80, placeholder: 'e.g. Uber for tiffin boxes', autofocus: true }), 'title');
        const problem = bind(el('textarea', { class: 'textarea', maxlength: 400, placeholder: 'Who hurt, and why? This is what a future builder needs most.' }), 'problem');
        const audience = bind(el('input', { class: 'input', maxlength: 120, placeholder: 'e.g. Office workers in Bengaluru' }), 'audience');
        content = [field('What was the idea?', title, counter(title, 80)), field('The problem it solved', problem, 'optional but gold'), field('Who had this problem?', audience, 'optional')];
        next = () => { if (draft.title.trim().length < 3) { err.textContent = 'Give your idea a name (at least 3 characters).'; return false; } return true; };
      } else if (step === 1) {
        const causes = el('div', { class: 'cause-pick', role: 'radiogroup', 'aria-label': 'Cause of death' },
          state.causes.map(c => el('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(draft.cause === c), 'aria-pressed': String(draft.cause === c), text: c,
            onclick: () => { draft.cause = c; saveDraft(); paint(); paintPreview(); } })));
        const story = bind(el('textarea', { class: 'textarea', maxlength: 1500, placeholder: 'What happened? How far did you get? What would you do differently?' }), 'story');
        const tags = bind(el('input', { class: 'input', maxlength: 100, placeholder: 'fintech, ai, students' }), 'tags');
        content = [el('div', { class: 'field' }, el('span', { class: 'label', text: 'Cause of death' }), causes), field('The story', story, 'optional'), field('Tags', tags, 'up to 5, comma separated')];
        next = () => true;
      } else {
        const epitaph = bind(el('input', { class: 'input', maxlength: 140, placeholder: 'Short, a little sad, ideally funny', autofocus: true }), 'epitaph');
        const ideas = ['Gone but not forgotten. Mostly forgotten.', 'It had potential. So did I.', 'Died as it lived: in a Google Doc.', 'Pivoted into the afterlife.'];
        content = [field('Its epitaph', epitaph, counter(epitaph, 140)),
          el('div', { class: 'chips' }, ideas.map(t => el('button', { type: 'button', class: 'chip', text: t, onclick: () => { draft.epitaph = t; epitaph.value = t; saveDraft(); paintPreview(); } }))),
          el('input', { class: 'hp', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', id: 'bury-hp' })];
        next = () => { if (draft.epitaph.trim().length < 3) { err.textContent = 'Every grave needs an epitaph.'; return false; } return true; };
      }

      const primary = el('button', { class: `btn ${step === 2 ? 'btn-primary' : 'btn-soul'}`, type: 'submit' }, step === 2 ? [icon('shovel'), 'Bury it'] : ['Continue', icon('arrow')]);
      const form = el('form', {
        onsubmit: async e => {
          e.preventDefault();
          if (!next()) return;
          if (step < 2) { step++; return paint(); }
          busy(primary, true, 'Lowering the casket…');
          try {
            const idea = await post('/api/ideas', { ...draft, website: form.querySelector('#bury-hp')?.value });
            try { localStorage.removeItem('ig-draft'); } catch {}
            close();
            moment('bury', 'R.I.P.');
            toast('Laid to rest. Share it so someone can resurrect it.', 'soul');
            if (idea.id) navigate(`/idea/${idea.id}`);
          } catch (ex) { err.textContent = ex.message; busy(primary, false); }
        },
      }, stepsBar, content, err,
        el('div', { class: 'dlg-foot' },
          step > 0 ? el('button', { class: 'btn btn-ghost', type: 'button', text: 'Back', onclick: () => { step--; paint(); } }) : null,
          el('span', { class: 'spacer' }), primary));
      body.replaceChildren(el('div', { class: 'bury-layout' }, el('div', {}, el('p', { class: 'dlg-sub', text: ['Every idea deserves a proper burial.', 'How did it die?', 'Last words.'][step] }), form), preview));
      form.querySelector('[autofocus], input, textarea')?.focus();
    };
    paint();
    paintPreview();
    return [dialogHead('Bury an idea', close), body];
  }, { wide: true, label: 'Bury an idea' });
}

// ---------- resurrect ----------
export function openResurrect(idea, onDone) {
  openDialog(close => {
    const pitch = el('textarea', { class: 'textarea', maxlength: 400, autofocus: true, placeholder: 'How will you bring it back? What will you do differently?' });
    const link = el('input', { class: 'input', type: 'url', maxlength: 300, placeholder: 'https://… (repo, landing page, Figma)' });
    const err = el('p', { class: 'err', role: 'alert' });
    const submit = el('button', { class: 'btn btn-soul btn-lg', type: 'submit' }, icon('res'), 'Raise it from the dead');
    return [dialogHead('Resurrect this idea', close), el('div', { class: 'dlg-body' },
      el('p', { class: 'dlg-sub' }, 'You are about to bring ', el('b', { text: idea.title }), ' back to life. The founder gets notified.'),
      el('form', {
        onsubmit: async e => {
          e.preventDefault();
          busy(submit, true, 'Summoning…');
          try {
            const updated = await post(`/api/ideas/${idea.id}/resurrect`, { pitch: pitch.value, link: link.value });
            close();
            moment('rise', 'IT LIVES');
            toast('Resurrection started. Post updates as you build.', 'soul');
            onDone?.(updated);
          } catch (ex) { err.textContent = ex.message; busy(submit, false); }
        },
      }, field('Your plan', pitch, counter(pitch, 400)), field('Link', link, 'optional'), err, el('div', { class: 'dlg-foot' }, submit)))];
  }, { label: 'Resurrect' });
}

// ---------- search palette ----------
export function openPalette() {
  openDialog(close => {
    const input = el('input', { class: 'input', type: 'search', placeholder: 'Search ideas, problems, founders…', 'aria-label': 'Search', autofocus: true, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-res' });
    const list = el('div', { class: 'palette-results', id: 'pal-res', role: 'listbox' });
    let items = [], sel = 0, timer, seq = 0;
    const select = i => {
      sel = Math.max(0, Math.min(items.length - 1, i));
      [...list.children].forEach((c, j) => c.setAttribute('aria-selected', String(j === sel)));
      list.children[sel]?.scrollIntoView({ block: 'nearest' });
    };
    const go = idea => { close(); navigate(`/idea/${idea.id}`); };
    const search = async () => {
      const mine = ++seq;
      const term = input.value.trim();
      const r = await api(`/api/ideas?sort=${term ? 'trending' : 'new'}&q=${encodeURIComponent(term)}`).catch(() => ({ ideas: [] }));
      if (mine !== seq) return;
      items = r.ideas.slice(0, 8);
      list.replaceChildren(...(items.length ? items.map((idea, i) => el('button', {
        class: 'palette-item', role: 'option', type: 'button', 'aria-selected': String(i === 0), onclick: () => go(idea), onmouseenter: () => select(i),
      }, el('span', { class: 'mini' }), el('span', {}, el('div', { class: 't', text: idea.title }), el('div', { class: 's', text: `“${idea.epitaph}” · ${idea.cause}` })))) :
        [el('div', { class: 'palette-empty', text: term ? 'No graves match that. Maybe it is still alive?' : 'The graveyard is quiet.' })]));
      sel = 0;
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 160); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
      if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
    });
    search();
    return [input, list];
  }, { label: 'Search', cls: 'palette' });
}

// ---------- settings ----------
export function openSettings() {
  openDialog(close => {
    const display = el('input', { class: 'input', maxlength: 40, value: state.me.displayName, autofocus: true });
    const bio = el('textarea', { class: 'textarea', maxlength: 160, placeholder: 'One line about you', value: state.me.bio || '' });
    const err = el('p', { class: 'err', role: 'alert' });
    const submit = el('button', { class: 'btn btn-soul', type: 'submit', text: 'Save' });
    return [dialogHead('Your profile', close), el('div', { class: 'dlg-body' }, el('form', {
      onsubmit: async e => {
        e.preventDefault();
        busy(submit, true, 'Saving…');
        try {
          const r = await patch('/api/me', { displayName: display.value, bio: bio.value });
          setMe(r.user);
          toast('Saved.');
          close();
          if (location.pathname.startsWith('/u/')) navigate(location.pathname, { replace: true });
        } catch (ex) { err.textContent = ex.message; busy(submit, false); }
      },
    }, field('Display name', display), field('Bio', bio, counter(bio, 160)), err, el('div', { class: 'dlg-foot' }, submit)))];
  }, { label: 'Profile settings' });
}

// ---------- report ----------
export function openReport(idea) {
  openDialog(close => {
    const reason = el('input', { class: 'input', maxlength: 200, autofocus: true, placeholder: 'Spam, abuse, personal info…' });
    const submit = el('button', { class: 'btn btn-danger', type: 'submit', text: 'Report' });
    return [dialogHead('Report this grave', close), el('div', { class: 'dlg-body' }, el('form', {
      onsubmit: async e => {
        e.preventDefault();
        try { await post(`/api/ideas/${idea.id}/report`, { reason: reason.value }); toast('Thanks. A groundskeeper will take a look.'); close(); }
        catch (ex) { toast(ex.message, 'error'); }
      },
    }, field('What is wrong?', reason), el('div', { class: 'dlg-foot' }, submit)))];
  }, { label: 'Report' });
}

// ---------- confirm ----------
export function confirmDialog(title, text, action = 'Confirm') {
  return new Promise(resolve => {
    let ok = false;
    const { dlg } = openDialog(close => [dialogHead(title, close), el('div', { class: 'dlg-body' }, el('p', { class: 'dlg-sub', text }),
      el('div', { class: 'dlg-foot' }, el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-danger', type: 'button', text: action, autofocus: true, onclick: () => { ok = true; close(); } })))], { label: title });
    dlg.addEventListener('close', () => resolve(ok));
  });
}
