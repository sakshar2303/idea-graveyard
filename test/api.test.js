const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../server');

const AUTOPSY = {
  verdict: 'Died of logistics.', rootCauses: [{ title: 'a', detail: 'b' }, { title: 'c', detail: 'd' }, { title: 'e', detail: 'f' }, { title: 'x', detail: 'y' }],
  whyNow: 'Now is good.', resurrectionPlan: [{ step: 's', detail: 'd' }], mvp48h: 'Ship a form.', validationQuestions: ['q1', 'q2', 'q3', 'q4'], survivalOdds: 140,
};

function mockClaude(impl) {
  const calls = [];
  return {
    calls,
    beta: { messages: { parse: async params => { calls.push(params); return impl ? impl(params) : { stop_reason: 'end_turn', model: params.model, parsed_output: AUTOPSY }; } } },
  };
}

async function start(t, env = {}) {
  const server = createApp({ DB_FILE: ':memory:', ADMIN_USERNAMES: 'boss', ...env });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  // each client keeps its own cookie, like a separate browser
  const client = () => {
    let cookie = '';
    const call = async (p, method = 'GET', body, headers = {}) => {
      const h = { ...(cookie ? { Cookie: cookie } : {}), ...headers };
      if (method !== 'GET' && !('Content-Type' in h)) h['Content-Type'] = 'application/json';
      const res = await fetch(base + p, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    };
    call.signup = async (username, password = 'correct horse battery') => {
      const r = await call('/api/auth/signup', 'POST', { username, password, displayName: username.toUpperCase() });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.user;
    };
    call.bury = async (fields = {}) => {
      const r = await call('/api/ideas', 'POST', { title: 'Test idea', epitaph: 'Gone too soon', cause: 'No time', ...fields });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data;
    };
    return call;
  };
  return { base, client, server };
}

test('health, seed data and security headers', async t => {
  const { client } = await start(t);
  const c = client();
  assert.equal((await c('/healthz')).status, 200);
  const r = await c('/api/ideas');
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 8);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const me = await c('/api/me');
  assert.equal(me.data.user, null);
  assert.equal(me.data.aiEnabled, false);
  assert.ok(me.data.causes.includes('No market'));
});

test('SEED=0 starts empty', async t => {
  const { client } = await start(t, { SEED: '0' });
  assert.equal((await client()('/api/ideas')).data.total, 0);
});

test('signup, login, logout and session cookies', async t => {
  const { client } = await start(t, { SEED: '0' });
  const c = client();
  assert.equal((await c('/api/auth/signup', 'POST', { username: 'no spaces!', password: 'longenough' })).status, 400);
  assert.equal((await c('/api/auth/signup', 'POST', { username: 'sakshar', password: 'short' })).status, 400);
  const signup = await c('/api/auth/signup', 'POST', { username: 'sakshar', password: 'correct horse', displayName: 'Sakshar Dhawan' });
  assert.equal(signup.status, 200);
  assert.match(signup.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await c('/api/me')).data.user.displayName, 'Sakshar Dhawan');
  assert.equal((await client()('/api/auth/signup', 'POST', { username: 'SAKSHAR', password: 'another pass' })).status, 409);

  await c('/api/auth/logout', 'POST');
  assert.equal((await c('/api/me')).data.user, null);

  const other = client();
  assert.equal((await other('/api/auth/login', 'POST', { username: 'sakshar', password: 'wrong pass' })).status, 401);
  assert.equal((await other('/api/auth/login', 'POST', { username: 'nobody', password: 'wrong pass' })).status, 401);
  assert.equal((await other('/api/auth/login', 'POST', { username: 'Sakshar', password: 'correct horse' })).status, 200);
  assert.equal((await other('/api/me')).data.user.username, 'sakshar');

  const p = await other('/api/me', 'PATCH', { displayName: 'S. Dhawan', bio: 'Builder' });
  assert.equal(p.data.user.displayName, 'S. Dhawan');
});

test('seeded demo users cannot log in', async t => {
  const { client } = await start(t);
  assert.equal((await client()('/api/auth/login', 'POST', { username: 'arjun', password: '' })).status, 401);
});

