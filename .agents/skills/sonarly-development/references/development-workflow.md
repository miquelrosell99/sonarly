# Development workflow

Canonical: `agents/build-commands.md` + `agents/quick-reference.md`.
Toolchain: Node 22 + pnpm **9.0.0** (pinned, corepack), Go 1.23.

## Commands (verbatim)

```sh
pnpm install                  # web deps
pnpm test                     # Vitest
pnpm -r build                 # tsc + vite build + bundle budget (last step)
cd server && go build ./...   # compile
go vet ./...                  # static analysis
go test ./... -count=1        # full Go suite
go run ./cmd/sonarly          # run server (env required)
pnpm --filter @sonarly/web contract:gen          # regen web/src/contract/schema.ts
npx @redocly/cli lint openapi.yaml               # spec lint (config server/api/redocly.yaml)
```

Full-stack dev: server on :3000
(`SESSION_SECRET=$(openssl rand -hex 32) SONARLY_LIBRARY_PATH=… go run ./cmd/sonarly`),
Vite on :5173 proxying `/api` + `/rest` → :3000.

CI (`.github/workflows/ci.yml`): pnpm install `--frozen-lockfile` →
`pnpm -r build` → `pnpm test` → regenerate the contract schema and `diff`
against the committed `schema.ts` (drift fails).

## CI-equivalent gate (run before claiming done)

```sh
pnpm install && pnpm -r build && pnpm test
cd server && go build ./... && go vet ./... && go test ./... -count=1
```

## Release flow (user-facing changes)

1. Add the change under `## [Unreleased]` in `CHANGELOG.md` (re-add the
   heading if the last release consumed it — Keep a Changelog 1.1.0 + SemVer).
2. To cut the release: rename `## [Unreleased]` → `## [X.Y.Z] - <date>`,
   repoint the bottom compare link, commit `chore(release): vX.Y.Z`.
3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z` — the
   `release-docker.yml` workflow publishes `ghcr.io/miquelrosell99/sonarly`
   at `:vX.Y.Z`, `:X.Y.Z`, `:X.Y` and `:latest` (build-arg
   `SONARLY_VERSION=${{ github.ref_name }}`).
4. Redeploy the live stack: bump the pinned tag in the gitignored root
   `compose.yaml`, `docker compose -f compose.yaml pull && docker compose -f compose.yaml up -d`,
   confirm healthy.

## Standing rules

- Ship workflow (AGENTS.md): never leave complete verified work uncommitted;
  commit → push `main`; hold back only when told not to ship or the action is
  hard to undo.
- Same-pass doc updates: `CHANGELOG.md` (user-facing), `docs/*` (the page the
  change affects), `agents/*` (the reference the change affects), and this
  skill's references.
- Never re-tag; a broken release is fixed by the next patch version.

## Concurrent sessions (owner 2026-10-08; canonical: `agents/build-commands.md`)

More than one agent (or human) session may work in this repo — and against
the same dev environment — concurrently. Assume it by default.

- **Worktrees live in `.worktrees/`** (gitignored): `git worktree add
  .worktrees/<slug> -b <slug> main`. Concurrent sessions on unrelated tasks
  each default to their own worktree — own branch, own `pnpm install`
  (shared store makes it cheap), own gate runs (`pnpm -r build && pnpm test`
  + the Go suites) — so one session's half-done slice cannot break another's
  tests; the main checkout is where slices land, not where concurrent
  development happens. Dev servers are NOT isolated: each session takes
  distinct ports (server :3000, Vite :5173 — Vite auto-increments). A solo
  session or a trivial docs-only slice may stay in the main checkout. Never
  a random sibling folder.
- **Landing + cleanup**: slices land one at a time in the main checkout —
  fetch, rebase the session branch onto the freshest main, fast-forward
  merge, push; if main moved or `.git/index.lock` is present another landing
  is in flight — wait, re-fetch, redo the rebase. Then clean up: `git
  worktree remove .worktrees/<slug>` + `git branch -d <slug>` (the safe
  delete only succeeds once the slice is fully merged).
- **Shared record files**: `CHANGELOG.md` (entries prepend under
  `## [Unreleased]`, Keep a Changelog — never reorder existing entries),
  `docs/`, `agents/`, `AGENTS.md`, and the API contract
  (`server/api/openapi.yaml` + the regenerated `web/src/contract/schema.ts`)
  are touched by nearly every slice and conflict at merge time by
  construction — keep edits minimal and anchored; resolve conflicts by
  keeping both blocks, never dropping another slice's entry.
- **Parallel sessions**: detect before writing — `git status --porcelain` +
  `git log --oneline -5` at session start, `git worktree list` (a stale
  entry from a crashed session gets pruned once confirmed dead — never a
  live sibling), a present `.git/index.lock`, already-bound dev ports,
  `docker compose -f compose.yaml ps` for the live stack. Handle: per-file
  staging only (never `git add -A` / `git commit -a`); red tests in files
  you didn't touch are another session's in-flight work (report, don't
  fix); avoid stack-wide actions without checking; re-read files that change
  under you; snapshot-commit your own verified states early — uncommitted
  work is one rebase away from gone. Base discipline: the
  `agent-repo-workflow` user skill.
