## Development Conventions

> Generic React patterns — see `react-ui-patterns`.
> Generic security practices — see `security-hardening`.
> Generic self-hosting/deployment patterns — see `selfhost-release`.

### Go server (`server/`)

- **Modular monolith**: one package per domain under `server/internal/modules/<name>/` with a small exported surface. Cross-module imports go through the owning module, never its internal files.
- SQL is always parameterized; repositories live in the owning module.
- Server configuration is env-based, loaded and validated once in `internal/config` at boot (fail fast on invalid config).
- Migrations are numbered SQL files in `server/internal/db/migrations/`, one transaction each, ledger-tracked in `schema_migrations`. Never edit a shipped migration — fix forward.
- The native API contract is `server/api/openapi.yaml`; a chi.Walk coverage test fails the build on spec drift, and `server/internal/contractcheck/` fails it when a response schema drops a field the client consumes. Changing a route means changing the spec, then regenerating the web types (`pnpm --filter @sonarly/web contract:gen`).
- **API shape paradigm — server-native on both sides.** The server defines the wire shapes; the client conforms. New or changed endpoints are designed to fit the server's existing conventions (sibling endpoints in the same module: envelopes, the `{error}` contract, 404-not-403, scope checks, transactional writes) — never copied from the retired TypeScript codebase for parity's sake. The retired implementation is a semantics reference only (what an operation does, who may call it, what cascades). When a shape changes, update the client call sites in the same change.
- Go tests live next to the source (`*_test.go`); `go test ./... -count=1` is the bar.

### Web client (`web/`)

- Code is organized **feature-first**: each domain lives under `src/features/<name>/`; cross-feature imports go through the feature's public entry points, never deep internal files.
- Shared UI primitives live in `web/src/components/` (and `components/ui/`); the app shell is `components/Layout.tsx`.
- Domain/entity types live in `web/src/types/` (migrated from the retired `@sonarly/shared` package); generated API types live in `src/contract/schema.ts` (types-only — runtime HTTP goes through `src/lib/api.ts`, the canonical client).
- Web tests live next to source (`*.test.ts(x)`); page tests render through `web/src/lib/testing.tsx`.

## Server state (react-query)

All server state flows through @tanstack/react-query — no page holds fetched data in `useState`. The hand-rolled `useFetch`/`cacheEpoch` bridge was removed (FF1, 2026-09-26); the SSE handler now only invalidates query prefixes.

- **List hooks** live in `web/src/hooks/useLibraryLists.ts`: `useLibraries`, `useSongsList`, `useAlbumsList`, `useArtistsList`, `useGenresList`, `useYearsList`, `useSearchPreview`, `useSearchResults`. Pages never call `api()` for library lists directly.
- **Key families** — one per domain, so pages share caches and SSE invalidation stays prefix-based:
  - `['songs', 'list', { libraryId?, genre?, composer?, label? }]` → `GET /songs`
  - `['albums', 'list', { … }]` → `GET /albums`
  - `['artists' | 'genres' | 'years', 'list', { libraryId? }]` → `GET /artists|/genres|/years`
  - `['search', 'preview', { q, libraryId }]` → `GET /search?q=…&limit=5` (SearchBox dropdown) and `['search', 'results', { q, type, libraryId }]` → `GET /search?q=…&type=…` (/search page; a matching preview entry seeds it as initialData so Enter never re-downloads the preview)
  - `['songs' | 'albums' | 'artists', 'detail', id, libraryId]` → `GET /songs|/albums|/artists/:id` (entity detail pages and the now-playing overlay's context resolution, via `useEntityDetails.ts`; album/artist details embed their songs — consume them, never fetch `/songs` in parallel)
  - `['playlists']` → `GET /playlists` (`usePlaylists`) and `['playlist', id, shareToken]` → `GET /playlists/:id` (`usePlaylist`, shareToken in the key for guest cache hygiene)
  - `['libraries']` → `GET /libraries` (`useLibraries`) — the sidebar/TopBar selector list. Admin CRUD (`AdminLibraries`) invalidates this exact key after a successful write so the selector updates without a reload; `libraryStore` (zustand persist) keeps **only** the selected `libraryId` — client state, never the list
  - Only **server-relevant** params enter the key; client-side-only filters (e.g. the Tracks page's artist/album/favorites filters, the Year page's year) stay derived state in the page. Filter consumers (TopBar) read the same families as the pages — never define a second key for the same endpoint.
- **Defaults**: `staleTime` 30s on lists, `placeholderData: keepPreviousData` — filter/scope changes swap the key and keep the previous list visible until the new one lands (no spinner flash). Initial loads still show the `LibraryView`/`PageState` loading state.
- **Edits**: favorite/rate actions patch the cached item in place via the hooks' `patchItem` (lists) / `patchDetail` (details); structural edits (tag saves, deletes, cover art, uploads completing) go through `useLibraryMutation` (`web/src/hooks/useLibraryMutation.ts`) or its exported `invalidateLibraryEntity` helper, which apply one shared invalidation map in `onSettled` — `song → songs/search/albums/artists`, `album → albums/search`, `artist → artists/search`, `playlist → playlists/playlist` — and surface errors via `notify(err.message, 'error')`. Extend the map rather than hand-picking prefixes at new call sites (the playlist favorite/rate call sites predate the map and invalidate `['playlists']` + `['playlist', id]` directly — favorites are per-user junction rows any signed-in user may set, per the server's interactions module).
- **SSE contract**: `useServerEvents` invalidates `songs`, `albums`, `artists`, `genres`, `years`, `playlists`, `playlist`, `search`, `lyrics` on `library:changed` AND on EventSource reconnect — the server buffers nothing, so reconnect-refetch is the designed recovery for lost notifications. New key families must start with one of these prefixes or extend the list. The `['libraries']` family is the exception: it is refreshed through the `sonarly:library-changed` DOM bridge instead — `useLibraries` (its only consumer family) installs that listener itself and invalidates its exact key, so SSE events, reconnects, and admin CRUD all reach the selector through one path.
- **Auth switches**: `queryClient.clear()` runs on `sonarly:unauthorized` and on login success — per-user data (starred flags, ratings, preferences) must never bleed across accounts on a shared browser profile.
- Page tests render through `web/src/lib/testing.tsx` (`renderWithQueryClient`, retries off, fresh client per render).

## Navigation & scroll (web/)

- **Scroll restoration** lives in `web/src/hooks/useScrollRestoration.ts`, wired once in `Layout` on the `<main>` scroll container. It remembers the offset per route and restores it on popstate-direction navigations; pushes reset to the top; replaces leave the offset alone. Direction comes from the History API surface (`popstate` / wouter's patched-`history` `pushState`/`replaceState` window events), never from wouter params. New scroll containers must not reimplement this.
- **The now-playing overlay is the one push that restores**: `PlayerBar` (open) and `NowPlayingRoute` (close → returnPath) set the store's one-shot `suppressNextReset` flag so the underlying page gets its scroll position back. Consume-and-reset semantics — never read the flag without clearing it.
- **Underlay pages** (Playlist/Album/Genre/Composer/Label details mounted under `/now-playing/:context/:contextId/:songId`) receive their entity id through the optional `underlay: UnderlayParams` prop — wouter params don't reach them there. `fetchEnabled: false` means the player store covers the URL: the page must not fetch (zero-request refresh) and renders its loading state instead of a not-found; guests always fetch. Detail hooks accept an `enabled` argument for this.
