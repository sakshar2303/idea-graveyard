// Password hashing and cookie sessions.
const crypto = require('crypto');

const COOKIE = 'ig_session';
const SESSION_MS = 30 * 86400000;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// a fixed hash so unknown usernames cost the same time as wrong passwords
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSessions(db, { secureCookies }) {
  const insert = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  const find = db.prepare(`SELECT u.id, u.username, u.display_name, u.bio, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`);
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

  const cookie = (value, maxAge) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  return {
    start(userId) {
      purge.run(Date.now());
      const token = crypto.randomBytes(32).toString('base64url');
      insert.run(sha256(token), userId, Date.now() + SESSION_MS);
      return cookie(token, SESSION_MS / 1000);
    },
    user(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (!token) return null;
      const row = find.get(sha256(token));
      if (!row || row.expires_at < Date.now()) return null;
      return row;
    },
    end(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) remove.run(sha256(token));
      return cookie('', 0);
    },
  };
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, createSessions };
