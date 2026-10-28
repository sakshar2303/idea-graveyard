# Idea Graveyard

Every founder has ideas dying in a notes app. **Idea Graveyard** is where you bury them with an epitaph and a cause of death, where other people say "I have this problem too", and where builders **resurrect** them and ship them. Dead ideas become a public pool of validated problems.

Built by Sakshar Dhawan.

## Features

**For founders**
- Bury an idea in a three-step flow with a live tombstone preview: the problem, who had it, cause of death, story, tags and an epitaph
- Drafts autosave, so an unfinished burial is never lost
- Shareable tombstones: one-click LinkedIn share, copy caption, and a downloadable 1080×1350 tombstone image
- Link previews (LinkedIn, WhatsApp) show the idea's name and epitaph

**For the community**
- 🕯 Light a candle (pay respects) and ✋ "I have this problem too" (a real validation signal)
- Eulogies (comments) on every grave
- Notifications when someone resurrects your idea, has your problem, leaves a eulogy or launches it

**For builders**
- Resurrect an idea with a plan and a project link, then post progress updates through Planning, Building and Launched
- A public timeline for every resurrection; launched ideas turn gold with "IT LIVES"
- **AI autopsy** (Claude): why the idea really died, survival odds, a resurrection plan, a 48-hour MVP and the validation questions to ask real users

**Discovery**
- Trending, fresh, most wanted, most mourned, risen and oldest sorts; filters by status, cause of death and tag
- Search palette (`/` or `⌘K`) across ideas, problems and founders
- Hall of Souls: top resurrectionists, top gravediggers, most wanted problems, most mourned ideas and the leading causes of death
- Live ticker over server-sent events: see burials, resurrections and launches as they happen

**Accounts and safety**
- Username and password accounts (scrypt hashing, HttpOnly session cookies)
- Profiles with stats, a bio and tabs for buried and resurrecting ideas
- Reporting plus an admin moderation queue (hide, restore, dismiss)

## Stack

- **Backend:** Node.js 22.13+ with the built-in `node:sqlite` (SQLite in WAL mode). No web framework.
- **Frontend:** vanilla ES modules and hand-written CSS. No build step.
- **AI:** Claude Opus 5.5 through the official Anthropic SDK with structured JSON output.
- **Ops:** Dockerfile, Render blueprint with a persistent disk, GitHub Actions CI.

```
server.js          HTTP server, routes, security headers, live events
lib/db.js          SQLite schema and demo seed data
lib/auth.js        password hashing and sessions
lib/autopsy.js     AI autopsy via Claude
public/index.html  app shell
public/css/        design system
public/js/         router, views, dialogs and components
test/              API test suite (node:test)
```

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first run creates `data/graveyard.db` with demo ideas. Demo users cannot sign in, so create your own account.

To enable the AI autopsy, set an Anthropic API key:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Run the tests:

```bash
npm test
```

## Configuration

See [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for the SQLite database; use a persistent disk in production |
| `ADMIN_USERNAMES` | unset | Comma-separated usernames with moderation access |
| `ANTHROPIC_API_KEY` | unset | Turns on the AI autopsy |
| `SEED` | `1` | Set to `0` to start with an empty graveyard |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so rate limits see real client IPs |
| `COOKIE_SECURE` | auto | Secure cookies; on automatically when `NODE_ENV=production` |

## API

All write requests need `Content-Type: application/json`. Routes marked 🔒 need a session.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/me` | Current user, causes of death, whether AI is on |
| `POST` | `/api/auth/signup` · `/login` · `/logout` | Accounts |
| `PATCH` | `/api/me` 🔒 | Display name and bio |
| `GET` | `/api/ideas` | `sort`, `status`, `cause`, `tag`, `q`, `user`, `offset` |
| `POST` | `/api/ideas` 🔒 | Bury an idea |
| `GET` / `DELETE` | `/api/ideas/:id` | Detail with crew, eulogies and autopsy; delete (founder or admin) |
| `POST` | `/api/ideas/:id/candle` · `/same` 🔒 | Toggle a candle or a "me too" |
| `POST` | `/api/ideas/:id/resurrect` 🔒 | `{pitch, link}` |
| `PATCH` / `DELETE` | `/api/resurrections/:id` 🔒 | `{status, note, link}`, or abandon |
| `POST` | `/api/ideas/:id/eulogies` 🔒 | `{body}`; `DELETE /api/eulogies/:id` |
| `POST` | `/api/ideas/:id/autopsy` 🔒 | Runs once per idea, then cached |
| `POST` | `/api/ideas/:id/report` 🔒 | `{reason}` |
| `GET` | `/api/notifications` 🔒 | Plus `POST /api/notifications/read` |
| `GET` | `/api/users/:username` · `/api/leaderboard` · `/api/stats` | Public |
| `GET` | `/api/events` | Server-sent events: `buried`, `resurrected`, `launched` |
| `GET` / `POST` | `/api/admin/reports` · `/api/admin/ideas/:id/{hide,restore,dismiss}` 🔒 | Admins only |

## Security

- Strict Content Security Policy (no inline scripts or styles), HSTS, `nosniff`, no framing
- CSRF protection: JSON-only writes plus an Origin check, with `SameSite=Lax` HttpOnly cookies
- scrypt password hashes, constant-time comparisons, and equal timing for unknown usernames
- Per-IP and per-user rate limits, body size limits, a honeypot field, and caps on AI usage
- User text is only ever rendered as text, never as HTML; link-preview tags are escaped
- AI input is wrapped as data, and the AI's output is schema-validated and clamped

## Deploy

`render.yaml` deploys the Docker image on [Render](https://render.com) with a 1 GB disk at `/data`. Set `ANTHROPIC_API_KEY` in the dashboard to switch on autopsies. SQLite on one instance comfortably handles thousands of users. To scale out, move to Postgres.

## License

MIT
