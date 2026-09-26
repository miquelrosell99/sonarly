## Build and Development Commands

```bash
# Web client dependencies
pnpm install

# Run tests (web client, Vitest)
pnpm test

# Build the web client (tsc + vite build + bundle budget)
pnpm -r build

# Go server (from server/)
go build ./...        # compile
go vet ./...          # static analysis
go test ./... -count=1  # full test suite
go run ./cmd/sonarly  # run the server (env config required)

# Regenerate the web contract from the OpenAPI spec
pnpm --filter @sonarly/web contract:gen

# Production Docker deployment
cp .env.example .env
# edit .env, then:
docker compose -f compose.yaml up -d

# Production image build (deploy current checkout without a release tag)
docker build -f docker/Dockerfile \
  --build-arg SONARLY_VERSION=$(git describe --tags --always) \
  -t ghcr.io/miquelrosell99/sonarly:v2.0.0-rc1 .
docker compose -f compose.yaml up -d
```

Local full-stack dev: run the Go server from `server/` (`go run ./cmd/sonarly` with `SESSION_SECRET`, `SONARLY_LIBRARY_PATH`, …) and `pnpm dev` from `packages/web/` — the Vite dev server proxies `/api` and `/rest` to `localhost:3000`. See docs/development.md.

## Determining the current deployment type

Before choosing a command after code changes, check what is currently running:

```bash
# List running Sonarly containers
docker compose -f compose.yaml ps

# Or check all running containers
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

| Running container(s) | Deployment type | Code change action |
|---|---|---|
| `compose.yaml` service(s) up | Production Docker | Rebuild the image locally, then `docker compose -f compose.yaml up -d` (see "Production redeploys and releases" below) |
| Neither | Local dev | `go run ./cmd/sonarly` + `pnpm dev` |

For production Docker, ensure `.env` exists and contains `SESSION_SECRET`. Compose reads it automatically; no inline env vars are needed. Always confirm before rebuilding or recreating a production container, since it restarts the live service.

## Database migrations (server)

1. Add the next numbered file in `server/internal/db/migrations/` (e.g. `0005_something.sql`). Plain SQL, one transaction per file.
2. Files are embedded into the binary — `go build` picks them up; there is no copy step.
3. Applied migrations are recorded in `schema_migrations`; never edit a shipped migration — fix forward.
4. Update `docs/db-schema.md` when the schema reference changes.

## Production redeploys and releases

The live `compose.yaml` runs the pre-built image `ghcr.io/miquelrosell99/sonarly` and has **no `build:` section**, so `docker compose ... --build` is a no-op there. Two supported ways to deploy new code:

**Deploy the current checkout (no release):** build the image locally and recreate the container:

```bash
docker build -f docker/Dockerfile \
  --build-arg SONARLY_VERSION=$(git describe --tags --always) \
  -t ghcr.io/miquelrosell99/sonarly:v2.0.0-rc1 .
docker compose -f compose.yaml up -d
```

**Cut a release (preferred for the fleet):** releases are published by the `Release Docker image` workflow (`.github/workflows/release-docker.yml`), which triggers on `v*` tags:

1. Update `CHANGELOG.md`: rename `## [Unreleased]` to `## [X.Y.Z] - <date>`, point the `[Unreleased]` compare link at the new tag, and add the release link.
2. Commit (`chore(release): vX.Y.Z`) and push `main`.
3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
4. Watch the workflow (`gh run list --workflow=release-docker.yml`); it publishes `:latest` plus semver tags to GHCR.
5. On the server: `docker compose -f compose.yaml pull && docker compose -f compose.yaml up -d`.

Database migrations run automatically on container start (ledger-tracked, idempotent DDL). Rollback = restore the pre-update DB backup + the previous image tag (see docs/deployment.md).
