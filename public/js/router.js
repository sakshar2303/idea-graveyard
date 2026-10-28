// History-API router. Links marked data-link navigate without a page load.
const routes = [];
let current = null;

export function route(pattern, view) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ re, keys, view });
}

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search && !replace) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', to);
  render();
}

export async function render() {
  const main = document.getElementById('main');
  current?.cleanup?.();
  current = null;
  for (const r of routes) {
    const m = location.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const ctx = { params, query: new URLSearchParams(location.search), cleanup: null };
    current = ctx;
    markNav();
    await r.view(main, ctx);
    return;
  }
}

export function startRouter(notFound) {
  route('.*', notFound);
  addEventListener('popstate', render);
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  render();
}

// highlight the section link for the current page
function markNav() {
  const sort = new URLSearchParams(location.search).get('sort');
  const here = location.pathname === '/' && ['wanted', 'risen'].includes(sort) ? `/?sort=${sort}` : location.pathname;
  document.querySelectorAll('[data-nav]').forEach(a => {
    if (a.dataset.nav === here) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// keep query params in the URL without re-rendering the view
export function setQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  history.replaceState({}, '', location.pathname + (s ? '?' + s : ''));
  markNav();
}