test('CSRF guards: JSON content type and same origin', async t => {
  const { client } = await start(t, { SEED: '0' });
  const c = client();
  await c.signup('sakshar');
  assert.equal((await c('/api/ideas', 'POST', { title: 'abc', epitaph: 'def' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await c('/api/ideas', 'POST', { title: 'abc', epitaph: 'def' }, { Origin: 'https://evil.example' })).status, 403);
});

test('burying requires auth, validates and sanitizes', async t => {
  const { client } = await start(t, { SEED: '0' });
  const anon = client();
  assert.equal((await anon('/api/ideas', 'POST', { title: 'abc', epitaph: 'def' })).status, 401);
  const c = client();
  await c.signup('sakshar');
  assert.equal((await c('/api/ideas', 'POST', { title: 'x', epitaph: 'def' })).status, 400);
  assert.equal((await c('/api/ideas', 'POST', { title: 'abc', epitaph: '' })).status, 400);
  const idea = await c.bury({ title: '  Hello\n\tworld  ', cause: 'bogus', tags: ['AI', 'a', 'fin-tech', 'AI', '!!', 'x1', 'y2', 'z3', 'w4'], story: 'Line one\n\n\n\nLine two' });
  assert.equal(idea.title, 'Hello world');
  assert.equal(idea.cause, 'Lost motivation');
  assert.deepEqual(idea.tags, ['ai', 'fin-tech', 'x1', 'y2', 'z3']);
  assert.equal(idea.story, 'Line one\n\nLine two');
  assert.equal(idea.status, 'dead');
  assert.equal(idea.canDelete, true);
  assert.equal(idea.author.username, 'sakshar');
});

test('honeypot submissions are dropped', async t => {
  const { client } = await start(t, { SEED: '0' });
  const c = client();
  await c.signup('sakshar');
  const r = await c('/api/ideas', 'POST', { title: 'Spam idea', epitaph: 'buy now', website: 'http://spam' });
  assert.equal(r.status, 200);
  assert.equal((await c('/api/ideas')).data.total, 0);
});

test('candles and me-too toggle and notify the founder', async t => {
  const { client } = await start(t, { SEED: '0' });
  const founder = client(), fan = client();
  await founder.signup('founder');
  await fan.signup('fan');
  const idea = await founder.bury();
  let r = await fan(`/api/ideas/${idea.id}/candle`, 'POST');
  assert.deepEqual([r.data.on, r.data.counts.candles, r.data.mine.candle], [true, 1, true]);
  r = await fan(`/api/ideas/${idea.id}/candle`, 'POST');
  assert.deepEqual([r.data.on, r.data.counts.candles], [false, 0]);
  r = await fan(`/api/ideas/${idea.id}/same`, 'POST');
  assert.equal(r.data.counts.same, 1);
  const notes = await founder('/api/notifications');
  assert.equal(notes.data.unread, 1);
  assert.equal(notes.data.items[0].kind, 'same');
  assert.equal(notes.data.items[0].actor.username, 'fan');
  await founder('/api/notifications/read', 'POST');
  assert.equal((await founder('/api/notifications')).data.unread, 0);
  // your own actions never notify you
  await founder(`/api/ideas/${idea.id}/same`, 'POST');
  assert.equal((await founder('/api/notifications')).data.unread, 0);
});

test('resurrection lifecycle: claim, validate, progress, launch, abandon', async t => {
  const { client } = await start(t, { SEED: '0' });
  const founder = client(), builder = client(), stranger = client();
  await founder.signup('founder');
  await builder.signup('builder');
  await stranger.signup('stranger');
  const idea = await founder.bury();

  assert.equal((await builder(`/api/ideas/${idea.id}/resurrect`, 'POST', { pitch: 'short' })).status, 400);
  assert.equal((await builder(`/api/ideas/${idea.id}/resurrect`, 'POST', { pitch: 'A long enough plan', link: 'javascript:alert(1)' })).status, 400);
  let r = await builder(`/api/ideas/${idea.id}/resurrect`, 'POST', { pitch: 'A long enough plan', link: 'https://example.com/x' });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'planning');
  assert.equal(r.data.resurrections.length, 1);
  const res = r.data.resurrections[0];
  assert.equal(res.mine, true);
  assert.equal(res.updates.length, 1);
  assert.equal((await builder(`/api/ideas/${idea.id}/resurrect`, 'POST', { pitch: 'Again, a long plan' })).status, 409);

  assert.equal((await stranger(`/api/resurrections/${res.id}`, 'PATCH', { status: 'launched' })).status, 404);
  assert.equal((await builder(`/api/resurrections/${res.id}`, 'PATCH', {})).status, 400);
  r = await builder(`/api/resurrections/${res.id}`, 'PATCH', { status: 'launched', note: 'Shipped v1' });
  assert.equal(r.data.status, 'launched');
  assert.equal(r.data.resurrections[0].updates.length, 2);

  const kinds = (await founder('/api/notifications')).data.items.map(n => n.kind);
  assert.deepEqual(kinds.sort(), ['launched', 'resurrected']);

  const list = await stranger('/api/ideas?status=launched');
  assert.equal(list.data.total, 1);

  r = await builder(`/api/resurrections/${res.id}`, 'DELETE');
  assert.equal(r.data.status, 'dead');
  assert.equal(r.data.resurrections.length, 0);
});

test('eulogies can be posted and deleted only by their author', async t => {
  const { client } = await start(t, { SEED: '0' });
  const a = client(), b = client();
  await a.signup('alice');
  await b.signup('bob');
  const idea = await a.bury();
  assert.equal((await b(`/api/ideas/${idea.id}/eulogies`, 'POST', { body: '' })).status, 400);
  const r = await b(`/api/ideas/${idea.id}/eulogies`, 'POST', { body: 'RIP <b>little one</b>' });
  const e = r.data.eulogies[0];
  assert.equal(e.body, 'RIP <b>little one</b>');
  assert.equal(e.canDelete, true);
  assert.equal((await a(`/api/eulogies/${e.id}`, 'DELETE')).status, 404);
  assert.equal((await b(`/api/eulogies/${e.id}`, 'DELETE')).data.eulogies.length, 0);
});

test('listing filters, search, sorting and pagination', async t => {
  const { client } = await start(t);
  const c = client();
  assert.equal((await c('/api/ideas?cause=No%20market')).data.total, 1);
  assert.equal((await c('/api/ideas?q=tiffin')).data.ideas[0].title, 'Uber for tiffin boxes');
  assert.equal((await c('/api/ideas?tag=ai')).data.total, 3);
  assert.equal((await c('/api/ideas?status=risen')).data.total, 2);
  assert.equal((await c('/api/ideas?status=dead')).data.total, 6);
  assert.equal((await c('/api/ideas?user=kabir')).data.total, 2);
  const risen = await c('/api/ideas?sort=risen');
  assert.equal(risen.data.ideas[0].status, 'launched');
  const old = await c('/api/ideas?sort=old');
  assert.equal(old.data.ideas[0].title, 'Parking spot sharing for apartments');
  await c.signup('digger');
  for (let i = 0; i < 10; i++) await c.bury({ title: `Idea number ${i}` });
  const p1 = await c('/api/ideas?sort=new');
  assert.equal(p1.data.ideas.length, 18);
  assert.equal(p1.data.nextOffset, null);
});

test('pagination returns 24 per page', async t => {
  const { client } = await start(t, { SEED: '0' });
  const users = [client(), client(), client()];
  for (const [i, u] of users.entries()) {
    await u.signup(`user${i}`);
    for (let j = 0; j < 10; j++) await u.bury({ title: `Idea ${i}-${j}` });
  }
  const p1 = await users[0]('/api/ideas?sort=new');
  assert.equal(p1.data.ideas.length, 24);
  assert.equal(p1.data.nextOffset, 24);
  const p2 = await users[0]('/api/ideas?sort=new&offset=24');
  assert.equal(p2.data.ideas.length, 6);
});

test('only the founder or an admin can exhume', async t => {
  const { client } = await start(t, { SEED: '0' });
  const founder = client(), other = client(), boss = client();
  await founder.signup('founder');
  await other.signup('other');
  await boss.signup('boss');
  const a = await founder.bury(), b = await founder.bury();
  assert.equal((await other(`/api/ideas/${a.id}`, 'DELETE')).status, 403);
  assert.equal((await founder(`/api/ideas/${a.id}`, 'DELETE')).status, 200);
  assert.equal((await boss(`/api/ideas/${b.id}`, 'DELETE')).status, 200);
  assert.equal((await founder(`/api/ideas/${a.id}`)).status, 404);
});

test('reports and moderation', async t => {
  const { client } = await start(t, { SEED: '0' });
  const founder = client(), reporter = client(), boss = client();
  await founder.signup('founder');
  await reporter.signup('reporter');
  await boss.signup('boss');
  const idea = await founder.bury();
  assert.equal((await reporter(`/api/ideas/${idea.id}/report`, 'POST', { reason: 'spam' })).status, 200);
  assert.equal((await reporter('/api/admin/reports')).status, 403);
  const reports = await boss('/api/admin/reports');
  assert.equal(reports.data.reports.length, 1);
  assert.equal((await boss('/api/me')).data.user.admin, true);

  await boss(`/api/admin/ideas/${idea.id}/hide`, 'POST');
  assert.equal((await reporter('/api/ideas')).data.total, 0);
  assert.equal((await reporter(`/api/ideas/${idea.id}`)).status, 404);
  assert.equal((await founder(`/api/ideas/${idea.id}`)).status, 200);
  assert.equal((await boss('/api/admin/reports')).data.reports.length, 0);
  await boss(`/api/admin/ideas/${idea.id}/restore`, 'POST');
  assert.equal((await reporter('/api/ideas')).data.total, 1);
  assert.equal((await boss(`/api/admin/ideas/${idea.id}/explode`, 'POST')).status, 404);
});

test('autopsy is off without an API key', async t => {
  const { client } = await start(t);
  const c = client();
  await c.signup('sakshar');
  const id = (await c('/api/ideas')).data.ideas[0].id;
  assert.equal((await c(`/api/ideas/${id}/autopsy`, 'POST')).status, 503);
  assert.equal((await c(`/api/ideas/${id}`)).data.aiEnabled, false);
});

test('autopsy calls Claude once, clamps output and caches the result', async t => {
  const claude = mockClaude();
  const { client } = await start(t, { autopsyClient: claude });
  const anon = client(), c = client();
  const idea = (await anon('/api/ideas')).data.ideas[0];
  assert.equal((await anon(`/api/ideas/${idea.id}/autopsy`, 'POST')).status, 401);
  await c.signup('sakshar');
  const [r1, r2] = await Promise.all([c(`/api/ideas/${idea.id}/autopsy`, 'POST'), c(`/api/ideas/${idea.id}/autopsy`, 'POST')]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(claude.calls.length, 1);
  const a = r1.data.autopsy;
  assert.equal(a.survivalOdds, 100);
  assert.equal(a.rootCauses.length, 3);
  assert.equal(a.validationQuestions.length, 3);
  assert.equal(a.model, 'claude-opus-5-5');

  const params = claude.calls[0];
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.match(params.messages[0].content, new RegExp(`<idea>[\\s\\S]*${idea.title}[\\s\\S]*</idea>`));

  await c(`/api/ideas/${idea.id}/autopsy`, 'POST');
  assert.equal(claude.calls.length, 1);
  assert.equal((await anon(`/api/ideas/${idea.id}`)).data.autopsy.verdict, 'Died of logistics.');
});

test('autopsy refusals and failures surface cleanly', async t => {
  const claude = mockClaude(() => ({ stop_reason: 'refusal', parsed_output: null }));
  const { client } = await start(t, { autopsyClient: claude });
  const c = client();
  await c.signup('sakshar');
  const id = (await c('/api/ideas')).data.ideas[0].id;
  const r = await c(`/api/ideas/${id}/autopsy`, 'POST');
  assert.equal(r.status, 422);
  assert.equal((await c(`/api/ideas/${id}`)).data.autopsy, null);
});

test('rate limits burying per user', async t => {
  const { client } = await start(t, { SEED: '0' });
  const c = client();
  await c.signup('digger');
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await c('/api/ideas', 'POST', { title: `Idea ${i}`, epitaph: 'rip' })).status);
  assert.deepEqual(codes, [...Array(10).fill(200), 429, 429]);
});

