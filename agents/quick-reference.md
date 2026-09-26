## Agent Quick Reference

- **Technology:** Go 1.23 server (chi + modernc.org/sqlite) + React 18/Vite web client; SQLite database; single all-in-one Docker image
- **Key directories:**
  - `v2/` — Go server (the only server): `cmd/sonarly`, `internal/modules/*`, `api/openapi.yaml`
  - `packages/web/` — React SPA management UI (`src/features`, `src/components`, `src/contract`, `src/types`)
  - `docker/` — Dockerfile.v2, entrypoint.sh, compose.v2.yaml.example
  - `docs/` — project documentation (index: `docs/README.md`)
- **Test commands:** `cd v2 && go test ./... -count=1` (server), `pnpm test` (web)
- **Build commands:** `pnpm -r build` (web), `go build ./...` in `v2/` (server)
- **Database:** SQLite via `modernc.org/sqlite`, migrations in `v2/internal/db/migrations/` (ledger: `schema_migrations`)
