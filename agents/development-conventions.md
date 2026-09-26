## Development Conventions

> Generic React patterns — see `react-ui-patterns`.
> Generic security practices — see `security-hardening`.
> Generic self-hosting/deployment patterns — see `selfhost-release`.

- Prefer **workspace-relative imports** between packages (`@sonarly/shared`).
- Code is organized **feature-first**: each domain lives under `src/features/<name>/` and exposes a small public API through `index.ts`.
- Server routes, repositories, and domain logic are co-located by feature under `packages/server/src/features/`.
- Web pages and domain components are co-located by feature under `packages/web/src/features/`.
- Shared UI primitives live in `packages/web/src/components/ui/`; the app shell is `components/Layout.tsx`.
- Cross-feature imports go through a feature's `index.ts` barrel, never its internal files.
- Configuration is validated with Zod in `src/config.ts`.
- Migrations are plain SQL files executed in order from `src/db/migrations/`.
- Server tests are centralized in `packages/server/tests/` (mirrors `src/` structure); web tests live next to source in `packages/web/src`.

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