test('profiles, stats and leaderboard', async t => {
  const { client } = await start(t);
  const c = client();
  const p = await c('/api/users/zara');
  assert.equal(p.data.displayName, 'Zara Khan');
  assert.equal(p.data.stats.resurrecting, 1);
  assert.equal(p.data.resurrecting[0].status, 'building');
  assert.equal((await c('/api/users/ghost')).status, 404);
  const s = await c('/api/stats');
  assert.deepEqual([s.data.buried, s.data.risen, s.data.launched], [8, 2, 1]);
  const lb = await c('/api/leaderboard');
  assert.equal(lb.data.builders[0].username, 'arjun');
  assert.equal(lb.data.mostWanted.length, 5);
  assert.equal(lb.data.causes.length, 7);
});

test('live events stream new burials', async t => {
  const { client, base } = await start(t, { SEED: '0' });
  const c = client();
  await c.signup('sakshar');
  const got = new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, res => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      let buf = '';
      res.on('data', chunk => {
        buf += chunk;
        if (buf.includes('event: buried')) { req.destroy(); resolve(buf); }
      });
    });
    req.on('error', e => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => c.bury({ title: 'Live idea' }), 100);
  });
  assert.match(await got, /"title":"Live idea"/);
});

test('SPA shell, link previews and static file safety', async t => {
  const { client } = await start(t, { SEED: '0' });
  const c = client();
  await c.signup('sakshar');
  const idea = await c.bury({ title: '<script>alert(1)</script>', epitaph: 'Say "hi" & bye' });
  const page = await c(`/idea/${idea.id}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /<meta property="og:title" content="R\.I\.P\. &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page.data, /&quot;Say &quot;hi&quot; &amp; bye&quot;/);
  assert.ok(!page.data.includes('<script>alert(1)'));
  assert.equal((await c('/leaderboard')).status, 200);
  assert.equal((await c('/js/app.js')).status, 200);
  assert.notEqual((await c('/..%2fserver.js')).status, 200);
  assert.equal((await c('/%2e%2e/server.js')).status, 404);
  assert.equal((await c('/nope.txt')).status, 404);
  assert.equal((await c('/api/nope')).status, 404);
});
