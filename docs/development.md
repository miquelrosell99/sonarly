# Development

How to set up a working environment, run the tests, and make common kinds of changes (migrations, API contract, OpenSubsonic behavior). See [architecture.md](architecture.md) for how the code is organized.

## Prerequisites

- Go 1.23 (`go version`; on some hosts the binary is at `/usr/local/go/bin/go`)
- Node.js 22 + pnpm 9 (the repo pins `packageManager: pnpm@9.0.0`)
- `ffmpeg` — transcoding
- Python 3 + Mutagen (`pip3 install mutagen`) — the tag writer shells out to it
- Docker (optional, for image work)

## Setup

The repository has two parts: the Go server (`server/`) and the React web client (`web/`). For full-stack work run both — the server on port 3000 and the Vite dev server on 5173, which proxies `/api` and `/rest` to the server:

```bash
pnpm install

# Terminal 1 — Go server
cd server
SESSION_SECRET=$(openssl rand -hex 32) \
SONARLY_LIBRARY_PATH=/path/to/music \
SONARLY_INGEST_PATH=/path/to/ingest \
go run ./cmd/sonarly

# Terminal 2 — web client
cd web
pnpm dev
```

| Service | URL |
|---|---|
| Web UI (Vite dev server) | http://localhost:5173 |
| Server API | http://localhost:3000 |

Point `SONARLY_WEB_DIST` at a web build (`pnpm -r build` produces `web/dist`) to have the Go server serve the UI itself — the production-shaped setup.

## Commands

Server (from `server/`):

| Command | What it does |
|---|---|
| `go build ./...` | Compile all packages |
| `go vet ./...` | Static analysis |
| `go test ./... -count=1` | Full Go test suite |
| `go run ./cmd/sonarly` | Run the server (env config required) |
| `go build -ldflags "-X github.com/miquelrosell99/sonarly/server/internal/buildinfo.Version=$(git -C .. describe --tags --always)" -o sonarly ./cmd/sonarly` | Release build with version injection (surfaced as the OpenSubsonic `serverVersion`) |

Web (from the repo root or `web/`):

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies |
| `pnpm dev` | Vite dev server |
| `pnpm -r build` | Type-check and build the web client |
| `pnpm test` | Vitest suite |
| `pnpm --filter @sonarly/web contract:gen` | Regenerate `web/src/contract/schema.ts` from `server/api/openapi.yaml` |

Repo-wide: `pnpm -r --parallel dev` runs server-adjacent tooling and web together where applicable; `pnpm build` / `pnpm test` at the root build/test all workspaces.

## Tests

**Go** — `cd server && go test ./... -count=1`. Tests live next to the source (`*_test.go`) and use established harnesses: httptest servers against the chi router, file-backed SQLite via the db package helpers, temp dirs for library fixtures. Reuse each module's `helpers_test.go` / `TestMain` scaffolding. `go vet ./...` is part of the pre-merge bar.

**Web** — Vitest, colocated (`*.test.ts(x)`); page tests render through `lib/testing.tsx`. `pnpm test` runs everything.

The request-parity and dual-run harnesses existed only during the 2026-09 server cutover and were removed with the retired TypeScript server; their final reports are preserved as internal records under [`.audits/`](../.audits/README.md).

## Conventions

- The server is a Go **modular monolith**: one package per domain under `server/internal/modules/<name>/`, with small exported surfaces. Cross-module imports go through the owning module, never its internal files.
- The web client is **feature-first**: pages and components live under `web/src/features/<name>/`; shared primitives under `web/src/components/` (+ `components/ui/`). Domain types live in `web/src/types/`.
- UI conventions and the reusable component inventory: [agents/ui-components.md](../agents/ui-components.md), [agents/development-conventions.md](../agents/development-conventions.md).

## Making changes

### Adding a database migration

1. Create the next numbered file in `server/internal/db/migrations/` (e.g. `0005_something.sql`). Migrations are plain SQL, executed in filename order, one transaction per file.
2. Applied filenames are recorded in the `schema_migrations` ledger table; **never edit an already-shipped migration** — fix forward.
3. The files are embedded into the binary; a rebuild picks them up automatically.
4. Update [db-schema.md](db-schema.md) if the schema reference changes.

### Changing the native API

1. Implement the handler in the owning `server/internal/modules/<domain>/` package and mount it in `server/internal/httpserver/`.
2. Document the route in `server/api/openapi.yaml` — `server/cmd/sonarly/spec_test.go` walks the chi router and fails the build on spec drift in either direction.
3. Regenerate the web contract: `pnpm --filter @sonarly/web contract:gen`.
4. Preview/lint the spec: `npx @redocly/cli lint server/api/openapi.yaml` (see [api.md](api.md)).

### OpenSubsonic adapter changes

The adapter preserves observed client behavior from the production system by design. Read [`.audits/opensubsonic-quirks.md`](../.audits/opensubsonic-quirks.md) (internal engineering record) before changing anything under `server/internal/modules/opensubsonic/` — many seemingly-buggy behaviors are load-bearing for real clients. Errors are enveloped with HTTP 200; code 70 = data not found / out of scope.

## Where things are documented

- Docs index: [README.md](README.md) (this folder)
- Architecture and data flow: [architecture.md](architecture.md)
- API reference: [api.md](api.md)
- Database schema: [db-schema.md](db-schema.md)
- Smart playlists: [smart-playlists.md](smart-playlists.md)
- Deployment: [deployment.md](deployment.md)
- Agent-oriented guidance: [AGENTS.md](../AGENTS.md) and [agents/](../agents/)
