# Idea Graveyard

Every founder has ideas dying in a notes app. Idea Graveyard is a public wall where you **bury** an abandoned idea with a short epitaph and a cause of death, and other builders can **resurrect** it and build it. Dead ideas become a shared pool of problems worth solving.

Built by Sakshar Dhawan.

## Features

- Bury an idea: title, epitaph, cause of death, the problem it solved, optional name
- Tombstone wall with filters by cause of death and sorting (newest, oldest, most resurrected)
- Resurrect an idea: builders claim it with a name and an optional private contact
- Live stats: ideas buried, ideas resurrected, unique builders
- Admin moderation: delete ideas and export builder contacts

## Run locally

Requires Node.js 20 or later. No dependencies.

```bash
npm start
```

Open http://localhost:3000. Data is stored in `data.json`, created with five seed ideas on first run.

```bash
npm test
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | app folder | Folder for `data.json`; point at a persistent disk in production |
| `DATA_FILE` | `$DATA_DIR/data.json` | Exact data file path |
| `SEED` | `1` | Set to `0` to start with an empty graveyard |
| `ADMIN_TOKEN` | unset | Enables admin endpoints; leave unset to disable them |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so rate limits use the real client IP |

## API

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/ideas` | | Lists ideas; builder contacts are never included |
| `POST` | `/api/ideas` | `{title, epitaph, cause, why, author}` | 5 per hour per IP |
| `POST` | `/api/ideas/:id/resurrect` | `{name, contact}` | 20 per hour per IP; one claim per name |
| `DELETE` | `/api/ideas/:id` | | Admin: `Authorization: Bearer $ADMIN_TOKEN` |
| `GET` | `/api/admin/export` | | Admin: full data including contacts |
| `GET` | `/healthz` | | Health check |

## Security

- Strict Content Security Policy (no inline scripts or styles), plus `nosniff`, `DENY` framing, HSTS and no-referrer headers
- Per-IP rate limits, 10 KB body limit, JSON-only request bodies, and a honeypot field for bots
- All user text is rendered with `textContent`, never as HTML
- Atomic writes to the data file; the server refuses to start on a corrupt file rather than overwriting it
- Admin token compared in constant time

## Deploy

The included `Dockerfile` runs as a non-root user with a health check. `render.yaml` deploys it on [Render](https://render.com) with a 1 GB persistent disk mounted at `/data` and a generated `ADMIN_TOKEN`.

Storage is a single JSON file, which suits one instance and thousands of ideas. To scale beyond one instance, move storage to a database.

## License

MIT
