# Sonarly

## Agent Quick Reference

- **Technology:** TypeScript monorepo — Fastify backend, React + Vite frontend, SQLite database
- **Key directories:**
  - `packages/server/` — Fastify API server, database, scanner, ingest pipeline
  - `packages/web/` — React SPA management UI
  - `packages/shared/` — Shared TypeScript types and contracts
  - `docker/` — Dockerfile and entrypoint
  - `docs/` — Deployment and project documentation
- **Test command:** `pnpm test`
- **Lint command:** `pnpm lint` (currently a no-op; linting is not configured)
- **Database:** SQLite via `better-sqlite3`, migrations in `packages/server/src/db/migrations/`

## Technology Stack

- **Runtime:** Node.js 20
- **Package manager:** pnpm 9 (workspace monorepo)
- **Language:** TypeScript 5.5
- **Backend:** Fastify 4, `better-sqlite3`, `zod`, `music-metadata`, `chokidar`, `bcrypt`
- **Frontend:** React 18, Vite 5, Tailwind CSS 3, wouter, Zustand
- **Deployment:** Docker + Docker Compose, single container serves both API and built web UI
- **Testing:** Vitest 2

## Project Structure

```
.
├── docker/                 # Dockerfile.server, Dockerfile.dev, entrypoint.sh
├── docs/                   # deployment.md
├── packages/
│   ├── server/             # Fastify backend
│   │   ├── src/
│   │   │   ├── features/   # domain-first modules (auth, users, songs, albums, playlists, library, ingest, tags, settings, opensubsonic, ...)
│   │   │   ├── db/         # connection, migrations (cross-feature schema history)
│   │   │   ├── app.ts      # Fastify app wiring
│   │   │   ├── config.ts   # validated environment config
│   │   │   └── index.ts    # entry point
│   │   └── tests/          # unit and integration tests (mirrors src/)
│   ├── shared/             # shared TypeScript types and contracts
│   └── web/                # React management UI
│       └── src/
│           ├── features/   # domain-first pages and components
│           ├── components/ # shared UI primitives (Layout, ui/*)
│           ├── lib/        # utilities
│           └── contexts/   # shared React contexts
├── compose.yaml            # production deployment
├── compose.dev.yaml        # dev deployment with hot reload
├── .env.example            # required env vars
└── AGENTS.md               # this file
```

## Architecture

Sonarly is a self-hosted music server. A single Fastify process serves:

1. **OpenSubsonic API** (`/rest/`) — compatible with Subsonic clients.
2. **Management REST API** (`/api/`) — used by the React web UI for library management.
3. **Static web UI** (`/*`) — the built React app, served in production via `@fastify/static`.

The server runs a background worker thread for scanning and organizing audio files. File system watchers detect changes in the library and ingest folders and queue scan/ingest jobs.

### Data flow

- Audio files are read with `music-metadata`.
- Metadata is written with a Python Mutagen subprocess (via `features/tags/mutagen-writer.ts`).
- Library organization renames files into a configurable pattern (default: `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`). The file extension is always appended.
- SQLite stores songs, albums, artists, playlists, users, sessions, and scan state.

## Development Conventions

> Generic React patterns — see `react-ui-patterns`.
> Generic security practices — see `security-hardening`.
> Generic self-hosting/deployment patterns — see `selfhost-release`.

- Prefer **workspace-relative imports** between packages (`@sonarly/shared`).
- Code is organized **feature-first**: each domain lives under `src/features/<name>/` and exposes a small public API through `index.ts`.
- Server routes, repositories, and domain logic are co-located by feature under `packages/server/src/features/`.
- Web pages and domain components are co-located by feature under `packages/web/src/features/`.
- Shared UI primitives live in `packages/web/src/components/ui/`; the app shell is `components/Layout.tsx`.
- Cross-feature imports go through a feature's `index.ts` barrel, never its internal files.
- Configuration is validated with Zod in `src/config.ts`.
- Migrations are plain SQL files executed in order from `src/db/migrations/`.
- Tests live next to source in `tests/` (mirrors `src/` structure).

