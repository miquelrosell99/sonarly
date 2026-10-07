# Coding conventions

Canonical: `agents/development-conventions.md` (web) and the
`sonarly-server-conventions` skill (server). Fleet-wide fallbacks:
`typescript-conventions`, `python-conventions` (screenshot tooling only).

## Go (server/)

- Modular monolith, one package per domain, small exported surface;
  cross-module imports only through the owning module.
- SQL always parameterized; dynamic fragments may only interpolate fixed
  whitelists; LIKE patterns escaped (`ESCAPE '\'`).
- Env config loaded once in `internal/config`, validated at boot, fail-fast
  (e.g. `SESSION_SECRET` must be ≥32 chars).
- Migrations `NNNN_name.sql`, one transaction each, `IF NOT EXISTS`, ledger
  `schema_migrations` — **never edit a shipped migration; fix forward**.
- New tables: explicit FKs with actions, indexes for every observed query
  pattern (incl. FK cascade child columns), UNIQUE constraints instead of
  check-then-insert.
- Multi-write operations go in a transaction — `library.PersistSong` is the
  pattern (unconditional junction rewrites inside the same tx).
- Native API errors: JSON `{"error": "..."}` with proper status; bad input is
  a 4xx, never a leaked 500; missing resource = 404-not-403.

## Web (React + Vite + Tailwind)

- Feature-first structure; generated contract types win on drift.
- **react-query for all server state** — key families like
  `['songs','list',…]`; SSE invalidation contract via `/api/events`.
- **URL ↔ playback is single-writer per transition** in `NowPlayingRoute`:
  the play-start effect owns URL-target changes (reposition once per
  `context|contextId|songId`), the URL-sync effect owns playback drift
  (track end/skip → rewrite URL). Two effects re-asserting against each
  other oscillates to a "Maximum update depth exceeded" crash (v2.3.10).
- Page tests compose from `web/src/lib/testing.tsx`.
- TypeScript strict with `noUnusedLocals`/`noUnusedParameters`; Vitest
  colocated.
- UI work composes from the reusable inventory in `agents/ui-components.md`
  under the design language in `agents/design-language.md` — keep that file
  updated when the component inventory changes (AGENTS.md house rule).

## Commits

Conventional Commits, types `feat fix docs style refactor test chore`
(`CONTRIBUTING.md`). Human review is required before merging (AGENTS.md).

## Tests

- Go `*_test.go` next to source, in the owning package; reuse each module's
  `helpers_test.go` / `TestMain` scaffolding. Established integration
  patterns: httptest against the chi router, file-backed SQLite via the db
  package helpers, temp dirs for library fixtures.
- Never seed fixed calendar dates against time windows computed from `now`
  (statistics suite, v2.3.10) — seed relative to `time.Now()` and derive
  expected bucket labels from the same dates.
- Web: Vitest colocated; CI also regenerates the contract schema and diffs
  against the committed `schema.ts` — drift fails the build.
- **No lint is configured** — don't add claims of lint passing; the bar is
  `go vet` + the suites + the bundle budget.
