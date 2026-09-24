# Development

This guide covers setting up a development environment, the available scripts, testing, and how to make common kinds of changes.

## Prerequisites

- Node.js 20
- pnpm 9 (the repo pins `packageManager: pnpm@9.0.0`)
- Python 3 + Mutagen (`pip3 install mutagen`) — used by the tag writer
- `ffmpeg` — used by transcoding/waveform features
- Docker + Docker Compose v2 — only if you develop inside containers

## Setup

```bash
pnpm install
cp .env.example .env   # set SESSION_SECRET (≥ 32 chars)
pnpm dev               # runs server (tsx watch) and web UI (Vite) in parallel
```

Local URLs:

| Service | URL |
|---|---|
| Web UI (Vite dev server) | http://localhost:5173 |
| Backend API | http://localhost:3000 |

The Vite dev server proxies `/api` and `/rest` to the backend.

## Scripts

Root `package.json` scripts (run with `pnpm <script>`):

| Script | What it does |
|---|---|
| `dev` | Runs all packages' `dev` scripts in parallel (server with `tsx watch`, web with Vite) |
| `build` | Builds all packages: `shared` → `server` (tsc + copy migrations) → `web` (tsc + vite build) |
| `test` | Runs all package test suites (Vitest), no-bail |
| `lint` | Currently a no-op — linting is not configured |

Package-level scripts worth knowing:

- `packages/server`: `trigger-scan` — queues a full library scan from the CLI (useful inside a dev container).
- `packages/web`: `scripts/generate-mdi-sprite.js` regenerates the MDI icon sprite at build time when icons are added to the build command.

## Docker-based development

For active development, use the dev compose file — it bind-mounts the package sources and runs `pnpm -r --parallel dev` inside the container, so TypeScript/React changes hot-reload:

```bash
cp .env.example .env
cp docker/compose.dev.yaml.example compose.dev.yaml
# edit .env and set SESSION_SECRET
docker compose -f compose.dev.yaml up -d --build
```

Exposed ports:

| Host port (env var, default) | Maps to | Purpose |
|---|---|---|
| `SONARLY_DEV_WEB_PORT` (4534) | 5173 | Vite dev server — use this for normal work; it proxies `/api` and `/rest` |
| `SONARLY_DEV_API_PORT` (3001) | 3000 | Fastify backend directly |

### Restart vs recreate vs rebuild

These are not interchangeable:

| Change | Action |
|---|---|
| TypeScript/React source in `packages/*/src/` | Nothing — `tsx watch` and Vite HMR pick it up |
| Environment variables in `.env` | `docker compose -f compose.dev.yaml up -d` (recreates the container) |
| `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, new dependencies | `docker compose -f compose.dev.yaml up -d --build` |
| `docker/Dockerfile.dev`, `docker/entrypoint.sh`, runtime tooling | `docker compose -f compose.dev.yaml up -d --build` |
| Database reset | `docker compose -f compose.dev.yaml down`, then delete `./config/sonarly/data/sonarly.db` |

After adding a dependency with `pnpm add`, rebuild with `--build`; running `pnpm install` inside the running container only lasts until the next recreate.

Trigger a scan from the host without opening the UI:

```bash
docker exec sonarly-dev sh -c "cd /app/packages/server && pnpm trigger-scan"
```

## Testing

Tests use Vitest and live in `packages/server/tests/` (mirroring `src/`) and `packages/web` test locations. Run everything:

```bash
pnpm test
```

Server tests spin up real SQLite databases via `better-sqlite3` and exercise routes and the smart-playlist compiler end to end. When you change SQL or schema, run the server suite at minimum; the full suite is the pre-merge bar.

## Making changes

### Conventions

- Code is **feature-first**: domains live under `src/features/<name>/` with a public `index.ts` barrel; cross-feature imports go through barrels.
- Workspace packages import each other as `@sonarly/shared`.
- Shared types/contracts go in `packages/shared/src/` so server and web stay in sync at compile time.
- Server configuration is validated with Zod in `packages/server/src/config.ts`.
- UI conventions and the reusable component inventory are documented in the [agents/](../agents/) folder (see `agents/ui-components.md`, `agents/development-conventions.md`).

### Adding a database migration

1. Create the next numbered file in `packages/server/src/db/migrations/` (e.g. `049_something.sql`). Plain SQL runs via `db.exec`; `.js`/`.cjs` files export an `up(db)` function for data migrations.
2. Migrations run in filename order on server start; applied filenames are tracked in the `migrations` table, so never edit an already-shipped migration.
3. Rebuild the server (`pnpm build`) so `scripts/copy-migrations.js` copies the new file into the build output — the dev/prod images run migrations from the compiled output.
4. Update [db-schema.md](db-schema.md) if the schema reference changes.

### Renaming a persisted field (case study: `albumType` → `releaseType`)

A field name can live in several places at once — TypeScript types, API payloads, SQL columns, and JSON stored in the database. The `releaseType` rename touched: `packages/shared/src/album.ts` + `smart-playlist.ts`, the albums repository/routes, scanner, tag reader, suggestions, the smart-playlist compiler, the web edit modal/album page/rule editor, plus migration `049_rename_album_type.sql`, which renames the `albums.album_type` column **and** rewrites stored smart-playlist rules JSON (`"field":"albumType"` → `"field":"releaseType"`). If you rename anything persisted as JSON, ship a data migration like that one.

## Where things are documented

- Docs index: [README.md](README.md) (this folder)
- Architecture and data flow: [architecture.md](architecture.md)
- API reference: [api.md](api.md)
- Database schema: [db-schema.md](db-schema.md)
- Smart playlists: [smart-playlists.md](smart-playlists.md)
- Deployment (Docker): [deployment.md](deployment.md)
- Agent-oriented guidance: [AGENTS.md](../AGENTS.md) and [agents/](../agents/)
