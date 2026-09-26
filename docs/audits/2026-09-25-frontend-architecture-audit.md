# Sonarly Frontend Architecture Audit

> Historical transition-era artifact: audit of the pre-rewrite TypeScript backend and the web client during the Go rewrite; version names inside refer to the pre- and post-rewrite codebases. Preserved as project history.

**Date:** 2026-09-25
**Scope:** `packages/web` (primary), `packages/shared` (contract consumption), `.worktrees/go-rewrite/v2/api/openapi.yaml` (v2 contract, read-only), `agents/*.md` (docs-drift verification). The v2 Go codebase itself was **not** audited (backend track's own scope).
**Method:** full read-only audit of `packages/web/src` (217 files, ~31.2k LOC incl. CSS), all 4 zustand stores, both contexts, all 25 hooks, the player/audio subsystem, all 40+ routes, test suite execution, dependency manifest, Vite/Tailwind/TS config, and a path-by-path diff of the client's endpoint demand against the frozen v2 OpenAPI spec (50 paths / 63 operations). No code was modified. Test suite executed: **39 files / 328 tests, all passing in 10.9 s** (verified this session).
**Status:** No code was modified for this audit. One file created (this report).

---

## 1. Executive Summary

Sonarly's web client is a **React 18 + Vite 6 + TypeScript (strict) + Tailwind 3 SPA** using **wouter** (routing), **zustand** (client state), **@tanstack/react-query 5** (server state — partially adopted), and **@dnd-kit** (reordering). It is a single-page app of ~31k LOC with 40+ routes, ~45 shared components, 16 feature domains, and 328 passing tests.

The headline conclusion, mirroring the backend audit: **this is a fundamentally healthy client with a small number of high-impact structural problems — not an architecture in crisis.** The engineering quality visible in the repo is well above average for a frontend of this size:

- **The player subsystem is excellent.** `AudioController.tsx` (347 LOC) manages a single `<audio>` element plus a hidden gapless-preload element, with correct stall detection (15 s), autoplay-block handling, Media Session integration (actions, metadata, position state), a Subsonic-style scrobble rule (`min(50 %, 4 min)` + completion-on-ended, double-submit guarded), and zero object-URL usage — there is no `createObjectURL`/`revokeObjectURL` anywhere in the codebase, so the classic media-player leak class simply does not exist. Stream URLs are plain HTTP; cleanup is `removeAttribute('src') + load()`.
- **No `dangerouslySetInnerHTML` anywhere.** Lyrics and all metadata render as React text nodes; XSS via metadata/lyrics injection is not reachable.
- **Accessibility is practiced, not aspirational:** real focus trap + focus restore in `Modal`, arrow-key menus with focus cycling in `ItemContextMenu`, a skip-to-content link, `role="status"`/`role="alert"` page states, combobox semantics in search, reduced-motion handling in toasts/lyrics/cover art, 44 px coarse-pointer touch targets on icon buttons.
- **The design system is coherent and documented** — CSS-variable tokens in `index.css` consumed through the Tailwind config, three theme modes × ten accent colors, and the signature dominant-color player tint (`useDominantColor`). `agents/design-language.md` was verified against reality and is **accurate**.
- **Testing culture is real:** 328 tests that run in under 11 s, including 30 store tests for the shuffle/repeat state machine, 22 for `LibraryView`, 23 each for `EditEntityModal` and `PlayerBar`.

The real problems are concentrated and fixable:

1. **Two coexisting data layers with different cache semantics.** React Query is used in ~10 modules (playlists, preferences, lyrics, players, search, admin libraries/users, queue-save), but the majority of pages (`Tracks`, `Albums`, `Artists`, `HomePage`, `SearchResults`, admin pages) hand-roll `useState`/`useEffect` + `api()`. The SSE handler (`useServerEvents`) invalidates React Query prefixes on `library:changed` **and** dispatches a window event — but only `HomePage` and `AdminStatus` listen to the window event. **A library scan therefore silently leaves Tracks/Albums/Artists pages showing stale data** until remount. This is the single worst correctness gap in the client.
2. **No code splitting at all.** The production build is one 646 KB JS chunk (`dist/assets/index-C6F7-N4O.js`) + one 57 KB CSS file. Every route — including admin, statistics charts, the 943-LOC `EditEntityModal`, and all fetch modals — ships to first paint. All 40+ routes are statically imported in `App.tsx`.
3. **The v2 contract does not yet cover the client's most frequent mutations.** The frozen `openapi.yaml` (63 ops) has **no** `/api/favorites`, `/api/ratings`, `/api/libraries` (non-admin), `/api/me/preferences`, lyrics read/write, tag editing, cover-art upload, `/api/suggestions`, lrclib/musicbrainz proxies, organize, or most admin surfaces — yet the client calls all of these today, and favorites/ratings fire on nearly every screen. Additionally, v2 deliberately drops `filePath`/`checksum` from song DTOs, which the client's edit modal and two admin modals display; changes the upload chunk protocol from multipart to raw `application/octet-stream`; replaces `genre` (name) filtering with `genreId`; and types `syncedLyrics` as `array | string`, which `LyricsPanel` would mishandle. **The frontend cannot migrate to the generated contract until these gaps close — several are backend-track dependencies, and they are listed explicitly in §9.**
4. **`NowPlayingRoute` rebuilds the playback queue by re-fetching the entire context** (playlist, album, genre, composer, or label — up to the server's 500-row cap, twice for genre) whenever the now-playing URL is opened directly or refreshed, and renders a full duplicate of the underlying page beneath the overlay. Deep-linked now-playing is therefore O(library section) on every refresh.
5. **Polling where the contract already provides events:** `TopBar` polls `/api/players` every 5 s unconditionally (the hook runs even when the devices dropdown is closed), and `AdminStatus` polls every 5 s — while a healthy SSE connection sits open with only two event types ever emitted.
6. **Docs drift (file updates deferred to a later pass per track instructions):** `agents/ui-components.md` inventories roughly half of the actual shared components; `agents/technology-stack.md` omits react-query and dnd-kit; the barrel-import convention in `agents/development-conventions.md` has 3 known violations, all in `App.tsx`.

The recommended path is **Option B — a unified server-state layer on the existing stack** (full React Query adoption, generated `openapi-typescript` contract module, route-level code splitting), executed as an incremental migration phased *against the v2 backend timeline* (§20): the client-side contract infrastructure (codegen, typed fetch wrapper, side-by-side mapping) can and should land **now**, before v2 ships, so the cutover is a config flip rather than a rewrite. No framework change, no SSR, no new state library is warranted.

---

## 2. Current Architecture

```text
Browser
  │
  ▼
main.tsx ── QueryClientProvider ── NotificationProvider
  │                                        (toasts, window event → notify)
  ▼
App.tsx ── boot: GET /api/setup + /api/me (raw fetch, 401-differentiated)
  │      ── wouter <Router>/<Switch>: 40+ routes, ALL statically imported
  │      ── useServerEvents(enabled when user) → EventSource /api/events
  ▼
Layout (auth shell)
  ├─ TopBar ── SearchBox (react-query, debounced) · PlayersDropdown (poll 5s)
  │           · SponsorButton · UploadModal (chunked, XHR) · UserMenu
  ├─ Sidebar ── LibrarySelector (libraryStore) · playlists (react-query)
  │            · nav
  ├─ <main> pages (features/*) ── two data idioms:
  │      A) useState/useEffect + api()  …… Tracks, Albums, Artists, Home,
  │         SearchResults, admin, settings, organize, ingest, statistics
  │      B) react-query useQuery/useMutation …… usePlaylists, usePlaylist,
  │         usePreferences, LyricsPanel, SearchBox, TopBar, AdminLibraries,
  │         AdminUsers, SharePlaylistModal, SaveQueueAsPlaylistModal
  ├─ PlayerBar ── zustand selectors + useSongInteraction + usePreferences
  ├─ AudioController ── <audio> + hidden gapless preloader <audio>
  │      ── useAutoDj · useSleepTimer · Media Session · scrobble POST
  └─ NowPlaying (overlay route) ── NowPlayingRoute re-fetches context
           to rebuild queue; renders duplicate page underneath

State containers (all zustand v4, React contexts noted):
  playerStore      (persist→localStorage: queue/volume/shuffle/repeat)
  libraryStore     (selectedLibraryId + libraries list, NOT persisted)
  themeStore       (mode/accent; manual localStorage; synced w/ server prefs)
  nowPlayingStore  (overlay open/tab; activeTab persisted)
  NotificationContext · AdminRefreshContext

API client: lib/api.ts — 33-line fetch wrapper ({error} envelope unwrap,
401 → window 'sonarly:unauthorized', credentials: 'include')
Types:      @sonarly/shared (16 files, ~673 LOC) — replaced by v2 codegen
```

**Data-flow traces (verified):**

- **Auth:** `App.tsx:64-89` fetches `/api/setup` + `/api/me` concurrently; 401 → `user=null` → login routes; network error → boot error screen with retry (`bootAttempt`). Login POST → `onLogin(user)` lifts state into `App`; `Layout.handleLogout` POSTs `/logout` then hard-navigates (`window.location.href`). Session is a SameSite=strict cookie; the client never touches tokens. Route guards are structural (three router trees: setup / unauthenticated / app) — there is no per-route guard component; admin gating is `user.isAdmin` checks inside `AdminRoute` wrapping only (`App.tsx:58-62`), and `user` is threaded as a prop through ~20 page components.
- **Library browsing:** route → page component → `api()` in `useEffect` keyed on `selectedLibraryId` → local `useState` → `LibraryView` (list w/ dnd-kit sortable rows, or grid) → **no pagination, no virtualization**; the server caps `/api/songs` and `/api/albums` at 500 rows. Client-side filtering via URL search params (`useFilterParams`) on the already-fetched array.
- **Playback:** user action → `playerStore` action → `AudioController` song-change effect sets `audio.src = /rest/stream.view?id=…` (or `/api/stream/:id?shareToken=…` for guests) → timeupdate drives `currentTime` (zustand) at ~4 Hz → consumers re-render. `ended` → scrobble(completion) → `onEnded()` advances queue. Auto-DJ tops up when remaining ≤ threshold via `POST /api/playback/auto-dj` with generation-guarded races.
- **Upload:** drop zone → `useUpload` → POST `/api/upload/sessions` → per-file 5 MB-chunk XHR multipart POSTs (`/chunks/{i}`) → per-file complete → session complete. Progress is local component state.
- **Realtime:** one global `EventSource`; `library:changed` → invalidate 8 react-query prefixes **+** `window` CustomEvent consumed by exactly two pages. Reconnect is browser-default (no Last-Event-ID, no replay — acceptable given the server only emits factless invalidations).

---

## 3. Repository Structure Assessment

**What exists (observed):**

```
packages/web/src/
  main.tsx (25 LOC)      bootstrap: QueryClient (no defaultOptions), providers
  App.tsx (251 LOC)      boot fetch, 3 router trees, 40+ static routes, global
                         contextmenu/dragover suppression effects
  index.css (331 LOC)    design tokens: 3 themes × (palette + 10 charts) + 10 accents
  components/  (28 files, ~5.9k LOC)   shared composites (Layout, PlayerBar, …)
  components/ui/ (10 files)             leaf primitives (Button, Input, Modal, …)
  contexts/    (1 file)                 NotificationContext (+ toasts)
  hooks/       (25 files)               play/favorite/context-menu/server-events/…
  stores/      (3 files)                playerStore, libraryStore, themeStore
  lib/         (8 files)                api.ts, cn.ts, format.ts, shareToken.ts,
                                        types.ts, songPatch.ts, coverGrid.ts, sidebar.ts
  features/    (16 domains)             auth, setup, home, tracks, albums, artists,
                                        album-artists, genres, years, composers,
                                        labels, playlists, now-playing, search,
                                        statistics, settings, admin, ingest, organize
```

**Good:**

- **Feature-first organization is real and mostly disciplined.** Each feature exposes `index.ts`; cross-feature imports overwhelmingly go through barrels (only 3 violations, all in `App.tsx`: `features/composers/pages/Composer.js`, `features/labels/pages/Label.js`, `features/admin/contexts/AdminRefreshContext.js`). Domain components co-locate with their pages.
- **A genuine shared primitive layer exists** (`components/ui/`: Button, Input, Checkbox, Modal, ConfirmModal, Table, ProgressBar, Icon, AutocompleteInput, PillInput) with consistent APIs (`cn`, variants, `loading` prop on Button) and good accessibility (Modal focus trap; Checkbox wraps a real — visually hidden — native input inside its label, `ui/Checkbox.tsx:20-61`). No third-party UI kit; the design language is owned.
- **Tailwind is used with real tokens**, not hardcoded hex: the config maps every color to the CSS variables in `index.css`, so light/dark/OLED × accents composes without conditional classes. Custom utility classes (`.input`, `.btn-ghost`, `.slider`) are minimal.
- **Icon strategy is sound:** a build-time-generated MDI SVG sprite (`scripts/generate-mdi-sprite.js`, invoked in the `build` script) + an `<Icon>` component referencing sprite symbols — zero icon-library runtime weight.
- **Test placement next to source** for web (convention documented and followed); 39 files mirror the code structure.

**Problematic / confusing:**

- **`App.tsx` is a god module for routing.** All 40+ routes statically imported (this is also why there is no code splitting); the anonymous-share exception logic (`getShareToken()` ternaries inline in routes, `App.tsx:189-196`) is embedded in routing; three separate `<Router>` trees render conditionally on boot state.
- **Feature boundaries leak at the page level:** `components/` (28 files) is not a pure "primitives" layer — it contains heavy domain composites (`EditEntityModal` 943 LOC, `FetchMetadataModal` 478, `FetchLyricsModal` 312, `UploadModal` 405, `LibraryView` 547, `TopBar` 443) that belong to features, while `features/now-playing` re-imports `components/PlayerBar`'s siblings freely. The `components/` vs `features/` split is currently "whatever existed before features were introduced" rather than a rule.
- **Two data-idioms side by side** (see §1.1, §9) — the single largest source of inconsistency: loading/error/empty handling differs by idiom (`PageState` vs scattered `loading/error` state), cache behavior differs, and SSE invalidation only reaches idiom B.
- **Dead code:** `hooks/useFetch.ts` is exported and **zero modules import it** (grep-verified). The drag-over/drop suppression and contextmenu suppression in `App.tsx` are global document-level handlers applied for the whole app lifetime (fine, but the contextmenu suppression makes native context menus unavailable everywhere except inputs/images/links — a product decision worth recording).
- **No linting/formatting anywhere** (backend audit found the same; root `lint` script is an echo). `tsconfig.json` has `strict` but no `noUnusedLocals`/`noFallthrough`, and **tests are included in `tsc`** (good — unlike the server package).
- **CSS:** `features/statistics/statistics.css` is the only feature-scoped CSS file; everything else is Tailwind. Acceptable, slightly anomalous.

**Verdict:** the folder layout scales fine; the scaling limit is (a) the missing server-state layer and (b) `App.tsx`/route static-import gravity, not the feature directories.

---

## 4. State Management Model (inventory + assessment)

Every state container, verified in code:

| Container | Holds | Writers | Readers | Lifetime / persistence | Server vs client |
|---|---|---|---|---|---|
| `playerStore` (`stores/playerStore.ts`, 477 LOC, zustand + `persist`) | `queue: PlayerSong[]`, `queueIndex`, `currentSong`, `status`, `currentTime`, `duration`, `volume`, `shuffle`, `repeat`, `shuffledIndices`, `sleepTimer`, `queueContext` | Store actions (`playQueue`, `playNext`, `addToQueue`, `removeAutoDjItems`, `toggleShuffle`…); `AudioController` writes time/status via actions; `updateCurrentSong` from favorite/rate handlers | `PlayerBar`, `NowPlaying`, `QueueList`, `AudioController`, `useAutoDj`, `useSleepTimer`, `NowPlayingRoute`, `usePlayActions`, `LibraryView` (via `playingId` selectors) | Module singleton; persisted partialize: queue, queueIndex, queueContext, volume, shuffle, repeat, shuffledIndices → `localStorage['sonarly-player']`. Rehydrate resets status/currentTime/duration and re-derives `currentSong` from queue | **Client** (queue = playback intent, not server state) — but see risks |
| `libraryStore` (`stores/libraryStore.ts`, 46 LOC) | `selectedLibraryId`, `libraries: Library[]`, `isLoading`, `error`; `loadLibraries()` fetches `/api/libraries` | `setSelectedLibraryId` (Sidebar selector); `loadLibraries` called once from `TopBar.tsx:374-378`; `setLibraries` (write path exists, no callers found) | 13+ pages read `selectedLibraryId`; `buildLibraryQuery()` helper | Module singleton; **not persisted** — selection resets to "all libraries" on every refresh (while filters *are* URL-persisted: inconsistent) | **Mixed**: `libraries` list is server state stored in zustand with its own isLoading/error — the anti-pattern React Query removes; `selectedLibraryId` is genuine client state |
| `themeStore` (`stores/themeStore.ts`, 82 LOC) | `themeMode`, `accentColor`, `apply()` (DOM class + localStorage side effect) | `setThemeMode`/`setAccentColor` from Settings UI; **also** `Layout.tsx:60-68` pushes server `preferences.themeMode/accentColor` into the store on fetch | Settings pages, `main.tsx` bootstrap, media-query listener | Module singleton; manually persisted to `sonarly-theme` + read by the `index.html` pre-hydration script | Client, but **two writers with unclear precedence** (local store vs server preferences; last-fetch wins — a Settings change can be overwritten by a stale preferences refetch) |
| `nowPlayingStore` (`features/now-playing/stores/nowPlayingStore.ts`, 56 LOC, persisted `activeTab` only) | Overlay `isOpen`, `activeTab`, `returnPath` | Now-playing open/close flows, `PlayerBar.handleOpenNowPlaying`, `NowPlayingRoute` | `NowPlaying`, `QueueModal`/panels, `PlayerBar` | `isOpen` is *deliberately not* persisted (URL is the source of truth for deep links); `activeTab` persisted | Client |
| `NotificationContext` (`contexts/NotificationContext.tsx`, 161 LOC) | Toast list (id/message/type), `notify()` | Any component via `useNotification().notify` (~30 call sites) | Provider's own render | Ephemeral per toast (4 s auto-dismiss, WAAPI animations, reduced-motion aware) | Client. Fine. |
| `AdminRefreshContext` (`features/admin/contexts/AdminRefreshContext.tsx`, 31 LOC) | `refreshKey` counter, `refresh()` | Admin child components | Admin pages keyed on `refreshKey` | Per-admin-route provider (`App.AdminRoute`) | Client — a manual refresh bus that duplicates what react-query invalidation already does elsewhere |
| **Component-local server state** (`useState` + `api()`) | Page data for Tracks, Albums, Artists, Album, Artist, Genre, Home, SearchResults, statistics, organize, ingest, settings, most admin pages | The owning component's `load()` | The owning page | Dies with the component; refetches only on mount/`selectedLibraryId` change | **Server state masquerading as component state** — no caching, no dedup, no invalidation (except the two pages listening to the window event) |

**Assessment:** Strong / Acceptable / **Needs improvement** / High risk — per dimension:

- *Client-state architecture (player/theme/now-playing):* **Strong.** The 30-test playerStore suite covers the genuinely hard parts (shuffle index bookkeeping on insert/remove, repeat-one, previous-restart threshold, Spotify-style clear-queue). `status` reset on rehydrate is correct.
- *Server-state architecture:* **Needs improvement.** Two idioms, divergent semantics, and the SSE invalidation story only works for idiom B. `libraryStore` reinvents React Query inside zustand.
- *Server/client separation:* **Needs improvement.** The distinction is *conceptually* clean (stores hold client state; nobody caches server lists in zustand except `libraries`), but in practice ~70 % of server state lives in component-local `useState`, which defeats sharing and invalidation.
- *Cache invalidation:* **High risk (correctness).** After a scan/ingest completes, Tracks/Albums/Artists/Genre/Year/Composer/Label pages show stale data indefinitely (they never observe `library:changed`). Only Home, AdminStatus (window event), and react-query consumers (prefix invalidation) refresh.
- *Optimistic updates:* **Acceptable.** Favorites/ratings optimistically patch local arrays with rollback on error (`Albums.tsx:109-129`, `useSongInteraction.ts:50-88` with a mutation-version guard against GET-overwrite races — genuinely well done); react-query mutations invalidate their own keys. No cross-page optimistic consistency (favoriting in Tracks doesn't update Albums until refetch).
- *Stale-data risks:* persisted `playerStore.queue` holds full `Song` snapshots that go stale after rescans/tag edits ( IDs survive; displayed metadata may not — `updateCurrentSong` only patches the current track). Long sessions accumulate `shuffledIndices` drift after queue edits (bookkeeping is tested, but the model is O(n) fragile by construction). `selectedLibraryId` reset on refresh can silently broaden a filtered view to *all* libraries.

---

## 5. Component Architecture (inventory + boundaries)

**Shared composite inventory (`components/`, 28 files):** Layout, TopBar, Sidebar, SidebarPlaylistItem, PlayerBar, PlayerControls (ControlButton/PlayButton/Slider), AudioController, PlayingIndicator, ScrollRow, SearchBox, Card, ListRow, CoverArt, ArtistImage, Avatar, LibraryView, ItemContextMenu, ActionButtons (FavoriteButton/StarRating), FavoriteRatingGroup, EntityHeader, EntityDetail, MetadataBreadcrumb, ExplicitTitle, PageState, PlayButton, LibrarySelector, TrackActionsMenu, SleepTimerButton, EditEntityModal, FetchMetadataModal, FetchLyricsModal, UploadModal (+`UploadResultsModal`), SponsorButton, FilterPanel.
**Leaf primitives (`components/ui/`, 10):** Button, Input, Checkbox, Icon, Table, Modal, ConfirmModal, ProgressBar, AutocompleteInput, PillInput.

**Feature component inventory (notable):** SongTable, TrackList, SyncedLyricsEditor (songs); AlbumList (albums); GenreCoverGrid (genres); PlaylistCoverGrid, SmartPlaylistBlockEditor, CreatePlaylistModal, SharePlaylistModal (playlists); NowPlaying, QueueList/QueueModal/QueuePanel, TransportControls, LyricsPanel, NowPlayingCover, SaveQueueAsPlaylistModal (now-playing); StatisticsView, MonthlyActivityChart (statistics); ProfileForm/ProfileModal/UserSection (profile); Settings, TabNav, RenameProgressModal (settings); AdminShell + 9 admin components.

**Assessment:**

- *Reusability:* **Strong** where it matters. `LibraryView<T>` is a well-designed generic list/grid with selection model (ctrl/shift range select), dnd-kit sortable mode, group-by, context-menu injection, and 22 tests — it is the backbone of every library page and avoids the duplication trap (columns/cardFields declared per page, behavior shared). `Card`, `ListRow`, `EntityHeader`, `PageState` are reused consistently.
- *Duplication across similar screens:* **Low.** Artist/AlbumArtists share `Artist.tsx`; album/artist/label/composer pages follow the same `EntityDetail` pattern. The remaining repetition is *data-flow boilerplate* (each page re-declares load/error/filter state), not markup — which points back to the server-state layer, not components.
- *God components:* `EditEntityModal` (943 LOC) is the outlier — song/album/artist tag editing, cover-art upload, MusicBrainz fetch, file-path info, delete confirmation in one modal (mitigated by 23 tests, but it is the hardest file to change in the repo). `StatisticsView` (790 LOC) and `SyncedLyricsEditor` (713) are large-but-cohesive. `App.tsx` (251) is god-*routing* (§3).
- *Prop drilling:* **Acceptable.** `user: User` is threaded through ~20 page components from `App` solely for `isAdmin` gates and `blurExplicitTitles` — a `useCurrentUser()` hook (or context) would remove the threading; low urgency.
- *Conditional rendering complexity:* **Acceptable** — pages delegate to `PageState` for loading/error/empty (documented mandate, followed).
- *List rendering & keys:* stable `id` keys throughout; grid/list switches keep state per `LibraryView` instance (view mode is component state — not URL-persisted; minor).
- *Error boundaries:* **none.** A render crash in any page takes down the whole app (React 18 unmounts the root). No `<ErrorBoundary>` anywhere; the only global error surface is the boot-error screen and `window.onerror`-free silence. For a 5-year ownership horizon this is the cheapest resilience addition.
- *Suspense/lazy:* none (no `lazy()`/`Suspense` usage; consistent with the no-code-splitting finding).

**Components that should change:** split `EditEntityModal` per entity type (song vs album vs artist already branch heavily internally); extract `useCurrentUser`; add an `ErrorBoundary` around `<main>` and around `PlayerBar`+`AudioController` (a player crash must not kill browsing).

---

## 6. Dependency Graph

**Healthy edges:**

```text
pages ──▶ hooks (usePlayActions/useFavoriteActions/use*ContextMenu) ──▶ playerStore / api
pages ──▶ LibraryView/Card/PageState (shared composites)
features/now-playing ──▶ features/playlists|albums|genres pages (render-under-overlay, via barrels ✓)
hooks/useServerEvents ──▶ react-query invalidation + window event
AudioController ──▶ playerStore + api (scrobble) + lib/shareToken
lib/api.ts ──▶ nothing (leaf; 33 LOC; the only fetch gateway) ✓
components/ui/* ──▶ lib/cn only (leaf primitives) ✓
stores ──▶ lib/api (libraryStore only), @sonarly/shared types
```

- Cross-feature imports go through `index.ts` barrels (verified by grep: only 3 violations, all `App.tsx`).
- **No circular dependencies found** (module graph is acyclic by inspection; imports consistently point "downward" toward lib/ui/stores).
- The player is the only true cross-cutting concern and it is correctly store-centric: UI writes intents, `AudioController` owns the element.

**Problematic coupling:**

| From | To | Problem |
|---|---|---|
| `App.tsx` | every feature's pages (static) | forces the whole app into one chunk; adding a route grows first paint |
| `NowPlayingRoute` | `PlaylistDetail`, `GuestPlaylist`, `Album`, `Genre`, `Composer`, `Label`, `HomePage` (pages!) | overlay route imports *pages of other features* to render underneath; also re-implements their data fetching to rebuild queues |
| `components/` | features (`SponsorButton`→`usePreferences`; `PlayerBar`→`features/now-playing`) and vice versa (now-playing→components) | direction is bidirectional between `components/` and `features/`; the "components is below features" rule is not enforced |
| `useAutoDj` | `@sonarly/shared` runtime const `MAX_EXCLUDE_IDS` | server cap mirrored in client runtime code — breaks the "types only from generated contract" migration unless a runtime-constants home is defined (§9, §18) |
| `SmartPlaylistBlockEditor` | operator/field whitelists (`STRING_OPERATORS` etc.) | duplicates the server compiler's field/operator policy for UX; tolerable today because `@sonarly/shared` is the single source, but the two whitelists will diverge once codegen types replace shared — the v2 spec deliberately documents structure only |
| `themeStore` ↔ server preferences | `Layout` effect | two writers, last-write-wins precedence (§4) |

---

## 7. Critical Findings

Ordered by impact. Facts verified in code this session. Severity reflects a self-hosted multi-user deployment and the v2 cutover plan.

### FF1 — HIGH (correctness): SSE cache invalidation does not reach most pages
`useServerEvents.ts:50-57` invalidates react-query prefixes **and** dispatches `sonarly:library-changed`. React-query consumers refresh; everyone else doesn't. Hand-rolled pages holding server data in `useState` — `Tracks.tsx:34-44`, `Albums.tsx:57-67`, `Artists`, `Genre`, `Year`, `Composer`, `Label`, `SearchResults` — only refetch on mount or `selectedLibraryId` change. After a scan/ingest/organize completes (exactly when data changes), the user looking at Tracks sees stale rows until they navigate away and back. `HomePage.tsx:459` and `AdminStatus.tsx:65` patched this locally by listening to the window event — proving the pattern works and that the general fix is mechanical. **Fix:** route all server state through react-query (§17) so the existing invalidation prefix list actually covers the app; until then, add the window listener to a shared `useLibraryData` hook. Priority: first item in the migration (Phase 1).

### FF2 — HIGH (performance): zero code splitting; 646 KB single JS chunk
`vite build` emits exactly one JS asset (`dist/assets/index-C6F7-N4O.js`, 646,372 bytes) + one CSS (56,793 bytes). `App.tsx` statically imports all 40+ routes including admin (644-LOC `AdminUsers`, 530-LOC `AdminGenres`), statistics (790-LOC `StatisticsView` + charts), `EditEntityModal` (943 LOC), and all fetch modals. First paint downloads and parses the entire application for every visitor, including the login screen. React-dom + react + zustand + react-query + dnd-kit + wouter ≈ 55–60 % of the chunk; the rest is app code that could be per-route. **Fix:** `React.lazy()` per route (wouter routes accept components; a small `lazyRoute()` helper keeps `App.tsx` tidy) + a bundle-size budget in CI. Expected: login/first-paint chunk drops to ~250–300 KB, admin/statistics/modal code moves behind interaction. Low risk, high payoff, fully incremental.

### FF3 — HIGH (v2 contract): the frozen spec does not cover the client's core mutations
Path-by-path diff of client calls (`grep`-extracted ~50 distinct native endpoints) vs `v2/api/openapi.yaml` (50 paths). **Missing from v2 entirely:** `/api/favorites`, `/api/ratings` (fired from `useFavoriteActions.ts:11,18` — nearly every screen), `/api/libraries` (non-admin list used by `libraryStore.loadLibraries`; only `/api/admin/libraries` exists), `/api/me/preferences` (every settings page + Auto-DJ + sponsor hide), `/api/songs/{id}/lyrics` GET/PUT (`LyricsPanel`, `SyncedLyricsEditor`, `FetchLyricsModal`), `/api/songs/{id}/tags` + `/api/songs/tags` + `/api/albums/{id}/tags` (`EditEntityModal`, `HomePage`, `Track`), `/api/albums/{id}/cover-art` POST/DELETE, `/api/suggestions` (`AutocompleteInput` backing every metadata pill input), `/api/lrclib/search`, `/api/musicbrainz/search` (both fetch modals), `/api/organize/*` (whole Organize feature), `/api/settings/media`, `/api/admin/{status,system-tasks*,ingest*,missing*,artists/refetch}` (most admin screens), `/api/users/lookup`, `/api/playlists/{id}/albums`, avatars (known S3 gap). The backend track owns closing these; **the frontend migration is blocked proportionally**. This must be tracked as an explicit cross-track dependency (§20 Phase 2), not discovered at cutover.

### FF4 — HIGH (v2 contract): deliberate v2 DTO/protocol changes that break current client code
Verified against the spec and `docs/s3-contract-findings.md`: (a) `Song` drops `filePath`/`checksum` — but `EditEntityModal.tsx:393` renders `FilePathInfo`, and `ConflictsModal.tsx:120` / `MissingModal.tsx:93` display paths; (b) upload chunk PUT changes from multipart to raw `application/octet-stream` — `useUpload.ts:36-58` sends `FormData` XHR; (c) `listSongs`/`listAlbums` take `genreId`, not `genre` name — `Genre.tsx:37-40` filters by name; (d) `syncedLyrics` is `SyncedLyricLine[] | string` — `LyricsPanel.tsx:266-311` assumes an array (`.map((line) => line.text)` yields garbage on a string); (e) `PlaylistEntry.album/artist` are non-null plain strings (empty = unset) vs catalog nullable fields; (f) `ScrobbleDetails` body shape to verify against `AudioController.scrobble` (`client/source/durationListened/completion` — v2 B13 validation may clamp differently). Each is small; together they are the real cost of the cutover and argue for the mapping-layer approach in §17.

### FF5 — MEDIUM-HIGH (architecture): `NowPlayingRoute` re-fetches entire contexts to rebuild the queue
`features/now-playing/pages/NowPlayingRoute.tsx:1-60` imports the underlying **pages** of five contexts and, on direct visit/refresh of `/now-playing/...`, issues the same list requests those pages make (e.g. genre: all songs **and** all albums — up to 2×500 rows) to reconstruct a local queue that may no longer match what the user was playing. It then renders the full page underneath the overlay (double mount + double fetch of the same data). This is the weakest architectural seam in the app: URL-as-queue-state without a server-side queue. **Fix options:** (a) persist only `{context, contextId, songId, position}` and lazily rebuild on first *user* navigation action rather than on load; (b) cap rebuild contexts (playlist/album only); (c) long-term, accept the current behavior but cache the context via react-query so the underneath page and the rebuild share one request. Not a rewrite; a contained change.

### FF6 — MEDIUM (performance): unconditional 5 s polling of `/api/players` from `TopBar`
`TopBar.tsx:35-42` — `usePlayers()` has `refetchInterval: 5000` and is called by `PlayersDropdown`, which `TopBar` renders unconditionally (`TopBar.tsx:422`). Every authenticated client hits `/api/players` 12 times/minute forever, including when the dropdown has never been opened (the component returns null only when *other* players are empty — the hook still runs). Same pattern in `AdminStatus.tsx:61-63` (5 s status poll — defensible for an admin status page). v2's SSE exists but emits no player events today; short-term fix is `refetchIntervalInBackground: false` + polling only when the dropdown is open (or on hover), and listing "player events" as a v2 SSE extension candidate.

### FF7 — MEDIUM (correctness): `selectedLibraryId` is not persisted and silently resets
`libraryStore` keeps the library filter in memory only (`stores/libraryStore.ts:15-20`), while every other view preference (filters, view context) is URL- or localStorage-backed. Refresh → filter jumps back to "all libraries" on a multi-library server. Cheap fix: persist via zustand `persist` (one-line) — noting that on shared computers the persisted choice may exceed the user's assigned libraries, in which case the server (post-F1 enforcement) 404s/empties lists; acceptable and self-healing.

### FF8 — MEDIUM (data flow): theme/preferences two-writer race
`Layout.tsx:60-68` pushes server preferences into `themeStore` whenever the preferences query refetches; the Settings UI writes the store locally *and* PATCHes preferences. A refetch landing after a local change overwrites it (last-write-wins across two systems with different latency). Single-source fix: make `themeStore` a pure local cache *seeded from* preferences once, or drive theming entirely from the preferences query with localStorage only as the anti-FOUC bootstrap (the `index.html` script already handles pre-hydration independently).

### FF9 — MEDIUM (testing): the player-event layer is untested
328 tests cover the queue state machine thoroughly (`playerStore.test.ts`, 30 tests) but **nothing exercises `AudioController`'s event wiring** — scrobble threshold timing, ended→completion, stall detection, autoplay-block, repeat-one re-scrobble guard (`AudioController.tsx:298-309`). This is the highest-risk untested code in the repo (it is also the best-written). jsdom can't play audio, but the wiring is testable by stubbing the `<audio>` element events (a `HTMLMediaElement` prototype mock dispatching `timeupdate`/`ended`). Add the smallest viable harness.

### FF10 — MEDIUM (resilience): no error boundaries
Any render-time crash (a malformed `syncedLyrics` string post-v2, a null `artistEntries` deep in `PlayerBar`) unmounts the entire React root to a white screen; the audio keeps playing with no UI to control it. A class component `ErrorBoundary` around `<main>` and around the player chrome is ~40 lines and prevents a whole class of "app is broken" reports. Pairs with the v2 contract migration (new shapes *will* slip through).

### FF11 — LOW-MEDIUM (accessibility): context menus are mouse-only
`ItemContextMenu` opens on `contextmenu` (right-click) and optional long-press; there is **no keyboard path** to open it (the trigger isn't a focusable menu button; no Shift+F10 handling). Keyboard users lose every per-item action that lives only in context menus (add-to-playlist, edit, download, etc.) — though primary actions (play/favorite/rate) are reachable inline. Also `Modal` hardcodes `aria-labelledby="modal-title"` — two simultaneously open modals produce duplicate IDs (nested flows exist: QueueModal over NowPlaying with lyrics editor modals beneath).

### FF12 — LOW-MEDIUM (docs drift): agents inventory files lag reality
`agents/ui-components.md` lists ~24 components; the actual shared inventory is ~35 composites + 10 primitives (missing: PlayButton, PlayerControls, PlayingIndicator, ScrollRow, UploadModal, EntityDetail, LibrarySelector, EditEntityModal, FetchLyricsModal, FetchMetadataModal, SponsorButton, Modal, ConfirmModal, and all feature-level components). `agents/technology-stack.md` omits react-query and dnd-kit. The barrel rule in `agents/development-conventions.md` has 3 violations (`App.tsx`). `agents/design-language.md` was verified **accurate** (tokens, typefaces, mode-aware accent, signature element all match `index.css`/`useDominantColor`). File updates deferred to the later docs pass per track instructions; the authoritative component list is §5 of this report.

---

## 8. Code Quality Findings

Format: Problem · Location · Why / Risk · Change · Priority.

| # | Problem | Location | Why / Risk | Change | Priority |
|---|---|---|---|---|---|
| Q1 | Two data idioms with divergent cache semantics | `hooks/usePlaylists.ts` etc. vs `features/tracks/pages/Tracks.tsx:34-44`, `features/albums/pages/Albums.tsx:57-67` | §1.1/FF1: stale-after-scan, inconsistent loading/error UX | Standardize on react-query; convert pages one feature at a time | High |
| Q2 | Dead hook | `hooks/useFetch.ts` | Zero importers (grep-verified); misleading "existing abstraction" | Delete | Trivial |
| Q3 | `libraryStore` reinvents server-state fetching | `stores/libraryStore.ts:22-31` | isLoading/error in zustand; no dedup/caching; loaded from TopBar of all places | Move `libraries` to react-query; keep `selectedLibraryId` in zustand (persisted, FF7) | High |
| Q4 | God modal | `components/EditEntityModal.tsx` (943 LOC) | 3 entity types × tag edit + cover art + MB fetch + delete + path info | Split per entity; shared field-editor primitives | Medium |
| Q5 | God router module | `App.tsx` (251 LOC, 40+ static routes) | Blocks code splitting; share-token logic inline in routes | `lazyRoute()` + route table per area; extract guest-guard | High (with FF2) |
| Q6 | Queue-rebuild-by-refetch | `features/now-playing/pages/NowPlayingRoute.tsx` | §FF5: O(section) fetch per refresh; double page mount | Rebuild lazily; share context cache | Medium |
| Q7 | `themeStore` two-writer race | `Layout.tsx:60-68` × `SettingsAppearance` | FF8 | Single source (preferences) + bootstrap-only localStorage | Medium |
| Q8 | Unconditional players polling | `TopBar.tsx:35-42,422` | FF6: 12 req/min/client | Poll only when dropdown open | Medium |
| Q9 | Barrel violations | `App.tsx:33,35,37` | Convention says barrels-only | Import via `features/*/index.ts` | Low |
| Q10 | No error boundaries | app-wide | FF10 | Add boundary around `<main>` + player chrome | Medium |
| Q11 | Smart-playlist operator lists duplicated client-side | `SmartPlaylistBlockEditor.tsx:10-62` vs server compiler | Whitelist drift risk post-codegen | Accept as UX-layer duplication; add contract test in backend | Low |
| Q12 | Server error text rendered verbatim | all pages (`err.message` → `setError`/notify) | UX inconsistency (raw 500 messages like worker errors); v2 `{error}` shape keeps this working but wording will vary | Normalize user-facing copy at the api layer; keep details in console | Low |
| Q13 | `loadLibraries` triggered from TopBar mount | `TopBar.tsx:374-378` | Non-obvious owner; fires even before library UI visible | Trigger from a `<LibrariesLoader>` in the app shell or a react-query mount | Low |
| Q14 | Duplicate `modal-title` id when modals stack | `components/ui/Modal.tsx:77,91` | aria-labelledby ambiguity | Use `useId()` | Trivial |
| Q15 | Global contextmenu suppression | `App.tsx:97-114` | Product decision disabling native menus app-wide (also kills devtools right-click on text); undocumented | Document in agents/; consider scoping to library surfaces | Low |
| Q16 | `playerStore` persisted queue can go stale/large | `playerStore.ts:452-460` | Metadata snapshots drift after rescans; unbounded queue → localStorage growth | Persist `{ids, context}` and rehydrate metadata via query, or cap persisted queue length | Low (design decision) |

**Checked and clean:** no `console.log` spam (3 `console.error` sites, all in error paths); no `any` floods (selective `Record<string, unknown>` at API boundaries only); no `eval`; no inline styles beyond CSS-var injection for the dominant-color wash; keys are stable; `React.StrictMode` on; no `useEffect` fetching without a cancellation/ignore guard in the files audited (`useSongInteraction`, `useDominantColor`, `useAutoDj` all guard races — notably good).

---

## 9. API Integration Assessment

**Client design today.** `lib/api.ts` is a 33-line fetch wrapper: JSON in/out, `{error}` envelope unwrap (matches v1 **and** v2 error shape — the one place the v2 contract is already satisfied), 401 → global `sonarly:unauthorized` event, 204 → undefined. Typed at call sites as `api<{songs: Song[]}>('/songs')` — **call-site generics over `@sonarly/shared` types**, i.e. the request path is a string with zero compile-time coupling between URL and response type. No timeout, no AbortController, no retry (react-query provides retry for idiom B only). Uploads bypass `api()` with raw XHR for progress events — justified.

**`@sonarly/shared` usage.** 102 files import it. It supplies (a) entity types (`Song`, `Album`, …) and (b) **runtime constants** (`MAX_EXCLUDE_IDS`, `SMART_PLAYLIST_FIELDS`, `AUTO_DJ_EXCLUDE_WINDOWS`, `DUPLICATE_STRATEGY_LABELS`, `DEFAULT_USER_PREFERENCES`, type guards). Under the v2 decision, (a) is replaced by `openapi-typescript` output, but (b) has no codegen replacement — the migration must create an explicit home for shared runtime constants (§18 `contract/constants.ts`), or the client silently forks server policy (the 500-exclude-ids cap, duplicate-strategy enums).

**Server-state lifecycle.** Inconsistent by construction (§4). React Query has **no defaultOptions configured** (`main.tsx:9`) — no default staleTime, so e.g. `usePlaylists` refetches on every sidebar remount window focus; fine at this scale but worth one `staleTime: 30s` default.

**Mutations & invalidation.** React-query mutations invalidate narrowly (`['me','preferences']`, `['lyrics', songId]`, `['playlists']`). Hand-rolled mutations call `load()` after write. Favorites/ratings update *local arrays* optimistically but don't invalidate other queries — favoriting a track in Tracks won't reflect on Album until its refetch.

**SSE.** Single connection, `withCredentials`, browser-managed reconnect, only `library:changed` acted on (server emits only `connected` + that). Design is fine; the consumer wiring (FF1) is the defect. No `Last-Event-ID`/replay — acceptable: events are invalidations, not facts.

**Race conditions.** Search-as-you-type: debounced (200 ms, `SearchBox.tsx:52`) + react-query keyed on `[query, libraryId]` — **correct**; stale responses can't clobber (react-query). `useSongInteraction`'s mutation-version guard (FF-free, good). `useAutoDj`'s generation counter drops stale DJ responses — good. Hand-rolled `load()`s guard unmount but not slow-response-over-fast across dependency changes (low impact: only `selectedLibraryId` triggers).

**Where the client duplicates backend rules:** scrobble threshold (client-legit, mirrors Subsonic convention), 5 MB upload chunking (protocol detail that must match v2's new raw-body contract), `MAX_EXCLUDE_IDS=500` (mirrors server cap — confirmed in S3 findings), Auto-DJ defaults (5/10) as fallbacks when preferences absent, smart-playlist operator/field whitelists (UX copy of server policy), duplicate-strategy labels (UX). None of these are *correctness* duplications except the ones noted under FF4; the backend remains the validator everywhere (principle 8 holds).

**v2 alignment summary (the cutover matrix):** fully compatible today — `/api/search` (`q/type/limit`), statistics (paths identical), `/api/home`, `/api/players`, scrobble path, stream paths (+HEAD), bookmarks, scans, playlists incl. share/share-link, genres/tree, years, cover-art GET, ingest list/trigger, conflicts. Breaking/needs-work — everything in FF3/FF4. Migration vehicle — `openapi-typescript` + thin wrapper, per the S3 recommendation (orval explicitly rejected there; this audit concurs: the client's data layer is thin hooks, react-query is already present, and per-operation hooks would add config surface for zero gain).

---

## 10. Player & Media Assessment

**This is the strongest area of the client, by a wide margin.** Details because media handling is where web clients usually rot:

- **Element lifecycle:** exactly two elements — the player (`audioRef`) and a never-playing gapless preloader (`preloadRef`, `preload="auto"`). Track changes set `src` + `load()` + `play()` (`AudioController.tsx:77-92`); clearing removes the attribute and reloads. There is **no `createObjectURL` in the repository**: streams are plain same-origin HTTP URLs, so the object-URL leak class is absent by design. The preloader's `src` is removed whenever no preload target exists (e.g. queue end, repeat-one), aborting its fetch — verified at `:130-139`.
- **Queue model:** `queue[]` + `queueIndex` + `shuffledIndices[]` dual representation. The shuffle bookkeeping on insert (`playNext`), append (`addToQueue`), and surgical removal (`removeAutoDjItems`) is the most intricate logic in the client and is **covered by 30 store tests** including edge cases (toggle-off preserves shuffled order as the new queue order — a Spotify-faithful detail). Risk: the model is O(n) and hand-synchronized; each new queue operation must update both structures. Acceptable now; a future "queue items with stable ids" refactor would make dnd-reorder and removal trivial — **do not do it preemptively**.
- **Scrobbling:** client rule `min(50 %, 240 s)` evaluated on `timeupdate` plus completion on `ended`; a `lastScrobbledRef` guard prevents double-submit (threshold + ended); repeat-one explicitly resets the guard so replays scrobble (`:298-309`). Fire-and-forget with silent catch — deliberate (playback must never hard-fail on analytics), and guests' 401s die silently. v2 `ScrobbleDetails` shape needs a one-time verification against the body built at `:287-296`.
- **State machine:** `idle/loading/playing/paused/error` driven by *both* store intents and element events (`onPlay/onPlaying/onWaiting/onStalled`), with a 15 s stalled→error timer and autoplay-block demoted to a soft "Press play" notice. `AbortError` from rapid skips is correctly swallowed. Error recovery is thin: `status='error'` persists until the next user action; no automatic retry/next-on-error — a reasonable product call, worth a conscious decision.
- **Persistence:** queue/volume/shuffle/repeat to localStorage; rehydrate resets playback to `idle` (correct — no surprise audio) and re-derives `currentSong` from the persisted queue. Volume is **not** synced to server preferences (per-device by design — fine; document it).
- **Media Session:** full action set (play/pause/prev/next/seekto/±10 s), metadata with artwork, playback state, and `setPositionState` with the position-second quantization needed to avoid throwing. Genuinely complete — most web players skip half of this.
- **Gapless:** the preloader warms the browser cache for the next track in the last 30 s. Honest scope: it reduces TTFB on `ended`; it is not sample-accurate gapless (no `AudioContext`/ MediaSource). That is the right trade for this product — do not escalate to Web Audio without a demonstrated need (§22).
- **Guests:** share-token stream URLs flow through `lib/shareToken.ts` (`withShareToken` appends the token to cover-art and stream URLs). Token-in-query is the v1/v2 contract; it does leak into browser history/logs — inherent to the chosen share design, noted as accepted.
- **Gaps:** no `ended→error` fallback to the next track; no volume-preferences sync; FF5 (queue rebuild), FF9 (untested wiring), and the guest scrobble 401 noise. Nothing here is architectural.

---

## 11. Performance Assessment

**Confirmed bottlenecks (code-level facts):**

1. **Single 646 KB JS chunk, no splitting** (FF2) — every route, modal, admin screen, and chart ships to first paint. Largest win available.
2. **No list virtualization anywhere** — `LibraryView` renders every row/card (`components/LibraryView.tsx:308-492`); `Tracks` renders the full server response (≤500 today). Fine *because of* the server cap; the moment v2 pagination lands (`limit` params already exist in the spec), the client needs a list strategy — decide then, not now (§22).
3. **Unconditional `/api/players` polling** (FF6) — 12 req/min/client, 24/7.
4. **Shuffle-albums N+1**: `Albums.tsx:97-107` fires one `GET /albums/{id}` per album to expand songs for shuffle — 50 visible albums = 51 requests. Server has no "albums with songs" batch endpoint; acceptable at current scale, worth an `includeSongs` param later.
5. **NowPlayingRoute context re-fetch** (FF5) — up to 2×500 rows per refresh of the overlay URL.

**Likely bottlenecks (inference):**

- `currentTime` updates at `timeupdate` frequency (~4 Hz) into zustand; every selected consumer re-renders each tick (`PlayerBar` progress, `LyricsPanel` active-line binary search). Observed cost is small (these are cheap trees); if profiling ever complains, selector-scoping `Math.floor(currentTime)` for the progress display is the fix. Do not preempt.
- `useDominantColor` samples 64×64 canvas per track change — cheap, debounced by track changes only. OK.
- Artwork: `<img loading="lazy">` everywhere with fade-in (good); **no responsive srcset / no derivative sizes** — every grid cell downloads the full-resolution cover (server stores original blobs; v2 explicitly defers derivatives). On a 500-album grid that's 500 full-size images, lazily loaded — acceptable today; the server-side derivative cache is the real fix and is already a backend-track deferral.

**Architectural risks:** none beyond FF2/FF5; bundle growth is unbounded because nothing measures it.

**Premature to optimize:** virtualizing lists below the server cap; memoizing `LibraryView` rows (React handles 500 rows fine); service workers/offline (a music *server* client gains little from offline HTML); HTTP caching of artwork (server already sets `private, max-age=86400` on the Subsonic path; the native `/api/cover-art/{id}` lacks Cache-Control per the backend audit — server-side fix).

**Bundle budget recommendation (concrete):** warn at >450 KB and error at >600 KB gzip-agnostic raw JS for the entry chunk post-splitting; per-route chunks <150 KB. Add to CI in Phase 4.

---

## 12. Accessibility Assessment

**Strengths (verified, concrete):** skip-to-content link (`Layout.tsx:90-95`); Modal focus trap + initial-focus + focus restore + Escape (`ui/Modal.tsx:22-68`); ItemContextMenu arrow-key cycling, first-item focus on open, focus return on close, long-press for touch (`ItemContextMenu.tsx:117-145,165-196`); SearchBox combobox with `aria-expanded`/`aria-activedescendant`, Ctrl+K shortcut, Escape handling; `PageState` renders `role="status"`/`role="alert"` + retry; all forms use real `<label htmlFor>` + `autoComplete` (Login/Setup/Profile); native `<input type="range">` for seek/volume with `aria-valuetext`; icon-only buttons carry `aria-label`/`title` consistently; `[@media(pointer:coarse)]:h-11` gives 44 px touch targets on favorite/rating/icon buttons; reduced-motion honored in toasts, lyrics autoscroll, cover fade, spinners (`motion-reduce:`/`prefers-reduced-motion` checks); explicit badge has `role="img" aria-label="Explicit"`; dnd-kit reorder has a `KeyboardSensor`.

**Findings:**

| Sev | Finding | Location | Fix |
|---|---|---|---|
| Medium | Context menus unreachable by keyboard (no trigger button, no Shift+F10) | `ItemContextMenu.tsx:152-163` | Add keyboard trigger on the wrapped element (Enter/F10/Menu key) or an explicit "more actions" button per row (SongTable already has a menu affordance pattern to copy) |
| Medium | Hardcoded `aria-labelledby="modal-title"` — duplicate IDs when modals stack (QueueModal over NowPlaying over lyrics modals) | `ui/Modal.tsx:77,91` | `useId()` |
| Medium | Statistics charts (donut/activity) are div/SVG visuals with no text alternative or roles | `features/statistics/components/StatisticsView.tsx:491+`, `MonthlyActivityChart.tsx` | Provide an accessible summary table (visually hidden or toggle) for both charts |
| Low | `role="option"` applied to `<button>` inside `role="listbox"` — non-standard; `aria-selected` on buttons | `SearchBox.tsx:262-277` | Use `role="option"` on non-interactive elements, or drop listbox/combobox to a simpler `aria-expanded` popup pattern |
| Low | Combobox input lacks `aria-controls` pointing at the listbox | `SearchBox.tsx:194-209` | Add `id` + `aria-controls` |
| Low | Now-playing overlay open/close does not manage focus (no move-into-overlay, no focus restore on close) | `features/now-playing/components/NowPlaying.tsx` | Focus the overlay heading on open; restore to the triggering control on close |
| Low | Toast stack: `role="alert"` on every toast can be chatty for SR users on rapid errors | `NotificationContext.tsx:118` | Consider `aria-live="polite"` for info/success, keep `alert` for errors |
| Info | No `prefers-reduced-motion` guard on the dominant-color *transition* (color snap is instant — fine); autoscroll honors it ✓ | — | — |

**Contrast:** token values give ≈4.6:1 (fg-secondary 42 % gray on 97 % white) and ≈7:1 in dark modes — passes WCAG AA for secondary text in both themes. No fixed px font sizes in components (Tailwind rem scale).

Overall: **Acceptable-to-Strong**, with a short, concrete fix list rather than a program.

---

## 13. Security Assessment (prioritized)

Evidence-based only. This client has a small attack surface and keeps it small.

| Sev | Finding | Location | Fix |
|---|---|---|---|
| Low | Share token in URL query persists in history/server logs; appended to image URLs | `lib/shareToken.ts`, `AudioController.streamUrl` | Inherent to the design (bookmarkable shared links); document. Long-term: POST-based token exchange for streams if paranoia demands |
| Low | Server error text rendered verbatim to users (may include internal detail the backend leaks) | all `err.message` call sites | Normalize at api layer (Q12); backend already sanitizes 5xx except statistics routes (backend audit) |
| Low | Google Fonts loaded from CDN (external request per page load; leaks IP/Referer to Google) | `index.html:13-18` | Self-host the 3 woff2 families (build-time download) — consistent with the self-hosted ethos; also removes the fonts render dependency |
| Low | No dependency-audit gate | `package.json` (no `audit` script) | `pnpm audit` in CI (backend track owns the workflow) |
| Info | No CSP/SRI — but the app serves same-origin static assets from the same server; risk profile is minimal | deployment | Add CSP when the backend adds security headers (backend audit Low) |
| Info | `console.error` in `useSongInteraction` can log server messages | `hooks/useSongInteraction.ts:43,63,85` | Harmless (no secrets in these payloads) |

**Verified clean:** XSS (zero `dangerouslySetInnerHTML`; React text-escaping for all metadata/lyrics/usernames; lyrics render as text nodes or button children — `LyricsPanel.tsx:290` `{line.text}`), `window.open` hygiene (`noopener,noreferrer` on the sponsor link, the only `_blank`), CSRF (SameSite=strict session cookie + JSON-only APIs + no custom headers needed; the api wrapper sends no auth tokens), session/token handling (client stores no tokens; session cookie is `credentials: 'include'` same-origin only), dependency surface (9 runtime deps, no sketchy transitive additions; dnd-kit/zustand/react-query/wouter are mainstream), prototype-pollution-style JSON handling (all parses go through the `{error}` unwrap or react-query), no `eval`/`new Function`, upload path validation is server-side double-guarded (backend audit §12).

**Classification note:** nothing in the frontend rates High/Critical. The highest-leverage security work is server-side (already tracked by the backend audit: F1/F2/F9 etc.).

---

## 14. Testing Assessment

**Verified numbers (this session):** 39 files, 328 tests, **all passing**, 10.89 s wall (jsdom 29, vitest 3, @testing-library/react 16). CI (`ci.yml`) runs `pnpm -r build` + `pnpm test` on push/PR — the safety net the backend lacked now exists and covers the web package.

**Distribution (observed):** stores 34 (playerStore 30, nowPlayingStore 4) · hooks ~91 (context menus 44, useSleepTimer 15, useAutoDj 12, useSongInteraction 9, useServerEvents 5, useClickAndHold 6) · shared components ~95 (EditEntityModal 23, PlayerBar 23, LibraryView 22, PlayButton 16, Table 15, ItemContextMenu 7, ActionButtons 7, SponsorButton 5, ExplicitTitle 5, FetchMetadataModal 4, FetchLyricsModal 3, SearchBox 1, ProgressBar 2, PlayerControls 2) · features ~60 (NowPlaying 17, QueuePanel 9, SyncedLyricsEditor 8, SearchResults 9, LyricsPanel 4, TransportControls 4, AdminGenres 4, NowPlayingCover 2, PlaylistDetail 2, RenameProgressModal 2, Albums 1).

**Strengths:** the player store's shuffle/repeat matrix; `EditEntityModal`'s 23 tests including the MusicBrainz modal flow; SSE hook tested through both a mocked and a real QueryClient; `useServerEvents` invalidation assertions; context-menu hook tests cover the *composition* of menu items (play/add-to-playlist/edit/share/delete) — the app's most behavior-dense UI.

**Gaps (by risk):**

1. **No `AudioController` tests** (FF9) — scrobble thresholds, ended handling, stall timer, autoplay-block: the best-written, highest-risk code is untested. jsdom supports `HTMLMediaElement` stubs; dispatching `timeupdate`/`ended` against a mocked element is sufficient.
2. **No upload tests** — `useUpload`'s chunk loop, progress math, and error propagation (XHR-mockable) are unexercised; the protocol changes under v2 (FF4b), so tests written now pay off twice.
3. **No `NowPlayingRoute` tests** — the queue-rebuild logic (FF5) is intricate and unexercised.
4. **No page tests for the hand-rolled data pages** (Tracks/Albums/Artists) — they contain the FF1 stale-data pattern; a regression test pinning "refetch on library:changed" belongs to the Phase-1 fix.
5. **Guest/share flow untested** (`GuestPlaylist`, share-token URL flows).
6. **Statistics/admin pages untested** except AdminGenres.
7. **Tooling gaps:** no `@testing-library/user-event` (interactions via `fireEvent`), no `@testing-library/jest-dom` matchers, no coverage reporting configured (`coverage` script absent). No e2e — acceptable for a self-hosted SPA with this API-test culture, but the login→upload→play golden path would be the first e2e if one is ever justified.

**Mocking strategy:** per-test `vi.mock` of `lib/api.js` or fetch stubbing; no MSW. Adequate at this size; MSW becomes attractive only when the same fixtures are needed across page tests — the generated contract's example data could feed it later. Test isolation is good (fresh QueryClient per test where used; zustand stores reset via exported `resetPlayer`/`resetNowPlaying` helpers).

**Recommended pyramid (pragmatic):** keep the current unit-heavy shape; add (a) the AudioController wiring harness, (b) upload protocol tests during the v2 upload migration, (c) one integration-style page test per data idiom after Phase 1 to pin invalidation behavior, (d) coverage thresholds only after the first coverage run establishes the baseline (don't invent a number).

---

## 15. Technology Stack Assessment

| Technology | Current role | Assessment | Verdict | Reason | Alternative | Migration difficulty |
|---|---|---|---|---|---|---|
| React 18.3 | UI | Class-free function components; StrictMode; no concurrent features used (none needed) | **Keep** | Stable, team-known; no evidence 19's features are needed | — | — |
| Vite 6 | Build/dev | Zero config drift, dev proxy for `/api`+`/rest`; but no code splitting | **Keep** | Not the bottleneck; splitting is config/router work, not a tool change | — | — |
| TypeScript 5.9 strict | Language | Strict on; tests typechecked; `moduleResolution: bundler` with `.js` suffixes | **Keep** | The `.js`-suffix ESM style is unusual but consistent | — | — |
| Tailwind 3.4 | Styling | Token-mapped config, 3 themes, minimal custom CSS; content scan correct | **Keep** (v4 upgrade opportunistic) | Token architecture is right; v4's CSS-first config is a nice-to-have | — | Low |
| wouter 3 | Router | 3.3 KB, hooks + nested-optional Switch; handles the 40-route table fine | **Keep** | React Router would add weight for zero needed features | React Router (only if nested layouts/ loaders ever demanded) | Medium, unnecessary |
| zustand 4.5 | Client state | player/theme/library/now-playing stores; persist middleware | **Keep** | Right-sized; server state must move *out* of it, not the library out of the app | — | — |
| @tanstack/react-query 5 | Server state | Partially adopted; no defaultOptions; the target idiom for the unification | **Keep, expand to sole server-state layer** | Already present; deleting it would recreate the hand-rolled mess | — | — (expansion is the plan) |
| @dnd-kit (core/sortable) | Reordering | Used for playlist queue + LibraryView sortable; KeyboardSensor included | **Keep** | a11y-correct DnD is hard; dnd-kit does it | — | — |
| @sonarly/shared | Contract types + runtime constants | Single source today; **replaced by v2 codegen for types** per DR-2 | **Replace types / keep constants** | OpenAPI is the v2 contract source; runtime consts need a new home (`contract/constants.ts`) | `openapi-typescript` output (decided in S3) | Medium (§20) |
| openapi-typescript | v2 contract types | Proven in S3 spike (~115 KB types, strict-clean, envelope unwrapping verified) | **Adopt** | Dependency-free types; matches thin-hook client shape | orval (rejected in S3; adds runtime surface) | Low–Medium |
| Native `<audio>` × 2 | Playback | Full lifecycle + gapless cache warmer + Media Session | **Keep** | Web Audio would be a rewrite with no feature demand | — | — |
| @mdi/svg (build-time sprite) | Icons | Zero runtime icon weight; build script regenerates sprite | **Keep** | — | — | — |
| Google Fonts CDN | Fonts | 3 families via `fonts.googleapis.com` | **Replace eventually** (self-host woff2) | Self-hosting fits the self-hosted product; removes external request | Self-hosted | Low |
| Vitest 3 + jsdom + testing-library | Tests | 328 tests/11 s; no user-event/jest-dom/coverage | **Keep, extend** | Add user-event + coverage baseline | — | Low |
| No ESLint/Prettier | Linting | Nothing configured (repo-wide) | **Adopt (repo decision)** | Backend audit flagged the same; one config for both packages | — | Low |
| XHR (uploads only) | Upload progress | `fetch` can't report upload progress; XHR is the correct tool | **Keep** (protocol changes under v2) | — | — |

No dependency was found that should be **removed** beyond deleting dead `useFetch.ts`. No dependency is duplicated. The 9-dependency runtime manifest is admirably small.

---

## 16. Architecture Alternatives

### Option A — Minimal Evolution
Keep stack and structure; fix FF1 (SSE wiring), FF2 (lazy routes), FF7/FF8 (store persistence/races), accessibility list, add the contract module when v2 ships.

- **Benefits:** lowest risk; every fix independently shippable; no relearning; all 328 tests remain valid.
- **Drawbacks:** the two-idiom data layer survives in diluted form; `App.tsx` gravity persists; contract migration is a big-bang later instead of incremental now.
- **Operational complexity:** unchanged. **Migration difficulty:** trivial. **Performance:** fixes the confirmed bottlenecks (bundle, polling).
- **When:** as Phase 0+1 of any path — always the first moves.

### Option B — Unified Server-State + Generated Contract (recommended)
Option A + **complete the react-query adoption** (every `api()`-in-`useEffect` becomes a query/mutation with defined keys), **introduce the `contract/` module now** (openapi-typescript against the frozen spec, thin typed wrapper replicating the 33-line `api()` semantics, coexisting with `@sonarly/shared` via a mapping layer), route splitting with a bundle budget, error boundaries, and the player/upload test harness. Cutover to v2 = point the wrapper at v2 paths + work the FF3/FF4 list with the backend track.

- **Benefits:** kills FF1's root cause rather than patching pages; the contract becomes compile-time real before v2 ships (drift surfaces as type errors, not runtime 404s); cache semantics unify; the S3-recommended codegen path is followed exactly; no new runtime dependencies.
- **Drawbacks:** ~4–8 weeks of incremental refactoring touching most pages (mechanical, test-backed); requires discipline to not redesign pages while converting them.
- **Operational complexity:** unchanged (still a static SPA served by the server). **Performance:** bundle split + cached server state. **Team implications:** one idiom to learn instead of two; contract-driven development becomes the norm.
- **Failure modes:** over-abstracting the wrapper (keep it ~50 lines); converting pages "while I'm here" scope creep — mitigate with per-feature PRs.
- **When:** the default choice. This is the 5-year-ownership answer.

### Option C — Radical Change (Next.js/SSR, Remix, TanStack Start; or an offline-first PWA rewrite)
Evaluated and **rejected**: the app is a session-authenticated, same-origin, single-container admin/client SPA behind a login; there is no SEO surface, no public content, no edge-delivery requirement. SSR would add a Node serving tier (or edge functions) to a product whose deployment truth is one container — the exact "infrastructure for architectural sophistication" the prompt forbids. An offline-first runtime (outbox, SQLite projections) was considered against the product reality: Sonarly *is* the server; the browser is a thin client over a LAN-reachable API. PWA install support (manifest already present) is a Could-do, not an architecture.

- **When:** only if the product ever gains public/SEO pages or a hosted (multi-tenant) offering — at which point this decision should be revisited from product requirements, not framework fashion.

**Recommendation: A immediately (Phase 0–1), B as the target state, C rejected with the above rationale recorded.**

---

## 17. Recommended Target Architecture

**A hardened SPA:** same runtime, same stack; the change is *inside* the data layer and the module graph.

Principles applied:

1. **One server-state layer** (react-query) with explicit query keys per domain; SSE invalidation reaches 100 % of server state by construction (this alone fixes FF1 permanently).
2. **The API contract is a module** (`contract/`): generated types + ~50-line wrapper; `@sonarly/shared` types are replaced behind it; runtime constants live in `contract/constants.ts` with a comment tying each to the server policy it mirrors.
3. **Client state stays in zustand** — player, theme, UI overlays — and holds *no server collections*.
4. **Routes split**; `App.tsx` becomes a route table + guards.
5. **Module boundaries are enforced** (§19) with a lint rule, not code review alone.
6. **Music-specific concerns stay first-class:** the player architecture (store-intent + element-controller + preloader) is preserved as-is; only its tests are added.

```text
Browser
  ▼
main.tsx (providers: QueryClient with defaultOptions, Notification)
  ▼
App.tsx ── lazy routes, three guard trees (setup / guest / app) — thin
  ▼
Layout ── TopBar · Sidebar · <main> · PlayerBar · AudioController · NowPlaying
  ▼
features/<domain>/pages ──▶ features/<domain>/hooks ──▶ react-query (queries/mutations)
                                              │
components/ (shared composites) ◀── components/ui/ (leaf)
                                              │
stores/ (zustand: player, theme, ui) — client state only
                                              │
contract/ (generated types + api wrapper + constants) ──▶ HTTP (/api, /rest, SSE)
```

**Cutover semantics:** `contract/` exposes `api.v1`/path constants initially generated from the v1 surface (or keeps the hand-types until v2 gaps close); when the backend lands FF3 endpoints, regenerate and flip — the wrapper's envelope/error semantics are already v2-shaped.

---

## 18. Proposed Directory Structure

Evolution of the actual tree — strangler-style, no big-bang move:

```text
packages/web/src/
  main.tsx                     bootstrap (add QueryClient defaultOptions)
  App.tsx                      ~80 LOC: guard trees + lazy route table only
  index.css                    tokens (unchanged)
  contract/                    NEW — the v2 contract module
    openapi-types.ts           generated: npx openapi-typescript (CI-checked)
    api.ts                     the ~50-line typed wrapper (envelope, 401 event)
    constants.ts               MAX_EXCLUDE_IDS, AUTO_DJ_* fallbacks, labels…
    index.ts                   re-exports; the ONLY import surface for data
  app/                         NEW (absorbs App.tsx's non-route body)
    guards.tsx                 SetupGate, GuestGate, RequireAdmin
    routes.tsx                 route table: path → lazy() component
    useBoot.ts                 /setup + /me boot query
  components/
    ui/                        leaf primitives (unchanged; Modal useId fix)
    (everything else stays, minus domain logic that belongs to features)
  stores/
    playerStore.ts             unchanged (persist; Q16 decision recorded)
    uiStore.ts                 theme + nowPlaying merged? — optional; keep split if preferred
    libraryStore.ts            selectedLibraryId ONLY, persisted (FF7)
  hooks/                       cross-feature hooks; delete useFetch.ts (Q2)
  features/
    <domain>/
      index.ts                 public barrel (pages + hooks)
      pages/  components/  hooks/
      api.ts                   per-domain query keys + query/mutation hooks (NEW pattern)
  lib/                         cn, format, shareToken, songPatch (unchanged)
```

Rules for what may **not** appear: no new `utils/` dumping ground (lib/ stays curated); no server data in zustand; no `api()` imports outside `contract/` and feature `api.ts` files; no static page imports in `App.tsx`; no cross-feature page imports (the NowPlayingRoute underlay resolves via route composition, not page imports — render the outlet route beneath the overlay instead of importing sibling feature pages).

---

## 19. Dependency Rules

```text
app/routes          may import: features (via barrels, lazy), app/guards, stores, lib
                    must never: import contract/, react-query directly
pages               may import: same-feature hooks/components, components/*, stores, lib
                    must never: import contract/ or react-query directly (goes through
                    the feature's api.ts), other features' internals (barrels only)
features/<x>/api.ts the ONLY place that imports contract/ + react-query per feature
                    owns query keys: ['songs'], ['albums'], ['playlist', id] …
components/         may import: components/ui, lib, stores (read), hooks
                    must never: import features/, contract/  ← current violation:
                    SponsorButton→usePreferences, PlayerBar→features/now-playing
                    (resolve: move those two consumers or hoist the shared hooks)
components/ui/      leaf: imports lib/cn only (already true) ✓
stores/             may import: contract/ (nothing today), lib
                    must never: hold server collections (libraryStore demoted, Q3)
contract/           imports nothing from src; generated + wrapper only
lib/                imports nothing from src ✓
```

**Cross-feature communication:** via barrels (existing convention) or, for data, via react-query's cache (feature A invalidates `['playlists']`; feature B's `usePlaylists` reacts) — never via module imports of another feature's internals. **Current violations to fix:** the `components/` ↔ `features/` edges listed above; 3 barrel bypasses in `App.tsx`; `NowPlayingRoute`'s page imports (resolved by the route-composition change in §18).

**Enforcement:** one `eslint-plugin-import`/`dependency-cruiser` rule set in CI, added in Phase 1 (the repo is already adopting ESLint repo-wide per the backend audit).

---

## 20. Migration Roadmap (phased, ordered against the v2 backend timeline)

Each phase ships independently and keeps `main` green (328 tests + CI as the net). Backend-track dependencies are marked **(BT)**.

**Phase 0 — Safety + quick wins (1 week, no contract work)**
- Add ErrorBoundary (FF10); delete `useFetch.ts` (Q2); persist `selectedLibraryId` (FF7); fix theme two-writer race (FF8/Q7); Modal `useId()` (Q14).
- Gate players polling on dropdown-open (FF6). Bundle-size CI metric (measure only).
- Rollback: independent reverts.

**Phase 1 — Server-state unification (2–3 weeks; runs parallel to v2 P9)**
- Convert hand-rolled pages to per-feature `api.ts` react-query hooks, one feature per PR (Tracks → Albums → Artists → genres/years/composers/labels → Home → SearchResults → admin).
- Add QueryClient `defaultOptions` (`staleTime 30s`, sensible retries); define the query-key registry; wire SSE invalidation to cover all keys (fixes FF1 by construction).
- Add the eslint boundary rules (§19); fix the components↔features edges.
- Tests: keep all 328 green; add one "refetch on library:changed" pin per converted idiom (test gap #4).
- Risk: medium (touches many files); mitigated by per-feature PRs and mechanical conversion.

**Phase 2 — Contract module + gap closure (2–4 weeks, interlocked with BT)**
- Land `contract/`: generate types from the frozen spec, implement the wrapper, migrate call-site generics feature-by-feature behind it; `@sonarly/shared` becomes runtime-constants-only, then moves into `contract/constants.ts`.
- **(BT)** Track FF3 gaps as backend blockers: favorites, ratings, libraries, preferences, lyrics, tags, cover-art upload, suggestions, lrclib/musicbrainz, organize, admin surfaces. The client proceeds on everything contracted; each BT endpoint landing = one small client PR.
- Handle FF4 breaks deliberately: upload octet-stream protocol (with tests — test gap #2), genreId resolution (fetch genre tree once, map name→id), `syncedLyrics` string|array narrowing, filePath display negotiation (admin-scoped field or removal), `PlaylistEntry` string semantics, scrobble body verification.
- Risk: the BT dependency is the schedule risk — escalate early, not at cutover.

**Phase 3 — Player/now-playing hardening (1–2 weeks; independent of v2)**
- AudioController wiring test harness (FF9); upload tests; NowPlayingRoute queue-rebuild fix (FF5 — lazy rebuild + shared context cache); route-composition underlay (removes page imports).
- Q16 decision: persist queue as ids+context with metadata rehydration, or cap length — record the decision either way.

**Phase 4 — Bundle + performance (1 week)**
- `lazyRoute()` all routes (FF2); manualChunks for react/vendor if measurably useful; bundle budget in CI (warn 450 KB / fail 600 KB entry raw JS); verify first-paint chunk on the login screen.
- Virtualization: **decide only when server pagination lands** (v2 `limit` params exist; a follow-up backend phase will expose cursors) — build the list strategy then.

**Phase 5 — Accessibility + polish (1 week, can interleave)**
- Keyboard context menus (FF11), chart text alternatives, combobox roles/aria-controls, now-playing focus management, toast politeness (§12 table).

**Phase 6 — Cutover rehearsal + flip (when BT signals parity, ahead of v2 P10 dual-run)**
- Regenerate `contract/` from the final spec; run the FF4 checklist end-to-end against a v2 dual-run instance (the backend's P10b provides exactly this); flip the wrapper base; keep v1 path constants tagged for instant rollback.
- The frontend rollback story is trivial (static build; redeploy previous image) — record it in docs/deployment.

---

## 21. Implementation Backlog

### Must do
| ID | Title | Evidence | Solution | Risk | Tests |
|---|---|---|---|---|---|
| FB-1 | Unify server state on react-query | FF1/Q1: SSE invalidation misses hand-rolled pages | §20 Phase 1 | Medium | invalidation pin per idiom |
| FB-2 | Route-level code splitting + bundle budget | FF2: 646 KB single chunk | lazyRoute + CI budget | Low | build-size assertion |
| FB-3 | Error boundaries | FF10: any crash whitescreens the app | boundary around main + player | Low | render-throw test |
| FB-4 | Contract module (codegen + wrapper) | §9: v2 replaces shared types | §20 Phase 2 | Medium | wrapper unit tests incl. envelope/401 |
| FB-5 | Track v2 contract gaps with backend | FF3: favorites/ratings/preferences/libraries/lyrics/tags/suggestions missing from spec | cross-track issue list | **Schedule (BT)** | n/a |
| FB-6 | v2 break fixes: upload protocol, genreId, syncedLyrics union, filePath, PlaylistEntry, scrobble body | FF4 | Phase 2 items | Medium | upload protocol tests; lyrics union test |
| FB-7 | AudioController test harness | FF9 | media-element stub dispatching events | Low | threshold/ended/stall/autoplay cases |
| FB-8 | Persist selectedLibraryId | FF7 | zustand persist | Low | store test |
| FB-9 | Fix theme two-writer race | FF8 | preferences as single source | Low | store/sync test |
| FB-10 | Gate players polling | FF6 | poll on open only | Low | hook test |
| FB-11 | Delete useFetch.ts | Q2 | delete | None | — |
| FB-12 | ESLint + import boundary rules | §19, backend audit F11-adjacent | repo-wide config + CI | Low | — |

### Should do
- NowPlayingRoute lazy rebuild + route-composition underlay (FF5/Q6) · keyboard context menus + modal useId + chart alternatives + now-playing focus (§12) · shuffle-albums batch endpoint request (**BT**) · self-host fonts (§13) · `user-event` + coverage baseline (§14) · query-key registry doc · per-feature `api.ts` convention documented in agents/ · admin pages converted with Phase 1.

### Could do
- `useCurrentUser()` hook to replace `user` prop drilling · merge themeStore into a uiStore · view-mode persistence per page in URL · PWA install polish (manifest exists) · MSW fixture layer fed by contract examples · volume-to-preferences sync (if product wants cross-device) · react-query devtools in dev builds · `@mdi` sprite hash-busting (`?v=2` is manual today).

### Do not do
- SSR / Next.js / Remix / TanStack Start (§16 C) · a second state library or replacing zustand/react-query · Web Audio gapless rewrite (§10) · list virtualization before server pagination (§11) · micro-frontends · a homegrown design-system package (the tokens + primitives layer is already the right weight) · GraphQL · orval/client-class codegen (rejected in S3; react-query hooks are already the idiom) · replacing wouter (nothing it lacks is needed) · offline-first sync runtime (product is the server) · rewriting the player store's queue model to ids-only *before* Q16 is decided.

---

## 22. "Do Not Overengineer" List

1. **No SSR/meta-framework** — session SPA, no SEO surface, one-container deployment; SSR adds a serving tier for nothing.
2. **No offline-first/PWA sync engine** — Sonarly is the server; the browser is a thin client. The existing manifest suffices for installability.
3. **No Web Audio / MSE gapless pipeline** — the cache-warming preloader + Media Session is the correct 90 % solution; sample-accurate gapless has no demonstrated demand.
4. **No list virtualization yet** — the server caps lists at 500 rows; virtualize when (and only when) server pagination ships.
5. **No orval / client-class codegen layer** — `openapi-typescript` types + the existing thin-hook pattern, per the S3 spike's own recommendation.
6. **No new state containers** — four zustand stores + react-query is the complete inventory; any fifth store needs a written justification.
7. **No design-system package extraction** — tokens + 10 primitives in-repo is right-sized; publish nothing until a second consumer exists.
8. **No MSW until fixture reuse demands it** — per-test `vi.mock` of `lib/api` is adequate at 39 files.
9. **No e2e suite (yet)** — the API contract tests + unit culture carry the risk; revisit after the first post-v2 regression that a unit test would have caught.
10. **No micro-frontend / module-federation anything** — one team, one deployable.

---

## 23. Top 10 Highest-Value Improvements (grouped, not ranked)

**Critical (correctness/contract — do first):**
1. **Unify server state on react-query** (FB-1) — makes the existing SSE invalidation actually cover the app; fixes the stale-after-scan defect class permanently rather than per page.
2. **Stand up the contract module and track the v2 gap list with the backend** (FB-4/FB-5) — the whole point of Track 3: the client migrates *with* the contract, not after it.
3. **Work the FF4 break list deliberately** (FB-6) — upload protocol, genreId, lyrics union, filePath: small items that become big at cutover if discovered late.

**High priority:**
4. **Route-level code splitting + bundle budget** (FB-2) — halves effective first paint; pays for every future feature by not shipping it to login.
5. **Error boundaries** (FB-3) + AudioController test harness (FB-7) — protect the two things users notice instantly: a white screen, and broken playback.
6. **Fix the small-store defects** (FB-8/9/10, Q14) — persistence reset, theme race, polling, modal ids: a week's worth of correctness polish.
7. **Now-playing deep-link rework** (FF5) — removes the O(section) refresh fetch and the cross-feature page imports in one change.

**Medium priority:**
8. **Accessibility list** (§12) — keyboard menus, chart alternatives, focus management: concrete, bounded, verifiable.
9. **Testing extensions** (§14) — upload/queue-rebuild/guest-flow coverage + user-event + a real coverage baseline.
10. **Docs reconciliation** (FF12) — ui-components inventory (~35 shared + feature components), technology-stack (react-query/dnd-kit), the barrel violations — the docs culture here is good; the drift is recent and cheap to fix in the later pass.

---

## 24. Questions / Unknowns

1. **v2 scheduling for the FF3 gap list** — which phase lands favorites/ratings/preferences/libraries/lyrics/tags/suggestions/organize/admin surfaces? The client migration's critical path runs through it. (Owner: backend track; the S3 doc already flags avatars.)
2. **Queue persistence intent (Q16)** — is a cross-device/refresh-resumable queue a product goal (argues for ids+context rehydration against v2 bookmarks) or is local-only fine (cap the persisted queue)? Product decision.
3. **Server pagination timeline** — when v2 exposes cursors for songs/albums, the client's list strategy (pagination UI vs incremental) needs a product answer (jump-to-letter? infinite scroll?). Determines when/if virtualization ever happens.
4. **Is the `filePath` display in EditEntityModal / Conflicts / Missing an admin-essential feature?** It conflicts with v2's deliberate DTO hygiene; needs a product call (admin-scoped field vs removal) before Phase 2.
5. **Native-contextmenu suppression (`App.tsx:97-114`)** — deliberate product polish or leftover? Determines whether Q15 documents it or scopes it.
6. **Players polling → SSE events** — will v2 emit player activity over `/api/events` (P8 built SSE for all-client players via Recorder)? If yes, FF6's fix is event-driven, not polling-gated. Backend question.
7. **Was the stale persisted-queue metadata (§4 stale-data risks) observed in practice?** localStorage `sonarly-player` from an older build would reveal whether rehydration drift is real or theoretical for existing users.
8. **`docs/README.md` linking of this report** — Appendix B prescribes linking the audit from the docs index; deferred with this file's creation per track instructions (single-file constraint). One-line follow-up in the docs pass.
9. **Google Fonts licensing/offline posture** — is an external CDN request acceptable for this self-hosted product today (§13), or is self-hosting a stated goal? Decides whether the fonts item is Should or Could.

---

*End of audit. No production code was modified during this assessment. Test suite executed: 39 files / 328 tests passing (10.89 s).*
