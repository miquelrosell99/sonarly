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
