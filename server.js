// Idea Graveyard server. Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDb, tx } = require('./lib/db');
const { hashPassword, verifyPassword, DUMMY_HASH, createSessions } = require('./lib/auth');
const { createAutopsy } = require('./lib/autopsy');

const PUBLIC = path.join(__dirname, 'public');

const CAUSES = ['No time', 'No market', 'Too hard to build', 'Someone beat me to it', 'Lost motivation', 'Ran out of money', 'Better idea came along'];
const STATUSES = ['planning', 'building', 'launched'];
const STAGE = { 0: 'dead', 1: 'planning', 2: 'building', 3: 'launched' };
const MAX_IDEAS = 20000;
const PAGE = 24;

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, ' ');
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cleanLink(v) {
  const s = oneLine(v, 300);
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw 0;
    return u.toString();
  } catch { throw new HttpError(400, 'The link must be a full http(s) URL.'); }
}

function cleanTags(v) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
  const tags = arr.map(t => oneLine(t, 20).toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(t => t.length >= 2);
  return [...new Set(tags)].slice(0, 5);
}

function createLimiter() {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, 60000).unref();
  return (key, max, windowMs) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    return ++h.n <= max;
  };
}

function createApp(opts = {}) {
  const env = { ...process.env, ...opts };
  const dbFile = env.DB_FILE || path.join(env.DATA_DIR || path.join(__dirname, 'data'), 'graveyard.db');
  const db = openDb(dbFile, { seedOnEmpty: env.SEED !== '0' });
  const sessions = createSessions(db, { secureCookies: env.COOKIE_SECURE === '1' || env.NODE_ENV === 'production' });
  const autopsy = createAutopsy({ apiKey: env.ANTHROPIC_API_KEY, client: opts.autopsyClient });
  const admins = new Set(String(env.ADMIN_USERNAMES || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean));
  const trustProxy = env.TRUST_PROXY === '1';
  const limit = createLimiter();
  const autopsyInFlight = new Map();
  const shellHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

  // ---------- live events (server-sent events) ----------
  const streams = new Set();
  const broadcast = (type, data) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) res.write(msg);
  };
  setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 25000).unref();

  // ---------- queries ----------
  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertUser: db.prepare('INSERT INTO users (username, display_name, bio, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    updateUser: db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?'),
    ideaRow: db.prepare('SELECT * FROM ideas WHERE id = ?'),
    countIdeas: db.prepare('SELECT COUNT(*) n FROM ideas'),
    insertIdea: db.prepare(`INSERT INTO ideas (id, user_id, title, epitaph, cause, problem, audience, story, tags, buried_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    deleteIdea: db.prepare('DELETE FROM ideas WHERE id = ?'),
    hideIdea: db.prepare('UPDATE ideas SET hidden = ? WHERE id = ?'),
    saveAutopsy: db.prepare('UPDATE ideas SET autopsy = ? WHERE id = ?'),
    resurrectionsFor: db.prepare(`SELECT r.*, u.username, u.display_name FROM resurrections r JOIN users u ON u.id = r.user_id
      WHERE r.idea_id = ? ORDER BY CASE r.status WHEN 'launched' THEN 0 WHEN 'building' THEN 1 ELSE 2 END, r.created_at`),
    updatesFor: db.prepare('SELECT * FROM updates WHERE resurrection_id = ? ORDER BY created_at'),
    resurrectionRow: db.prepare('SELECT * FROM resurrections WHERE id = ?'),
    insertResurrection: db.prepare(`INSERT INTO resurrections (id, idea_id, user_id, pitch, link, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'planning', ?, ?)`),
    updateResurrection: db.prepare('UPDATE resurrections SET status = ?, pitch = ?, link = ?, updated_at = ? WHERE id = ?'),
    deleteResurrection: db.prepare('DELETE FROM resurrections WHERE id = ?'),
    insertUpdate: db.prepare('INSERT INTO updates (id, resurrection_id, status, note, created_at) VALUES (?, ?, ?, ?, ?)'),
    eulogiesFor: db.prepare(`SELECT e.*, u.username, u.display_name FROM eulogies e JOIN users u ON u.id = e.user_id
      WHERE e.idea_id = ? ORDER BY e.created_at`),
    eulogyRow: db.prepare('SELECT * FROM eulogies WHERE id = ?'),
    insertEulogy: db.prepare('INSERT INTO eulogies (id, idea_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)'),
    deleteEulogy: db.prepare('DELETE FROM eulogies WHERE id = ?'),
    insertReport: db.prepare('INSERT OR IGNORE INTO reports (id, idea_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)'),
    openReports: db.prepare(`SELECT r.id, r.reason, r.created_at, r.idea_id, i.title, i.hidden, u.username
      FROM reports r JOIN ideas i ON i.id = r.idea_id JOIN users u ON u.id = r.user_id WHERE r.resolved = 0 ORDER BY r.created_at DESC`),
    resolveReports: db.prepare('UPDATE reports SET resolved = 1 WHERE idea_id = ?'),
    notify: db.prepare('INSERT INTO notifications (user_id, kind, idea_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?)'),
    notifications: db.prepare(`SELECT n.id, n.kind, n.read, n.created_at, n.idea_id, i.title, u.username actor, u.display_name actor_name
      FROM notifications n LEFT JOIN ideas i ON i.id = n.idea_id LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 30`),
    unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0'),
    markRead: db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?'),
  };

  const toggles = {
    candle: {
      has: db.prepare('SELECT 1 FROM candles WHERE idea_id = ? AND user_id = ?'),
      add: db.prepare('INSERT INTO candles (idea_id, user_id, created_at) VALUES (?, ?, ?)'),
      del: db.prepare('DELETE FROM candles WHERE idea_id = ? AND user_id = ?'),
    },
    same: {
      has: db.prepare('SELECT 1 FROM same_problem WHERE idea_id = ? AND user_id = ?'),
      add: db.prepare('INSERT INTO same_problem (idea_id, user_id, created_at) VALUES (?, ?, ?)'),
      del: db.prepare('DELETE FROM same_problem WHERE idea_id = ? AND user_id = ?'),
    },
  };

  const IDEA_SELECT = `SELECT i.id, i.title, i.epitaph, i.cause, i.problem, i.audience, i.tags, i.buried_at, i.hidden, i.user_id,
      u.username, u.display_name,
      (SELECT COUNT(*) FROM candles c WHERE c.idea_id = i.id) candles,
      (SELECT COUNT(*) FROM same_problem s WHERE s.idea_id = i.id) same,
      (SELECT COUNT(*) FROM resurrections r WHERE r.idea_id = i.id) resurrections,
      (SELECT COUNT(*) FROM eulogies e WHERE e.idea_id = i.id) eulogies,
      COALESCE((SELECT MAX(CASE r.status WHEN 'launched' THEN 3 WHEN 'building' THEN 2 ELSE 1 END)
        FROM resurrections r WHERE r.idea_id = i.id), 0) stage
    FROM ideas i JOIN users u ON u.id = i.user_id`;
  const allIdeas = db.prepare(`${IDEA_SELECT} WHERE i.hidden = 0`);
  const allIdeasAdmin = db.prepare(IDEA_SELECT);
  const oneIdea = db.prepare(`${IDEA_SELECT} WHERE i.id = ?`);
  const mineCandles = db.prepare('SELECT idea_id FROM candles WHERE user_id = ?');
  const mineSame = db.prepare('SELECT idea_id FROM same_problem WHERE user_id = ?');
  const mineRes = db.prepare('SELECT idea_id FROM resurrections WHERE user_id = ?');

  const isAdmin = user => !!user && admins.has(user.username.toLowerCase());
  const publicUser = u => ({ username: u.username, displayName: u.display_name });

  function mineSets(user) {
    if (!user) return null;
    const set = stmt => new Set(stmt.all(user.id).map(r => r.idea_id));
    return { candle: set(mineCandles), same: set(mineSame), res: set(mineRes) };
  }

  function ideaCard(r, mine) {
    return {
      id: r.id, title: r.title, epitaph: r.epitaph, cause: r.cause, problem: r.problem, audience: r.audience,
      tags: JSON.parse(r.tags), buriedAt: r.buried_at, hidden: !!r.hidden,
      author: { username: r.username, displayName: r.display_name },
      counts: { candles: r.candles, same: r.same, resurrections: r.resurrections, eulogies: r.eulogies },
      status: STAGE[r.stage],
      mine: mine ? { candle: mine.candle.has(r.id), same: mine.same.has(r.id), resurrected: mine.res.has(r.id) } : null,
    };
  }

  // trending: engagement decays with age so fresh activity rises
  const score = r => (r.candles + 3 * r.same + 5 * r.resurrections + 2 * r.eulogies + 1) /
    Math.pow((Date.now() - r.buried_at) / 3600000 + 2, 0.8);

  const SORTS = {
    trending: (a, b) => score(b) - score(a),
    new: (a, b) => b.buried_at - a.buried_at,
    old: (a, b) => a.buried_at - b.buried_at,
    mourned: (a, b) => b.candles - a.candles || b.buried_at - a.buried_at,
    wanted: (a, b) => b.same - a.same || b.buried_at - a.buried_at,
    risen: (a, b) => b.stage - a.stage || b.resurrections - a.resurrections || b.buried_at - a.buried_at,
  };

  function listIdeas(params, user) {
    let rows = (isAdmin(user) && params.get('hidden') === '1' ? allIdeasAdmin : allIdeas).all();
    const term = oneLine(params.get('q'), 60).toLowerCase();
    const cause = params.get('cause');
    const tag = params.get('tag');
    const status = params.get('status');
    const author = params.get('user');
    if (term) rows = rows.filter(r => `${r.title} ${r.epitaph} ${r.problem} ${r.audience} ${r.tags} ${r.display_name}`.toLowerCase().includes(term));
    if (cause && CAUSES.includes(cause)) rows = rows.filter(r => r.cause === cause);
    if (tag) rows = rows.filter(r => JSON.parse(r.tags).includes(tag.toLowerCase()));
    if (status === 'dead') rows = rows.filter(r => r.stage === 0);
    if (status === 'risen') rows = rows.filter(r => r.stage > 0);
    if (status === 'launched') rows = rows.filter(r => r.stage === 3);
    if (author) rows = rows.filter(r => r.username.toLowerCase() === author.toLowerCase());
    rows.sort(SORTS[params.get('sort')] || SORTS.trending);
    const offset = Math.max(0, parseInt(params.get('offset'), 10) || 0);
    const page = rows.slice(offset, offset + PAGE);
    const mine = mineSets(user);
    return { ideas: page.map(r => ideaCard(r, mine)), total: rows.length, nextOffset: offset + PAGE < rows.length ? offset + PAGE : null };
  }

  function ideaDetail(id, user) {
    const r = oneIdea.get(id);
    if (!r || (r.hidden && !isAdmin(user) && r.user_id !== user?.id)) throw new HttpError(404, 'This grave is empty.');
    const full = q.ideaRow.get(id);
    const card = ideaCard(r, mineSets(user));
    return {
      ...card,
      story: full.story,
      autopsy: full.autopsy ? JSON.parse(full.autopsy) : null,
      aiEnabled: !!autopsy,
      canDelete: !!user && (user.id === r.user_id || isAdmin(user)),
      resurrections: q.resurrectionsFor.all(id).map(x => ({
        id: x.id, pitch: x.pitch, link: x.link, status: x.status, createdAt: x.created_at, updatedAt: x.updated_at,
        user: publicUser(x), mine: !!user && x.user_id === user.id,
        updates: q.updatesFor.all(x.id).map(u => ({ id: u.id, status: u.status, note: u.note, createdAt: u.created_at })),
      })),
      eulogies: q.eulogiesFor.all(id).map(e => ({
        id: e.id, body: e.body, createdAt: e.created_at, user: publicUser(e),
        canDelete: !!user && (e.user_id === user.id || isAdmin(user)),
      })),
    };
  }

  function stats() {
    const one = sql => db.prepare(sql).get().n;
    return {
      buried: one('SELECT COUNT(*) n FROM ideas WHERE hidden = 0'),
      risen: one('SELECT COUNT(DISTINCT r.idea_id) n FROM resurrections r JOIN ideas i ON i.id = r.idea_id WHERE i.hidden = 0'),
      launched: one(`SELECT COUNT(DISTINCT r.idea_id) n FROM resurrections r JOIN ideas i ON i.id = r.idea_id WHERE i.hidden = 0 AND r.status = 'launched'`),
      builders: one('SELECT COUNT(DISTINCT user_id) n FROM resurrections'),
      candles: one('SELECT COUNT(*) n FROM candles'),
      validations: one('SELECT COUNT(*) n FROM same_problem'),
    };
  }

  function leaderboard() {
    const builders = db.prepare(`SELECT u.username, u.display_name,
        COUNT(*) resurrections, SUM(r.status = 'launched') launched, SUM(r.status = 'building') building
      FROM resurrections r JOIN users u ON u.id = r.user_id JOIN ideas i ON i.id = r.idea_id WHERE i.hidden = 0
      GROUP BY u.id ORDER BY launched DESC, building DESC, resurrections DESC LIMIT 10`).all();
    const gravediggers = db.prepare(`SELECT u.username, u.display_name, COUNT(*) buried,
        (SELECT COUNT(*) FROM candles c JOIN ideas i2 ON i2.id = c.idea_id WHERE i2.user_id = u.id) candles
      FROM ideas i JOIN users u ON u.id = i.user_id WHERE i.hidden = 0 GROUP BY u.id ORDER BY buried DESC, candles DESC LIMIT 10`).all();
    const rows = allIdeas.all();
    const mine = null;
    const top = (cmp, n = 5) => [...rows].sort(cmp).slice(0, n).map(r => ideaCard(r, mine));
    return {
      builders: builders.map(b => ({ ...publicUser(b), resurrections: b.resurrections, launched: b.launched, building: b.building })),
      gravediggers: gravediggers.map(g => ({ ...publicUser(g), buried: g.buried, candles: g.candles })),
      mostWanted: top(SORTS.wanted),
      mostMourned: top(SORTS.mourned),
      causes: CAUSES.map(c => ({ cause: c, count: rows.filter(r => r.cause === c).length })).sort((a, b) => b.count - a.count),
    };
  }

  function profile(username, viewer) {
    const u = q.userByName.get(username);
    if (!u) throw new HttpError(404, 'No such soul.');
    const mine = mineSets(viewer);
    const buried = allIdeas.all().filter(r => r.user_id === u.id).sort(SORTS.new).map(r => ideaCard(r, mine));
    const resurrecting = db.prepare(`SELECT r.status, r.pitch, r.updated_at, i.id idea_id FROM resurrections r
      JOIN ideas i ON i.id = r.idea_id WHERE r.user_id = ? AND i.hidden = 0 ORDER BY r.updated_at DESC`).all(u.id)
      .map(r => ({ status: r.status, pitch: r.pitch, updatedAt: r.updated_at, idea: ideaCard(oneIdea.get(r.idea_id), mine) }));
    return {
      username: u.username, displayName: u.display_name, bio: u.bio, joinedAt: u.created_at,
      stats: {
        buried: buried.length,
        resurrecting: resurrecting.length,
        launched: resurrecting.filter(r => r.status === 'launched').length,
        candles: buried.reduce((s, i) => s + i.counts.candles, 0),
      },
      buried, resurrecting,
    };
  }

  const meView = user => user && ({
    ...publicUser(user), bio: user.bio, admin: isAdmin(user), unread: q.unread.get(user.id).n,
  });

  const notify = (userId, kind, ideaId, actorId) => {
    if (userId !== actorId) q.notify.run(userId, kind, ideaId, actorId, Date.now());
  };

  // ---------- http plumbing ----------
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  };
  const json = (res, code, body, headers = {}) =>
    send(res, code, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });

  const clientIp = req => {
    if (trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xff) return xff;
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const readBody = req => new Promise((resolve, reject) => {
    let b = '', over = false;
    req.on('data', c => {
      if (over) return; // keep draining so a clean 413 can be sent
      b += c;
      if (b.length > 20000) { over = true; b = ''; reject(new HttpError(413, 'Too large')); }
    });
    req.on('end', () => {
      if (over) return;
      try {
        const v = JSON.parse(b || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
        resolve(v);
      } catch { reject(new HttpError(400, 'Bad request')); }
    });
    req.on('error', reject);
  });

  const rate = (key, max, windowMs, msg = 'Slow down a little and try again.') => {
    if (!limit(key, max, windowMs)) throw new HttpError(429, msg);
  };

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler, { auth = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([\\w-]{1,64})'; }) + '$');
    routes.push({ method, re, keys, handler, auth });
  };

  route('GET', '/healthz', () => ({ ok: true }));

  route('GET', '/api/me', ({ user }) => ({ user: meView(user), causes: CAUSES, aiEnabled: !!autopsy }));

  route('POST', '/api/auth/signup', async ({ req, res, ip }) => {
    rate('signup:' + ip, 5, 3600000, 'Too many new accounts from here. Try again later.');
    const b = await readBody(req);
    const username = oneLine(b.username, 20);
    const password = String(b.password ?? '');
    const displayName = oneLine(b.displayName, 40) || username;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw new HttpError(400, 'Usernames are 3 to 20 letters, numbers or underscores.');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Use a password of at least 8 characters.');
    if (q.userByName.get(username)) throw new HttpError(409, 'That username is taken.');
    const id = Number(q.insertUser.run(username, displayName, '', hashPassword(password), Date.now()).lastInsertRowid);
    res.setHeader('Set-Cookie', sessions.start(id));
    return { user: meView(q.userByName.get(username)) };
  });

  route('POST', '/api/auth/login', async ({ req, res, ip }) => {
    rate('login:' + ip, 10, 900000, 'Too many attempts. Wait a few minutes.');
    const b = await readBody(req);
    const u = q.userByName.get(oneLine(b.username, 20));
    const ok = verifyPassword(String(b.password ?? ''), u?.pass_hash || DUMMY_HASH) && !!u?.pass_hash;
    if (!ok) throw new HttpError(401, 'Wrong username or password.');
    res.setHeader('Set-Cookie', sessions.start(u.id));
    return { user: meView(u) };
  });

  route('POST', '/api/auth/logout', async ({ req, res }) => {
    res.setHeader('Set-Cookie', sessions.end(req));
    return { ok: true };
  });

  route('PATCH', '/api/me', async ({ req, user }) => {
    const b = await readBody(req);
    const displayName = oneLine(b.displayName, 40) || user.display_name;
    q.updateUser.run(displayName, clean(b.bio, 160), user.id);
    return { user: meView(q.userByName.get(user.username)) };
  }, { auth: true });

  route('GET', '/api/stats', () => stats());
  route('GET', '/api/leaderboard', () => leaderboard());
  route('GET', '/api/ideas', ({ url, user }) => listIdeas(url.searchParams, user));
  route('GET', '/api/ideas/:id', ({ params, user }) => ideaDetail(params.id, user));
  route('GET', '/api/users/:username', ({ params, user }) => profile(params.username, user));

  route('POST', '/api/ideas', async ({ req, user }) => {
    rate('bury:' + user.id, 10, 3600000, 'You have buried a lot today. Let the soil settle.');
    const b = await readBody(req);
    if (oneLine(b.website, 50)) return { ok: true }; // honeypot
    const title = oneLine(b.title, 80), epitaph = oneLine(b.epitaph, 140);
    if (title.length < 3) throw new HttpError(400, 'Give your idea a name.');
    if (epitaph.length < 3) throw new HttpError(400, 'Every grave needs an epitaph.');
    if (q.countIdeas.get().n >= MAX_IDEAS) throw new HttpError(503, 'The graveyard is full.');
    const id = crypto.randomUUID();
    q.insertIdea.run(id, user.id, title, epitaph, CAUSES.includes(b.cause) ? b.cause : 'Lost motivation',
      clean(b.problem, 400), oneLine(b.audience, 120), clean(b.story, 1500), JSON.stringify(cleanTags(b.tags)), Date.now());
    broadcast('buried', { id, title, by: user.display_name });
    return ideaDetail(id, user);
  }, { auth: true });

  route('DELETE', '/api/ideas/:id', ({ params, user }) => {
    const idea = q.ideaRow.get(params.id);
    if (!idea) throw new HttpError(404, 'Not found');
    if (idea.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'Only the one who buried it can exhume it.');
    q.deleteIdea.run(params.id);
    return { ok: true };
  }, { auth: true });

  for (const kind of ['candle', 'same']) {
    route('POST', `/api/ideas/:id/${kind}`, ({ params, user }) => {
      rate(`${kind}:` + user.id, 120, 3600000);
      const idea = q.ideaRow.get(params.id);
      if (!idea || idea.hidden) throw new HttpError(404, 'Not found');
      const t = toggles[kind];
      const on = !t.has.get(params.id, user.id);
      if (on) {
        t.add.run(params.id, user.id, Date.now());
        if (kind === 'same') notify(idea.user_id, 'same', idea.id, user.id);
      } else t.del.run(params.id, user.id);
      const card = ideaCard(oneIdea.get(params.id), mineSets(user));
      return { on, counts: card.counts, mine: card.mine };
    }, { auth: true });
  }

  route('POST', '/api/ideas/:id/resurrect', async ({ req, params, user }) => {
    rate('res:' + user.id, 20, 3600000);
    const idea = q.ideaRow.get(params.id);
    if (!idea || idea.hidden) throw new HttpError(404, 'Not found');
    const b = await readBody(req);
    const pitch = clean(b.pitch, 400);
    if (pitch.length < 10) throw new HttpError(400, 'Tell everyone how you will bring it back (at least 10 characters).');
    const link = cleanLink(b.link);
    const now = Date.now(), id = crypto.randomUUID();
    try {
      tx(db, () => {
        q.insertResurrection.run(id, idea.id, user.id, pitch, link, now, now);
        q.insertUpdate.run(crypto.randomUUID(), id, 'planning', pitch, now);
      });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'You are already resurrecting this one.');
      throw e;
    }
    notify(idea.user_id, 'resurrected', idea.id, user.id);
    broadcast('resurrected', { id: idea.id, title: idea.title, by: user.display_name });
    return ideaDetail(idea.id, user);
  }, { auth: true });

  route('PATCH', '/api/resurrections/:id', async ({ req, params, user }) => {
    rate('upd:' + user.id, 30, 3600000);
    const r = q.resurrectionRow.get(params.id);
    if (!r || r.user_id !== user.id) throw new HttpError(404, 'Not found');
    const b = await readBody(req);
    const status = STATUSES.includes(b.status) ? b.status : r.status;
    const note = clean(b.note, 400);
    const link = b.link === undefined ? r.link : cleanLink(b.link);
    if (status === r.status && !note && link === r.link) throw new HttpError(400, 'Nothing changed.');
    const now = Date.now();
    tx(db, () => {
      q.updateResurrection.run(status, r.pitch, link, now, r.id);
      if (note || status !== r.status) q.insertUpdate.run(crypto.randomUUID(), r.id, status, note, now);
    });
    const idea = q.ideaRow.get(r.idea_id);
    if (status !== r.status) {
      notify(idea.user_id, status === 'launched' ? 'launched' : 'progress', idea.id, user.id);
      if (status === 'launched') broadcast('launched', { id: idea.id, title: idea.title, by: user.display_name });
    }
    return ideaDetail(idea.id, user);
  }, { auth: true });

  route('DELETE', '/api/resurrections/:id', ({ params, user }) => {
    const r = q.resurrectionRow.get(params.id);
    if (!r || (r.user_id !== user.id && !isAdmin(user))) throw new HttpError(404, 'Not found');
    q.deleteResurrection.run(r.id);
    return ideaDetail(r.idea_id, user);
  }, { auth: true });

  route('POST', '/api/ideas/:id/eulogies', async ({ req, params, user }) => {
    rate('eul:' + user.id, 20, 600000, 'That is a lot of grief. Take a breath.');
    const idea = q.ideaRow.get(params.id);
    if (!idea || idea.hidden) throw new HttpError(404, 'Not found');
    const b = await readBody(req);
    const body = clean(b.body, 500);
    if (body.length < 2) throw new HttpError(400, 'Say a few words.');
    q.insertEulogy.run(crypto.randomUUID(), idea.id, user.id, body, Date.now());
    notify(idea.user_id, 'eulogy', idea.id, user.id);
    return ideaDetail(idea.id, user);
  }, { auth: true });

  route('DELETE', '/api/eulogies/:id', ({ params, user }) => {
    const e = q.eulogyRow.get(params.id);
    if (!e || (e.user_id !== user.id && !isAdmin(user))) throw new HttpError(404, 'Not found');
    q.deleteEulogy.run(e.id);
    return ideaDetail(e.idea_id, user);
  }, { auth: true });

  route('POST', '/api/ideas/:id/report', async ({ req, params, user }) => {
    rate('report:' + user.id, 10, 3600000);
    if (!q.ideaRow.get(params.id)) throw new HttpError(404, 'Not found');
    const b = await readBody(req);
    q.insertReport.run(crypto.randomUUID(), params.id, user.id, oneLine(b.reason, 200) || 'No reason given', Date.now());
    return { ok: true };
  }, { auth: true });

  route('POST', '/api/ideas/:id/autopsy', async ({ params, user }) => {
    if (!autopsy) throw new HttpError(503, 'The coroner is off duty (AI is not configured).');
    const idea = q.ideaRow.get(params.id);
    if (!idea || idea.hidden) throw new HttpError(404, 'Not found');
    if (idea.autopsy) return { autopsy: JSON.parse(idea.autopsy) };
    rate('autopsy:' + user.id, 5, 3600000, 'The coroner needs a break. Try again in an hour.');
    rate('autopsy:global', 200, 86400000, 'The coroner is fully booked today.');
    // one call per idea even if many people click at once
    if (!autopsyInFlight.has(idea.id)) {
      const p = autopsy({ ...idea, tags: JSON.parse(idea.tags) })
        .then(result => { q.saveAutopsy.run(JSON.stringify(result), idea.id); return result; })
        .finally(() => autopsyInFlight.delete(idea.id));
      autopsyInFlight.set(idea.id, p);
    }
    try {
      return { autopsy: await autopsyInFlight.get(idea.id) };
    } catch (e) {
      if (e instanceof HttpError || e.status === 422 || e.status === 502) throw new HttpError(e.status, e.message);
      console.error('autopsy failed:', e.message);
      throw new HttpError(502, 'The coroner could not finish. Try again in a minute.');
    }
  }, { auth: true });

  route('GET', '/api/notifications', ({ user }) => ({
    unread: q.unread.get(user.id).n,
    items: q.notifications.all(user.id).map(n => ({
      id: n.id, kind: n.kind, read: !!n.read, createdAt: n.created_at,
      idea: n.idea_id ? { id: n.idea_id, title: n.title } : null,
      actor: n.actor ? { username: n.actor, displayName: n.actor_name } : null,
    })),
  }), { auth: true });

  route('POST', '/api/notifications/read', ({ user }) => { q.markRead.run(user.id); return { ok: true }; }, { auth: true });

  route('GET', '/api/admin/reports', ({ user }) => {
    if (!isAdmin(user)) throw new HttpError(403, 'Admins only.');
    return { reports: q.openReports.all() };
  }, { auth: true });

  route('POST', '/api/admin/ideas/:id/:action', ({ params, user }) => {
    if (!isAdmin(user)) throw new HttpError(403, 'Admins only.');
    if (!q.ideaRow.get(params.id)) throw new HttpError(404, 'Not found');
    if (params.action === 'hide') q.hideIdea.run(1, params.id);
    else if (params.action === 'restore') q.hideIdea.run(0, params.id);
    else if (params.action !== 'dismiss') throw new HttpError(404, 'Not found');
    q.resolveReports.run(params.id);
    return { ok: true };
  }, { auth: true });

  // ---------- static + SPA shell ----------
  function serveShell(res, url) {
    let html = shellHtml;
    const m = url.pathname.match(/^\/idea\/([\w-]{1,64})$/);
    const idea = m && q.ideaRow.get(m[1]);
    if (idea && !idea.hidden) {
      // link previews (LinkedIn, WhatsApp) read these tags without running JS
      const t = escapeHtml(`R.I.P. ${idea.title} | Idea Graveyard`);
      const d = escapeHtml(`"${idea.epitaph}" Cause of death: ${idea.cause}. Resurrect it and build it.`);
      html = html.replace(/<title>.*?<\/title>/, `<title>${t}</title>`)
        .replace(/(<meta property="og:title" content=")[^"]*/, `$1${t}`)
        .replace(/(<meta property="og:description" content=")[^"]*/, `$1${d}`)
        .replace(/(<meta name="description" content=")[^"]*/, `$1${d}`);
    }
    send(res, 200, html, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
  }

  function serveStatic(req, res, url) {
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Bad request' }); }
    if (rel === '/' || !path.extname(rel)) return serveShell(res, url);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return json(res, 404, { error: 'Not found' });
      send(res, 200, req.method === 'HEAD' ? undefined : buf, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
    });
  }

  function openStream(req, res, ip) {
    if (streams.size >= 2000 || !limit('sse:' + ip, 30, 60000)) return json(res, 429, { error: 'Too many connections' });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req);
    try {
      if (url.pathname === '/api/events' && req.method === 'GET') return openStream(req, res, ip);

      if (url.pathname.startsWith('/api/')) {
        rate('all:' + ip, 300, 60000, 'Too many requests. Slow down.');
        if (req.method !== 'GET') {
          // CSRF: browsers cannot send a JSON content type cross-site without a preflight we never approve
          if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send JSON.');
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.');
        }
      }

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
        const user = sessions.user(req);
        if (r.auth && !user) throw new HttpError(401, 'Sign in first.');
        const out = await r.handler({ req, res, url, params, user, ip });
        return json(res, 200, out);
      }

      if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') throw new HttpError(404, 'Not found');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      serveStatic(req, res, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something broke in the crypt.' : e.message });
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  server.on('close', () => { for (const s of streams) s.end(); db.close(); });
  return server;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const server = createApp();
  server.listen(port, () => console.log(`Idea Graveyard running at http://localhost:${port}`));
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createApp };
