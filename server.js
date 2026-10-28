// Idea Graveyard: zero-dependency server. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, 'public');

const CAUSES = ['No time', 'No market', 'Too hard to build', 'Someone beat me to it', 'Lost motivation', 'Ran out of money', 'Better idea came along'];
const MAX_IDEAS = 5000;
const MAX_RESURRECTIONS = 200;

const seed = () => [
  ['AI meal planner for hostel students', 'Cooked up in a dorm, eaten by exams.', 'No time', 'Arjun', 9],
  ['Uber for tiffin boxes', 'Delivered nothing, ever.', 'Too hard to build', 'Meera', 14],
  ['Rent-a-study-buddy marketplace', 'Left on read.', 'Lost motivation', 'Kabir', 6],
  ['Subscription tracker for UPI', 'Cancelled before launch.', 'Someone beat me to it', 'Ishita', 11],
  ['Wedding RSVP chatbot', 'Nobody replied "yes" to the idea.', 'No market', 'Rohan', 3],
].map(([title, epitaph, cause, author, days], i) => ({
  id: crypto.randomUUID(),
  title, epitaph, cause, author,
  why: '',
  buriedAt: Date.now() - days * 86400000 - i * 3600000,
  resurrections: [],
}));

function createStore(file, { seedOnEmpty }) {
  let ideas;
  const save = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ideas, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  if (fs.existsSync(file)) {
    // never overwrite a file we cannot parse: fail loudly so data is not lost
    ideas = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(ideas)) throw new Error(`${file} is not a JSON array`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    ideas = seedOnEmpty ? seed() : [];
    save();
  }
  return { get: () => ideas, save };
}

// fixed-window limiter per key; fine for a single instance
function createLimiter() {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, 60000);
  timer.unref();
  return (key, max, windowMs) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    return h.n <= max;
  };
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// public view never includes contact handles
const view = i => ({
  id: i.id, title: i.title, epitaph: i.epitaph, cause: i.cause, why: i.why,
  author: i.author, buriedAt: i.buriedAt,
  resurrections: i.resurrections.map(r => ({ name: r.name, at: r.at })),
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function createApp(opts = {}) {
  const env = { ...process.env, ...opts };
  const dataFile = env.DATA_FILE || path.join(env.DATA_DIR || __dirname, 'data.json');
  const adminToken = env.ADMIN_TOKEN || '';
  const trustProxy = env.TRUST_PROXY === '1';
  const store = createStore(dataFile, { seedOnEmpty: env.SEED !== '0' });
  const limit = createLimiter();

  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  };
  const json = (res, code, body) =>
    send(res, code, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

  const clientIp = req => {
    if (trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xff) return xff;
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const readBody = req => new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(new Error('content-type'));
    let b = '', over = false;
    req.on('data', c => {
      if (over) return; // keep draining so a clean 413 can be sent
      b += c;
      if (b.length > 10000) { over = true; b = ''; reject(new Error('too large')); }
    });
    req.on('end', () => {
      if (over) return;
      try {
        const v = JSON.parse(b || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('shape');
        resolve(v);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });

  const isAdmin = req => {
    if (!adminToken) return false;
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return false;
    const a = crypto.createHash('sha256').update(m[1]).digest();
    const b = crypto.createHash('sha256').update(adminToken).digest();
    return crypto.timingSafeEqual(a, b);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req);
    try {
      if (url.pathname === '/healthz') return json(res, 200, { ok: true });

      if (url.pathname.startsWith('/api/')) {
        if (!limit('all:' + ip, 120, 60000)) return json(res, 429, { error: 'Too many requests. Slow down.' });
      }

      if (url.pathname === '/api/ideas' && req.method === 'GET') {
        return json(res, 200, { causes: CAUSES, ideas: store.get().map(view) });
      }

      if (url.pathname === '/api/ideas' && req.method === 'POST') {
        if (!limit('bury:' + ip, 5, 3600000)) return json(res, 429, { error: 'You have buried a lot of ideas. Try again later.' });
        const b = await readBody(req);
        if (clean(b.website, 50)) return json(res, 201, { ok: true }); // honeypot: pretend success
        const title = clean(b.title, 80), epitaph = clean(b.epitaph, 140);
        if (title.length < 3 || epitaph.length < 3) return json(res, 400, { error: 'Give your idea a title and an epitaph.' });
        const ideas = store.get();
        if (ideas.length >= MAX_IDEAS) return json(res, 503, { error: 'The graveyard is full.' });
        const idea = {
          id: crypto.randomUUID(), title, epitaph,
          cause: CAUSES.includes(b.cause) ? b.cause : 'Lost motivation',
          why: clean(b.why, 300),
          author: clean(b.author, 30) || 'Anonymous',
          buriedAt: Date.now(), resurrections: [],
        };
        ideas.unshift(idea); store.save();
        return json(res, 201, view(idea));
      }

      const m = url.pathname.match(/^\/api\/ideas\/([\w-]{1,64})\/resurrect$/);
      if (m && req.method === 'POST') {
        if (!limit('res:' + ip, 20, 3600000)) return json(res, 429, { error: 'Too many resurrections. Try again later.' });
        const idea = store.get().find(i => i.id === m[1]);
        if (!idea) return json(res, 404, { error: 'Not found' });
        const b = await readBody(req);
        const name = clean(b.name, 30), contact = clean(b.contact, 80);
        if (!name) return json(res, 400, { error: 'Tell us who is resurrecting this.' });
        if (idea.resurrections.some(r => r.name.toLowerCase() === name.toLowerCase()))
          return json(res, 409, { error: 'You already claimed this one.' });
        if (idea.resurrections.length >= MAX_RESURRECTIONS) return json(res, 409, { error: 'This idea has plenty of builders.' });
        idea.resurrections.push({ name, contact, at: Date.now() });
        store.save();
        return json(res, 200, view(idea));
      }

      // admin: moderation and export of builder contacts (disabled unless ADMIN_TOKEN is set)
      if (url.pathname === '/api/admin/export' && req.method === 'GET') {
        if (!limit('admin:' + ip, 20, 60000)) return json(res, 429, { error: 'Too many requests.' });
        if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized' });
        return json(res, 200, store.get());
      }
      const d = url.pathname.match(/^\/api\/ideas\/([\w-]{1,64})$/);
      if (d && req.method === 'DELETE') {
        if (!limit('admin:' + ip, 20, 60000)) return json(res, 429, { error: 'Too many requests.' });
        if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized' });
        const ideas = store.get();
        const idx = ideas.findIndex(i => i.id === d[1]);
        if (idx < 0) return json(res, 404, { error: 'Not found' });
        ideas.splice(idx, 1); store.save();
        return json(res, 200, { ok: true });
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });

      // static
      let rel;
      try { rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
      catch { return json(res, 400, { error: 'Bad request' }); }
      const file = path.join(PUBLIC, path.normalize(rel));
      if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Forbidden' });
      fs.readFile(file, (err, buf) => {
        if (err) return json(res, 404, { error: 'Not found' });
        send(res, 200, req.method === 'HEAD' ? undefined : buf, {
          'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
      });
    } catch (e) {
      const code = e.message === 'too large' ? 413 : 400;
      if (!res.headersSent) json(res, code, { error: code === 413 ? 'Too large' : 'Bad request' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const server = createApp();
  server.listen(port, () => console.log(`Idea Graveyard running at http://localhost:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createApp };
