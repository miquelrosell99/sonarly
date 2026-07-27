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
