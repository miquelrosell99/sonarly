# Development

This guide covers setting up a development environment, the available commands, testing, and how to make common kinds of changes.

## Prerequisites

- Go 1.23 (`go version`; the binary is not in PATH on some hosts — e.g. `/usr/local/go/bin/go`)
- Node.js 22 + pnpm 9 (the repo pins `packageManager: pnpm@9.0.0`)
- `ffmpeg` — transcoding/waveform features
- Python 3 + Mutagen (`pip3 install mutagen`) — used by the tag writer

## Setup

The repository has two parts: the Go server (`v2/`) and the React web client (`packages/web/`). For full-stack work run both: the server on port 3000 and the Vite dev server on 5173 (which proxies `/api` and `/rest` to the server).

```bash
pnpm install

# Terminal 1 — Go server
cd v2
SESSION_SECRET=$(openssl rand -hex 32) \
SONARLY_LIBRARY_PATH=/path/to/music \
SONARLY_INGEST_PATH=/path/to/ingest \
go run ./cmd/sonarly

# Terminal 2 — web client (proxies /api + /rest to localhost:3000)
cd packages/web
pnpm dev
```

Local URLs:

| Service | URL |
|---|---|
| Web UI (Vite dev server) | http://localhost:5173 |
| Server API | http://localhost:3000 |

Point `SONARLY_WEB_DIST` at a web build (`pnpm -r build` produces `packages/web/dist`) to have the Go server serve the UI itself — the production-shaped setup.

## Commands

Server (run from `v2/`):

| Command | What it does |
|---|---|
| `go build ./...` | Compile all packages |
| `go vet ./...` | Static analysis |
| `go test ./... -count=1` | Full Go test suite |
| `go run ./cmd/sonarly` | Run the server (env config required) |
| `go build -ldflags "-X github.com/miquelrosell99/sonarly/v2/internal/buildinfo.Version=$(git -C .. describe --tags --always)" -o sonarly ./cmd/sonarly` | Release build with version injection (surfaced as the OpenSubsonic `serverVersion`) |

Web (run from the repo root or `packages/web/`):

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies |
| `pnpm dev` | Vite dev server |
| `pnpm -r build` | Type-check and build the web client |
| `pnpm test` | Vitest suite |
| `pnpm --filter @sonarly/web contract:gen` | Regenerate `src/contract/schema.ts` from `v2/api/openapi.yaml` |

## Testing

### Go

```bash
cd v2 && go test ./... -count=1
```

Two suites have special harnesses:

- **testparity** (`v2/testparity/`) — the v1↔v2 request-level parity harness. It boots the *removed* TypeScript server as its baseline, so it **skips cleanly** unless `P10_V1_CHECKOUT` points at a pre-removal checkout (e.g. a git worktree of the last v1 commit). Kept as evidence and for regression archaeology.
- **testdualrun** (`v2/testdualrun/`) — the production dual-run harness. It seeds a library, snapshots a database, boots the v2 binary, and diffs scan/stream/state behavior. It reads paths under the deployment host layout; run it only in an environment where those exist.

### Web

Tests use Vitest and live next to the source. Run everything:

```bash
pnpm test
```

## Making changes

### Conventions

- Server code is a Go **modular monolith**: one package per domain under `v2/internal/modules/<name>/`, with small exported surfaces. Cross-module imports go through the owning module, never its internal files.
- Web code is **feature-first**: domains live under `packages/web/src/features/<name>/`; shared primitives under `packages/web/src/components/`. Server-state types live in `packages/web/src/types/` (migrated from the retired `@sonarly/shared` package).
- The native API contract is `v2/api/openapi.yaml`; it is coverage-tested against the Go router in both directions. Changing a route means changing the spec, then regenerating the web types (`pnpm --filter @sonarly/web contract:gen`).
- UI conventions and the reusable component inventory are documented in the [agents/](../agents/) folder (see `agents/ui-components.md`, `agents/development-conventions.md`).

### Adding a database migration

1. Create the next numbered file in `v2/internal/db/migrations/` (e.g. `0005_something.sql`). Migrations are plain SQL, executed in filename order inside a per-file transaction.
2. Applied filenames are recorded in the `schema_migrations` ledger table; **never edit an already-shipped migration** — fix forward.
3. The files are embedded into the binary; a rebuild picks them up automatically (no copy step).
4. Update [db-schema.md](db-schema.md) if the schema reference changes.

### Changing the native API

1. Implement the handler in the owning `v2/internal/modules/<domain>/` package and mount it in `v2/internal/httpserver/`.
2. Document the route in `v2/api/openapi.yaml` — the coverage test fails the build on spec drift in either direction.
3. Regenerate the web contract: `pnpm --filter @sonarly/web contract:gen`.
4. If the OpenSubsonic surface changed, check the decisions in [v2-opensubsonic-quirks.md](v2-opensubsonic-quirks.md).

### OpenSubsonic adapter changes

The adapter preserves v1-observed client behavior by design. Read [v2-opensubsonic-quirks.md](v2-opensubsonic-quirks.md) before changing anything under `v2/internal/modules/opensubsonic/` — many seemingly-buggy behaviors are load-bearing for real clients.

## Where things are documented

- Docs index: [README.md](README.md) (this folder)
- Architecture and data flow: [architecture.md](architecture.md)
- API reference: [api.md](api.md)
- Database schema: [db-schema.md](db-schema.md)
- Smart playlists: [smart-playlists.md](smart-playlists.md)
- Deployment (Docker): [deployment.md](deployment.md)
- Agent-oriented guidance: [AGENTS.md](../AGENTS.md) and [agents/](../agents/)
