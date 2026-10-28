const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

async function start(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-'));
  const server = createApp({ DATA_FILE: path.join(dir, 'data.json'), ADMIN_TOKEN: 'secret-token', ...env });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, method = 'GET', body, headers = {}) => fetch(base + p, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body && JSON.stringify(body),
  });
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  return { dir, call };
}

test('lists seed ideas and sets security headers', async t => {
  const s = await start(t);
  const r = await s.call('/api/ideas');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await r.json()).ideas.length, 5);
});

test('SEED=0 starts empty', async t => {
  const s = await start(t, { SEED: '0' });
  assert.equal((await (await s.call('/api/ideas')).json()).ideas.length, 0);
});

test('bury validates, sanitizes and persists', async t => {
  const s = await start(t, { SEED: '0' });
  assert.equal((await s.call('/api/ideas', 'POST', { title: 'x', epitaph: 'y' })).status, 400);
  const r = await s.call('/api/ideas', 'POST', { title: '  Hello\n\tworld  ', epitaph: 'Gone', cause: 'bogus' });
  assert.equal(r.status, 201);
  const idea = await r.json();
  assert.equal(idea.title, 'Hello world');
  assert.equal(idea.cause, 'Lost motivation');
  assert.equal(idea.author, 'Anonymous');
  const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'data.json'), 'utf8'));
  assert.equal(saved.length, 1);
});

test('requires JSON content type and rejects oversized bodies', async t => {
  const s = await start(t, { SEED: '0' });
  const r1 = await s.call('/api/ideas', 'POST', undefined);
  assert.equal(r1.status, 400);
  const r2 = await s.call('/api/ideas', 'POST', { title: 'a'.repeat(20000), epitaph: 'x' });
  assert.equal(r2.status, 413);
});

test('honeypot is silently dropped', async t => {
  const s = await start(t, { SEED: '0' });
  const r = await s.call('/api/ideas', 'POST', { title: 'Spam idea', epitaph: 'buy now', website: 'http://spam' });
  assert.equal(r.status, 201);
  assert.equal((await (await s.call('/api/ideas')).json()).ideas.length, 0);
});

test('resurrect works, hides contact, blocks duplicates', async t => {
  const s = await start(t, { SEED: '0' });
  const idea = await (await s.call('/api/ideas', 'POST', { title: 'Idea one', epitaph: 'Rest' })).json();
  const r = await s.call(`/api/ideas/${idea.id}/resurrect`, 'POST', { name: 'Sakshar', contact: 'a@b.com' });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(await r.json()).includes('a@b.com'));
  assert.ok(!JSON.stringify(await (await s.call('/api/ideas')).json()).includes('a@b.com'));
  assert.equal((await s.call(`/api/ideas/${idea.id}/resurrect`, 'POST', { name: 'sakshar' })).status, 409);
  assert.equal((await s.call(`/api/ideas/${idea.id}/resurrect`, 'POST', {})).status, 400);
  assert.equal((await s.call('/api/ideas/nope/resurrect', 'POST', { name: 'x' })).status, 404);
});

test('rate limits burying', async t => {
  const s = await start(t, { SEED: '0' });
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await s.call('/api/ideas', 'POST', { title: 'Idea ' + i, epitaph: 'rip' })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429, 429]);
});

test('admin endpoints require the token', async t => {
  const s = await start(t, { SEED: '0' });
  const idea = await (await s.call('/api/ideas', 'POST', { title: 'Idea one', epitaph: 'Rest' })).json();
  await s.call(`/api/ideas/${idea.id}/resurrect`, 'POST', { name: 'Bob', contact: 'bob@x.com' });
  assert.equal((await s.call('/api/admin/export')).status, 401);
  assert.equal((await s.call('/api/admin/export', 'GET', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  const ok = await s.call('/api/admin/export', 'GET', undefined, { Authorization: 'Bearer secret-token' });
  assert.equal(ok.status, 200);
  assert.ok(JSON.stringify(await ok.json()).includes('bob@x.com'));
  assert.equal((await s.call(`/api/ideas/${idea.id}`, 'DELETE')).status, 401);
  assert.equal((await s.call(`/api/ideas/${idea.id}`, 'DELETE', undefined, { Authorization: 'Bearer secret-token' })).status, 200);
  assert.equal((await (await s.call('/api/ideas')).json()).ideas.length, 0);
});

test('admin disabled when ADMIN_TOKEN unset', async t => {
  const s = await start(t, { SEED: '0', ADMIN_TOKEN: '' });
  assert.equal((await s.call('/api/admin/export', 'GET', undefined, { Authorization: 'Bearer ' })).status, 401);
});

test('static files, health check and traversal protection', async t => {
  const s = await start(t);
  assert.equal((await s.call('/healthz')).status, 200);
  const home = await s.call('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Idea Graveyard/);
  assert.equal((await s.call('/app.js')).status, 200);
  assert.notEqual((await s.call('/..%2fserver.js')).status, 200);
  assert.equal((await s.call('/%2e%2e/server.js')).status, 404);
  assert.equal((await s.call('/nope.txt')).status, 404);
});

test('refuses to start on a corrupt data file instead of overwriting it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, '{not json');
  assert.throws(() => createApp({ DATA_FILE: file }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json');
});
