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
