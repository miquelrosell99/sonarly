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

Local full-stack dev: run the Go server from `server/` (`go run ./cmd/sonarly` with `SESSION_SECRET`, `SONARLY_LIBRARY_PATH`, …) and `pnpm dev` from `web/` — the Vite dev server proxies `/api` and `/rest` to `localhost:3000`. See docs/development.md.

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

## Concurrent sessions (owner 2026-10-08)

More than one agent (or human) session may be working in this repo — and against the same dev environment — at the same time. Assume it. (Mirrors the fleet-wide rules developed in the Notees repo, 2026-10-08.)

**Worktrees live in `.worktrees/`** (gitignored): concurrent sessions on unrelated tasks each default to their own `git worktree add .worktrees/<slug> -b <slug> main` — own branch, own `pnpm install` (the shared store makes it cheap), own gate runs (`pnpm -r build && pnpm test` + `cd server && go build ./... && go vet ./... && go test ./... -count=1`) — so one session's half-done edits can't break another's tests. The main checkout is where slices land, not where concurrent development happens. Never a random sibling folder. A solo session or a trivial docs-only slice may stay in the main checkout and commit promptly. Dev servers are NOT isolated by worktrees: each session takes distinct ports (server :3000, Vite :5173 — Vite auto-increments; note which a session uses).

**Landing + cleanup**: slices land one at a time in the main checkout — fetch, rebase the session branch onto the freshest main, fast-forward merge, push. If main moved between your rebase and your merge — or `.git/index.lock` is present — another landing is in flight: wait, re-fetch, redo the rebase. Land promptly after the gate is green; frequent small merges keep divergence small. When the slice has landed, clean up: `git worktree remove .worktrees/<slug>` + `git branch -d <slug>` (the safe delete only succeeds once the slice is fully merged), so `git worktree list` stays truthful.

**Shared record files**: `CHANGELOG.md` (entries prepend under `## [Unreleased]`, Keep a Changelog — never renumber or reorder existing entries), `docs/`, `agents/`, `AGENTS.md`, and the API contract (`server/api/openapi.yaml` + the regenerated `web/src/contract/schema.ts`) are touched by nearly every slice, so they conflict at merge time by construction. Rules: keep the edit minimal and anchored; resolve a conflict there by keeping BOTH blocks — never drop another slice's entry.

**Detect before writing, and again before any shared-state operation**: `git status --porcelain` (files you did not make are another session's in-flight work) + `git log --oneline -5` (unfamiliar recent commits) at session start; `git worktree list` (parallel work lives in `.worktrees/<slug>/`; a stale entry from a crashed session gets pruned once confirmed dead — `git worktree remove --force` + `git branch -D` — never against a live, unfamiliar sibling); a present `.git/index.lock` (wait for it, never delete it reflexively); already-bound dev ports; `docker compose -f compose.yaml ps` for the live stack.

**Handle**: keep writes inside your task's files; stage per-file (`git add <path>`), never `git add -A` / `git commit -a`; never revert, delete, reformat, or "tidy" files you didn't create; red tests or vet errors in files you didn't touch are presumed to be another session's in-progress work — report them, don't fix them; if a file changes under you, re-read it and integrate, don't overwrite; avoid stack-wide actions (image rebuilds, DB resets) without checking who else is using the environment; snapshot-commit your own verified stable states early — uncommitted work is one rebase away from gone.

Base discipline: the `agent-repo-workflow` user skill (concurrent agents, snapshot commits, verify before finishing).
