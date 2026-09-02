# Website Content Parity Checker (POC)

Compare two sites for **content, image, and layout (geometry)** parity. **Only color / palette changes are allowed.**

This POC uses local mock “old” and “new” Northridge Bank sites. The same checker can later point at VDI-reachable origins via env vars.

## Quick demo

```bash
npm install
npx playwright install chromium
npm run demo
```

That will:

1. Serve old site on `http://127.0.0.1:4173` (navy + brass)
2. Serve new site on `http://127.0.0.1:4174` (teal + citrus, same layout on pass pages)
3. Compare paths from `fixtures/mapping.csv` (Cheerio content/images + Playwright geometry)
4. Print a terminal report and write `reports/latest.html`
5. Keep servers up for 60 seconds so you can browse both sites (`DEMO_HOLD_MS=0` to skip the wait)

Expected POC outcome:

| Page | Result |
|------|--------|
| `/index.html` | pass (color rebrand only) |
| `/about.html` | **fail** (`layout_changed`) |
| `/products.html` | **fail** (`text_changed`) |
| `/rates.html` | pass (color rebrand only) |
| `/contact.html` | **fail** (`image_changed`) |

`npm run demo` exits non-zero when any page fails (expected for this POC).

## Check against already-running origins

```bash
OLD_ORIGIN=http://127.0.0.1:4173 NEW_ORIGIN=http://127.0.0.1:4174 npm run check
```

## Tests

```bash
npm test
```

## Web app (public URLs)

Compare two public site roots in the browser. Each run is stored in MongoDB (results embedded, HTML/PDF in GridFS) and stays downloadable.

```bash
# local Mongo
docker compose up mongo -d
# .env already lists every setting; edit MONGODB_URI if needed
npm run web
```

Open `http://127.0.0.1:3000`. Enter old and new origins. Optionally upload a `old_path,new_path` CSV; otherwise the server reads the old origin’s `/sitemap.xml` and pairs the same paths on the new origin. Cap is 25 pages (`MAX_PAGES`).

**This public app cannot reach VDI bank sites.** Use `npm run check` or `npm run demo` inside the VDI for those. The web form also blocks localhost, private IPs, and cloud metadata hosts (SSRF). Set `ALLOW_PRIVATE_ORIGINS=1` only when you intentionally want to compare local fixtures.

### Deploy

```bash
docker compose up --build
```

Or ship the `Dockerfile` to Fly / Render / Railway (needs RAM for Chromium) and point `MONGODB_URI` at Atlas. Allowlist the host’s egress IPs in Atlas network access.

All settings live in [`.env`](.env) (template: [`.env.example`](.env.example)). `npm run web`, `npm run check`, and `npm run demo` load that file automatically.

| Env | Used by | Purpose |
|-----|---------|---------|
| `HOST` | web | Bind address (default `127.0.0.1`) |
| `PORT` | web | HTTP port (default `3000`) |
| `MAX_PAGES` | web | Page cap per run (default `25`) |
| `RUN_TIMEOUT_MS` | web | Job timeout in ms (default `240000`) |
| `MONGODB_URI` | web | Atlas SRV string or local `mongodb://…` |
| `MONGODB_DB` | web | Database name (default `parity`) |
| `ALLOW_PRIVATE_ORIGINS` | web | `1` to allow loopback/private URLs |
| `LOG_LEVEL` | all | `debug` / `info` / `warn` / `error` (default `info`) |
| `LOG_FORMAT` | all | `text` (default) or `json` on stderr |
| `OLD_ORIGIN` / `NEW_ORIGIN` | check | Origins for `npm run check` |
| `MAPPING` | check, demo | Path to `old_path,new_path` CSV |
| `REPORT` | check, demo | HTML report output path |
| `OLD_PORT` / `NEW_PORT` | demo | Fixture server ports |
| `DEMO_HOLD_MS` | demo | How long mock sites stay up (`0` to skip) |

Downloads per run: interactive HTML, print-ready PDF, and JSON of every mismatch.

## Layout

- `fixtures/old-site` — private-ledger navy branding (content source of truth)
- `fixtures/new-site` — teal rebrand; intentional layout / text / image drift on selected pages
- `fixtures/mapping.csv` — page pairs
- `src/` — fetch → extract → layout → diff → report pipeline, plus the web API (`src/web.ts`)
- `public/` — compare form, run history, and report embed
- `docs/superpowers/specs/` — design spec
