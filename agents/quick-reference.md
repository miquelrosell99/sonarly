## Agent Quick Reference

- **Technology:** Go 1.23 server (chi + modernc.org/sqlite) + React 18/Vite web client; SQLite database; single all-in-one Docker image
- **Key directories:**
  - `server/` — Go server (the only server): `cmd/sonarly`, `internal/modules/*`, `api/openapi.yaml`
  - `web/` — React SPA management UI (`src/features`, `src/components`, `src/contract`, `src/types`)
  - `docker/` — Dockerfile, entrypoint.sh, compose.yaml.example
  - `docs/` — project documentation (index: `docs/README.md`)
- **Test commands:** `cd server && go test ./... -count=1` (server), `pnpm test` (web)
- **Build commands:** `pnpm -r build` (web), `go build ./...` in `server/` (server)
- **Database:** SQLite via `modernc.org/sqlite`, migrations in `server/internal/db/migrations/` (ledger: `schema_migrations`)
- **Debugging a production web crash:**
  1. `docker compose -f compose.yaml logs | grep "client error report"` — the app POSTs uncaught client errors to the server; the report includes the route and the minified stack.
  2. `curl -s localhost:4534 | grep -o 'index-[^"]*\.js'` — the served entry-chunk hash is content-derived; compare against `web/dist/assets/` to identify the exact build (a matching local `pnpm -r build` reproduces the deployed bundle byte-for-byte).
  3. Reproduce against a throwaway instance with readable errors: run the `ghcr.io/.../sonarly:latest` image on a free port (see `scripts/screenshots/run.sh` for the env it needs), point a vite dev server at it (temp config overriding `server.proxy` to the throwaway port), and drive it with Playwright (`scripts/screenshots/node_modules`). Seed persisted stores (`sonarly-player` localStorage shape: `{state: {queue, queueIndex, shuffle, shuffledIndices, …}, version: 1}`) via `addInitScript` to mirror a user's browser profile.
  4. Need real catalog data? Copy the live DB with python's sqlite3 backup API into the throwaway (read-only open → `.backup`), then forge a session: insert a row into `sessions` (`sess` = `{"userId","username","isAdmin"}` JSON, ISO `expire`) and set the `sessionId` cookie to `<sid>.<base64url(HMAC-SHA256(sid, SESSION_SECRET))>` — the throwaway's own secret works, no production secret needed. Never point the throwaway's writes at the real DB directory.
- **Concurrent sessions:** other agent/human sessions may share this repo and dev environment — detect before writing (`git status --porcelain`, `git log --oneline -5`, `git worktree list`, `.git/index.lock`, bound dev ports, `docker compose -f compose.yaml ps`); concurrent development on unrelated tasks defaults to a worktree per session in `.worktrees/<slug>/` (distinct dev ports — :3000/:5173); never touch files outside your task; snapshot-commit verified states early — uncommitted work is one rebase away from gone. Full rules: `agents/build-commands.md` (Concurrent sessions).
