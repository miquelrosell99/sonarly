---
name: sonarly-development
description: Develop Sonarly — a self-hosted music streaming server (Go modular monolith + React/Vite web, single all-in-one container). Use when writing or changing server or web code, the OpenAPI contract, database migrations, the job queue, or the web UI in this repo. Covers architecture, coding conventions, and the development workflow (build/test gates, contract discipline, release flow).
type: prompt
whenToUse: When implementing features or fixes in server/ or web/, changing routes/migrations/jobs, or preparing a release in the Sonarly repo
---

# Sonarly development

Sonarly is a self-hosted music streaming server: one Go process (modular
monolith) serves three surfaces — the `/rest/` OpenSubsonic adapter, the
`/api/` native management REST (contract `server/api/openapi.yaml`), and the
built React SPA — backed by a single SQLite database and a DB-backed job
queue. This skill is the working contract for changing anything in this repo.

Canonical references (kept current in the same pass as any change):
`agents/architecture.md`, `agents/development-conventions.md`,
`agents/build-commands.md`, `agents/project-structure.md`, plus the
user-facing `docs/development.md` / `docs/architecture.md`.

## Non-negotiable laws

1. **Contract discipline:** changing a route means changing
   `server/api/openapi.yaml` **and** regenerating
   `web/src/contract/schema.ts` in the same change
   (`pnpm --filter @sonarly/web contract:gen`). `spec_test.go` and CI fail on
   router↔spec drift in either direction.
2. **Migrations are fix-forward:** never edit a shipped
   `server/internal/db/migrations/NNNN_*.sql` — add the next number. They are
   embedded, one transaction each, ledgered in `schema_migrations`, and run
   automatically at container start. Update `docs/db-schema.md` in the same
   pass.
3. **The pre-merge bar is real suites, not lint:** there is no lint
   configured (root `package.json` says so) — `go test ./... -count=1` +
   `go vet ./...` (from `server/`) + `pnpm -r build` + `pnpm test` (web).
   Never claim "lint passes".
4. **The bundle budget fails the build:** entry chunk >250 KiB raw, any lazy
   chunk >350 KiB, total JS >900 KiB (`scripts/bundle-budget.mjs`, last build
   step). Watch it when adding dependencies.
5. **`/rest` changes follow QUIRKS.md**, not the OpenSubsonic spec text alone
   (`server/internal/modules/opensubsonic/QUIRKS.md` — 62 production-observed
   decisions: envelope always HTTP 200, codes 10/40/70, `f`-param format
   negotiation, auth precedence).
6. **Security shape:** native errors are JSON `{"error": "..."}` with proper
   status (missing resource = 404, never 403); SQL is parameterized
   everywhere (dynamic fragments only from fixed whitelists, LIKE escaped);
   `user_libraries` is a security boundary enforced on every content/stream
   path.
7. **Domain skills own the details** — invoke them rather than rediscovering:
   `sonarly-server-conventions` (endpoints/migrations/jobs/tests),
   `sonarly-library-operations` (scan/ingest/organize/uploads),
   `sonarly-playlists`, `sonarly-user-management`. This skill covers what
   they don't: cross-cutting architecture, conventions, and workflow.
8. **Known stale doc:** `agents/project-structure.md` still shows
   `packages/web/` — the real path is `web/` (all other docs agree). Fix
   forward in the same pass when touching it.

## Gate before declaring done

```sh
pnpm install && pnpm -r build && pnpm test     # web
cd server && go build ./... && go vet ./... && go test ./... -count=1
```

## Ship workflow (standing authorization, from AGENTS.md)

When a change is complete and verified: Conventional Commits message → push
`main` → if user-facing, changelog entry + annotated `v*` tag (CI publishes
the GHCR image) → redeploy the live stack (bump the pinned tag in the
gitignored `compose.yaml`, `pull && up -d`, confirm healthy). Don't leave
verified work uncommitted.

## Read by topic

- **Architecture** → `references/architecture.md` (canonical: `agents/architecture.md`)
- **Coding conventions** → `references/coding-conventions.md` (canonical: `agents/development-conventions.md` + `sonarly-server-conventions` skill)
- **Development workflow** → `references/development-workflow.md` (canonical: `agents/build-commands.md`)