## Build and Development Commands

```bash
# Install dependencies
pnpm install

# Run server and web UI in parallel for local development
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Production Docker deployment
cp .env.example .env
# edit .env, then:
docker compose -f compose.yaml up -d --build

# Dev Docker deployment with hot reload
docker compose -f compose.dev.yaml up -d --build
```

Local dev runs the server with `tsx watch` and the web UI with Vite. The production Docker image builds the web UI, copies it into the server image, and serves it from `/`. The dev compose runs `pnpm -r --parallel dev` inside the container and bind-mounts the package directories so TypeScript/React changes are reflected immediately.

### Dev ports

`compose.dev.yaml` exposes:

- `SONARLY_DEV_WEB_PORT` (default `4534`) → Vite dev server (`http://localhost:4534`)
- `SONARLY_DEV_API_PORT` (default `3001`) → backend API directly (`http://localhost:3001`)

The Vite dev server proxies `/api` and `/rest` to the backend, so the web UI only needs port `4534` for normal use.

## Dev workflow: restart vs rebuild vs hot reload

Use the dev compose (`compose.dev.yaml`) for active development. Source folders are bind-mounted, so most code changes do not require a rebuild.

| Change | Action needed | Why |
|---|---|---|
| TypeScript/React source in `packages/*/src/` | Nothing (hot reload) | `tsx watch` and Vite HMR pick up changes automatically. |
| Environment variables in `.env` | `docker compose -f compose.dev.yaml up -d` | The container must be recreated to read new env vars. |
| `package.json`, `vite.config.ts`, `tsconfig.json`, or new dependencies | `docker compose -f compose.dev.yaml up -d --build` | The image must be rebuilt to install/update dependencies or copy new config. |
| `docker/Dockerfile.dev`, `docker/entrypoint.sh`, or runtime tooling | `docker compose -f compose.dev.yaml up -d --build` | The image layer changes. |
| Database reset | `docker compose -f compose.dev.yaml down` then delete `./config/sonarly/data/sonarly.db` | All non-fungible data lives under `./config/sonarly/`. |

Production (`compose.yaml`) always requires `--build` when code changes because it serves the built web UI from the image.

## User Settings & Preferences Storage

Use three separate storage layers so UI config, content interactions, and server config do not mix:

1. **Global / admin settings** — `settings` key-value table (`packages/server/src/features/settings/`).
   - Used for server-wide configuration: organize pattern, review retention days, etc.
   - Writable by admins only.
2. **Per-user UI preferences** — `user_preferences` table, one row per user (`user_id` primary key) with a JSON blob.
   - Stores sidebar order/visibility, theme mode, accent color, default view modes, column visibility, card sizes, etc.
   - Validated on write with Zod, but kept schemaless in SQLite so the UI can evolve without migrations.
3. **Per-user content interactions** — normalized relational tables.
   - `user_songs`, `user_albums`, `user_artists`, `user_playlists`.
   - Columns: `starred` (integer), `rating` (integer), `play_count` (integer), `last_played` (text).
   - These are queried for favorites, ratings, play history, and recommendations.

Front-end UI state (e.g., current modal, scroll position) belongs in Zustand or React state, not in persisted preferences.

## Security Considerations

- `SESSION_SECRET` must be at least 32 characters; the container refuses to start without it.
- Session cookies are `httpOnly`, `sameSite: 'strict'`, and `secure` is controlled by `SESSION_COOKIE_SECURE`.
- `SESSION_COOKIE_SECURE` defaults to `false` so the app works over plain HTTP in self-hosted setups. Set to `true` only behind HTTPS.
- Management API routes require a valid session except for login/logout/setup/me endpoints.
- The container drops privileges at runtime to the `PUID`/`PGID` owner of bind mounts.

## Skill References

- `react-ui-patterns` — React, Vite, Tailwind, and form patterns.
- `security-hardening` — session management, secret handling, and deployment security.
- `selfhost-release` — Docker Compose, env files, and self-hosted deployment.
- `codebase-organizer` — monorepo structure and package boundaries.
