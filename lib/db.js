// SQLite storage via the built-in node:sqlite module.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  pass_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  epitaph TEXT NOT NULL,
  cause TEXT NOT NULL,
  problem TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  story TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  autopsy TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  buried_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ideas_buried ON ideas(buried_at DESC);
CREATE INDEX IF NOT EXISTS ideas_user ON ideas(user_id);
CREATE TABLE IF NOT EXISTS resurrections (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pitch TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (idea_id, user_id)
);
CREATE TABLE IF NOT EXISTS updates (
  id TEXT PRIMARY KEY,
  resurrection_id TEXT NOT NULL REFERENCES resurrections(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS candles (
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (idea_id, user_id)
);
CREATE TABLE IF NOT EXISTS same_problem (
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (idea_id, user_id)
);
CREATE TABLE IF NOT EXISTS eulogies (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS eulogies_idea ON eulogies(idea_id, created_at);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (idea_id, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  idea_id TEXT REFERENCES ideas(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);
`;

const DAY = 86400000;

const SEED_USERS = [
  ['arjun', 'Arjun Mehta', 'Hostel survivor. Builds things at 3am.'],
  ['meera', 'Meera Iyer', 'Ex-consultant, current tinkerer.'],
  ['kabir', 'Kabir Singh', 'Ships fast, abandons faster.'],
  ['ishita', 'Ishita Rao', 'Fintech PM by day.'],
  ['rohan', 'Rohan Das', 'Wedding season veteran.'],
  ['zara', 'Zara Khan', 'Designer who codes. Sometimes.'],
];

const SEED_IDEAS = [
  ['arjun', 'AI meal planner for hostel students', 'Cooked up in a dorm, eaten by exams.', 'No time',
    'Hostel students eat badly because mess food is bad and budgets are tiny.', 'College students living in hostels', ['food', 'ai', 'students'], 9],
  ['meera', 'Uber for tiffin boxes', 'Delivered nothing, ever.', 'Too hard to build',
    'Office workers want home-cooked lunch but nobody can deliver it on time.', 'Office workers in metro cities', ['food', 'logistics'], 14],
  ['kabir', 'Rent-a-study-buddy marketplace', 'Left on read.', 'Lost motivation',
    'Studying alone is lonely and people procrastinate without accountability.', 'Exam aspirants', ['edtech', 'community'], 6],
  ['ishita', 'Subscription tracker for UPI autopay', 'Cancelled before launch.', 'Someone beat me to it',
    'People forget UPI autopay mandates and keep paying for apps they never use.', 'Young professionals', ['fintech', 'upi'], 11],
  ['rohan', 'Wedding RSVP chatbot', 'Nobody replied "yes" to the idea.', 'No market',
    'Indian weddings have 800 guests and nobody knows who is actually coming.', 'Families planning weddings', ['events', 'whatsapp'], 3],
  ['zara', 'Figma plugin that roasts your design', 'Too honest to survive.', 'Better idea came along',
    'Junior designers get no feedback until it is too late.', 'Junior designers', ['design', 'ai'], 20],
  ['kabir', 'Parking spot sharing for apartments', 'Parked forever.', 'Ran out of money',
    'Apartment parking spots sit empty all day while visitors circle the block.', 'Apartment residents', ['mobility', 'proptech'], 30],
  ['meera', 'Voice notes to meeting minutes', 'Spoke too soon.', 'Someone beat me to it',
    'Small teams talk in voice notes and lose every decision they make.', 'Small business teams', ['productivity', 'ai'], 2],
];

function seed(db) {
  const now = Date.now();
  const users = {};
  const addUser = db.prepare('INSERT INTO users (username, display_name, bio, created_at) VALUES (?, ?, ?, ?)');
  for (const [u, name, bio] of SEED_USERS) users[u] = Number(addUser.run(u, name, bio, now - 40 * DAY).lastInsertRowid);

  const addIdea = db.prepare(`INSERT INTO ideas (id, user_id, title, epitaph, cause, problem, audience, tags, buried_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const ids = SEED_IDEAS.map(([u, title, epitaph, cause, problem, audience, tags, days], i) => {
    const id = crypto.randomUUID();
    addIdea.run(id, users[u], title, epitaph, cause, problem, audience, JSON.stringify(tags), now - days * DAY - i * 3600000);
    return id;
  });

  const candle = db.prepare('INSERT INTO candles (idea_id, user_id, created_at) VALUES (?, ?, ?)');
  const same = db.prepare('INSERT INTO same_problem (idea_id, user_id, created_at) VALUES (?, ?, ?)');
  const names = Object.keys(users);
  ids.forEach((id, i) => {
    names.forEach((n, j) => {
      if ((i + j) % 2 === 0) candle.run(id, users[n], now - j * 3600000);
      if ((i + j) % 3 === 0) same.run(id, users[n], now - j * 3600000);
    });
  });

  const res = db.prepare(`INSERT INTO resurrections (id, idea_id, user_id, pitch, link, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const upd = db.prepare('INSERT INTO updates (id, resurrection_id, status, note, created_at) VALUES (?, ?, ?, ?, ?)');
  const r1 = crypto.randomUUID(), r2 = crypto.randomUUID();
  res.run(r1, ids[3], users.zara, 'Building it as a WhatsApp bot that reads your bank SMS. No app to install.', '', 'building', now - 5 * DAY, now - DAY);
  upd.run(crypto.randomUUID(), r1, 'planning', 'Talked to 12 friends. 9 had a forgotten autopay.', now - 5 * DAY);
  upd.run(crypto.randomUUID(), r1, 'building', 'SMS parser works for HDFC and ICICI.', now - DAY);
  res.run(r2, ids[4], users.arjun, 'Google Form plus WhatsApp reminders. Ugly but it works.', 'https://example.com', 'launched', now - 2 * DAY, now - 3600000);
  upd.run(crypto.randomUUID(), r2, 'launched', 'Used it for my cousin\'s wedding. 640 RSVPs collected.', now - 3600000);

  const eul = db.prepare('INSERT INTO eulogies (id, idea_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)');
  eul.run(crypto.randomUUID(), ids[1], users.rohan, 'Dabbawalas did it in 1890 with zero tech. You were so close.', now - 4 * DAY);
  eul.run(crypto.randomUUID(), ids[3], users.kabir, 'Gone but never unsubscribed.', now - 3 * DAY);
  eul.run(crypto.randomUUID(), ids[0], users.meera, 'I would have paid for this in second year.', now - 2 * DAY);
}

function openDb(file, { seedOnEmpty = true } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const empty = db.prepare('SELECT COUNT(*) n FROM users').get().n === 0;
  if (empty && seedOnEmpty) tx(db, () => seed(db));
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { openDb, tx };
