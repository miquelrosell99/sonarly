## Development Conventions

> Generic React patterns — see `react-ui-patterns`.
> Generic security practices — see `security-hardening`.
> Generic self-hosting/deployment patterns — see `selfhost-release`.

### Go server (`v2/`)

- **Modular monolith**: one package per domain under `v2/internal/modules/<name>/` with a small exported surface. Cross-module imports go through the owning module, never its internal files.
- SQL is always parameterized; repositories live in the owning module.
- Server configuration is env-based, loaded and validated once in `internal/config` at boot (fail fast on invalid config).
- Migrations are numbered SQL files in `v2/internal/db/migrations/`, one transaction each, ledger-tracked in `schema_migrations`. Never edit a shipped migration — fix forward.
- The native API contract is `v2/api/openapi.yaml`; a chi.Walk coverage test fails the build on spec drift. Changing a route means changing the spec, then regenerating the web types (`pnpm --filter @sonarly/web contract:gen`).
- Go tests live next to the source (`*_test.go`); `go test ./... -count=1` is the bar.

### Web client (`packages/web/`)

- Code is organized **feature-first**: each domain lives under `src/features/<name>/`; cross-feature imports go through the feature's public entry points, never deep internal files.
- Shared UI primitives live in `packages/web/src/components/` (and `components/ui/`); the app shell is `components/Layout.tsx`.
- Domain/entity types live in `packages/web/src/types/` (migrated from the retired `@sonarly/shared` package); the generated API contract lives in `src/contract/`.
- Web tests live next to source (`*.test.ts(x)`); page tests render through `packages/web/src/lib/testing.tsx`.

## Server state (react-query)

All server state flows through @tanstack/react-query — no page holds fetched data in `useState`. The hand-rolled `useFetch`/`cacheEpoch` bridge was removed (FF1, 2026-09-26); the SSE handler now only invalidates query prefixes.

- **List hooks** live in `packages/web/src/hooks/useLibraryLists.ts`: `useSongsList`, `useAlbumsList`, `useArtistsList`, `useGenresList`, `useYearsList`, `useSearchResults`. Pages never call `api()` for library lists directly.
- **Key families** — one per domain, so pages share caches and SSE invalidation stays prefix-based:
  - `['songs', 'list', { libraryId?, genre?, composer?, label? }]` → `GET /songs`
  - `['albums', 'list', { … }]` → `GET /albums`
  - `['artists' | 'genres' | 'years', 'list', { libraryId? }]` → `GET /artists|/genres|/years`
  - `['search', 'results', { q, type, libraryId }]` → `GET /search` (the SearchBox top-5 preview uses `['search', query, libraryId]` — same prefix)
  - Only **server-relevant** params enter the key; client-side-only filters (e.g. the Tracks page's artist/album/favorites filters, the Year page's year) stay derived state in the page.
- **Defaults**: `staleTime` 30s on lists, `placeholderData: keepPreviousData` — filter/scope changes swap the key and keep the previous list visible until the new one lands (no spinner flash). Initial loads still show the `LibraryView`/`PageState` loading state.
- **Edits**: favorite/rate actions patch the cached item in place via the hooks' `patchItem`; structural edits (tag saves, deletes, cover art, uploads completing) invalidate the domain prefix (`['songs']`, `['albums']`, …) instead of refetching ad hoc.
- **SSE contract**: `useServerEvents` invalidates `songs`, `albums`, `artists`, `genres`, `years`, `playlists`, `playlist`, `search` on `library:changed` — new key families must start with one of these prefixes or extend the list.
- Page tests render through `packages/web/src/lib/testing.tsx` (`renderWithQueryClient`, retries off, fresh client per render).
