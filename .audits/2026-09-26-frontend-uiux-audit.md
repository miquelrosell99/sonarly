# Sonarly Frontend UI/UX Audit (web/)

**Date:** 2026-09-26
**Scope:** `web/` — React 18 + Vite 6 + TypeScript strict + Tailwind 3 + zustand + @tanstack/react-query 5 + wouter + dnd-kit. All components, stores, hooks, contexts, routes/pages, contract layer, styling/a11y surface, tests, build/perf, security. Server files consulted only where the UI contract depends on them (playback stream param, cover-art gating, catalog response shapes, SSE broker contract).
**Method:** six parallel subsystem deep-dives (Component Architecture + State; Player; Routing + Pages + List Rendering; Styling + Design System + Accessibility; Data Layer + API Contract + Errors; Testing + Performance + Security), each read-only with the suite executed by the subagents: **70 test files / 467 tests passing (~30.4s)**, `pnpm build` green with the bundle-budget gate passing (entry 212.6 KiB raw / 59.3 KiB gzip vs 250 KiB budget; total 688.3 KiB vs 900 KiB; 44 chunks). The coordinator then independently re-verified the load-bearing evidence in the repo (grep/read of cited files; the built `dist/` entry chunk inspected to confirm the dnd-kit import). Facts are code-verified; inferences are labeled; contrast figures are *computed from token HSL values*, not measured in a browser.
**Corrections to the subsystem reports:** one claim is retracted in this synthesis — the components subsystem reported `components/ui/Table.tsx` as dead code ("zero non-test consumers"). Verification found 8 production consumers (`SongTable`, `UploadModal`, `Ingest`, `AdminLibraries`, `AdminUsers`, `AdminSystemTasks`, `MissingModal`, `IngestModal`). The legitimate Table finding — no virtualization, and selection logic duplicated against `LibraryView` — is retained as F23. All other spot-checked references held.
**Status:** No code was modified for this audit. One file created (this report); implementation plan in `2026-09-26-frontend-uiux-plan.md`.

---

## 1. Executive Summary

Sonarly's post-migration web client is a **fundamentally healthy, production-grade React application with a small number of high-impact defects — not a frontend in crisis.** The v1→v2 migration is essentially complete and honest: no `cacheEpoch` remnants, all 33 routes lazy-loaded with route-shaped fallbacks, a bundle-budget gate wired into `pnpm build` that cannot be bypassed silently, a generated OpenAPI contract that regenerates byte-identical, and 467 passing tests in ~30 seconds.

The headline conclusion is two-sided:

**The engineering core is excellent.** The player state machine (`playerStore.ts`, 30 tests) is exemplary; `AudioController.tsx` handles the genuinely hard cases (autoplay blocks, AbortError, stall detection, gapless pre-warm, Media Session) with careful, well-commented code; the scrobble percentage fix is defended in depth on both sides of the wire. The design system has real discipline — zero raw hex in TSX, a token architecture with three themes and ten accents, and reduced-motion handling that is genuinely complete (CSS dampener + per-animation opt-outs + JS `matchMedia` checks + WAAPI skip). Accessibility is practiced, not aspirational: a skip link, focus traps with restore, arrow-key menus with roving focus, `aria-valuetext` on the seek slider, 44px coarse-pointer targets. Security is a clean sheet: no `dangerouslySetInnerHTML` anywhere, share tokens confined to URL query + scoped API calls (never to error reporting), and a production dependency surface of seven packages with zero known vulnerabilities.

**But the client-server contract has silently broken the guest experience, and the data-layer migration is only half-landed.** Share-link playback — the feature that lets a user send their playlist to a friend — is broken end-to-end: the client sends `?shareToken=` to a server that reads `?share=`, so every guest track hits a 401; guest cover art 401s the same way; and a guest who taps the cover art to open Now Playing gets bounced to `/login` because navigation drops the token. Inside the app, entity detail pages (Track/Album/Artist) were left behind by the react-query migration and carry a whole class of defects — sticky error states, navigation races, no caching, no retry — that the migrated list pages don't have. The SSE bridge has a reconnect hole that contradicts the server's own documented contract. Theme/accent preferences are lost on every cold boot. There is no scroll restoration anywhere, which makes the core drill-down loop of a music browser (list → detail → back) land at the top every time.

None of this is architectural. Every finding has a small, local fix, and the plan companion orders them by impact × risk × effort. The verdict: **keep the stack, finish the migration, restore the guest flows first.**

---

## 2. Current Architecture

```text
Browser ── index.html (pre-hydration bootstrap: theme-mode + accent-blue/cyan)
  │
  ▼
main.tsx ── QueryClient (unconfigured defaults) ── NotificationProvider
  │        ── useTheme.getState().apply()          (toasts; ALL toasts role="alert")
  ▼
App.tsx ── boot: GET /api/setup + /api/me (parallel; 401 → login, network → retry UI)
  │      ── sonarly:unauthorized listener (any 401 → /login)     [no queryClient.clear()]
  │      ── global error/unhandledrejection → POST /api/client-errors (path only)
  │      ── wouter Switch: 33 routes, ALL lazy (lazyRoute + skeleton fallbacks)
  │      ── ErrorBoundary inside each tree; player chrome survives route crashes
  │      ── useServerEvents → EventSource /api/events
  │           onmessage: library:changed → invalidate 8 query prefixes + DOM event
  │           onerror: NO-OP  ← reconnect hole (server comment assumes refetch)
  ▼
Layout (auth shell)
  ├─ TopBar ── SearchBox (combobox; own search query family)
  │           · filter data: own ['albums'|'songs', libId] query keys  ← duplicate families
  │           · PlayersDropdown · UserMenu · UploadModal (XHR chunks, no abort)
  ├─ Sidebar ── LibrarySelector (libraryStore: selection persisted, list in zustand
  │           │  ← hand-rolled loadLibraries, no invalidation, error never rendered)
  │           └─ playlists (react-query, no staleTime → refetch every mount)
  ├─ <main> pages — two data idioms:
  │     A) react-query …… useLibraryLists families (30s staleTime, keepPreviousData,
  │        patchItem), usePlaylist(s), usePreferences, search results
  │     B) hand-rolled useState + api() …… Track/Album/Artist detail, HomePage,
  │        Organize, all admin pages  ← sticky errors, races, no cache, no retry
  ├─ PlayerBar (14 store selectors; transport; Auto DJ; sleep timer; queue modal)
  │   └─ QueueModal → QueueList → LibraryView → @dnd-kit   ← drags dnd-kit into entry
  ├─ AudioController (<audio> + gapless preloader + Media Session + scrobble)
  │   streamUrl(): /api/stream/<id>?shareToken=…   ← server reads ?share= (BROKEN)
  └─ NowPlaying overlay (always mounted; SyncedLyricsEditor ~600 LOC in entry by design)
       └─ QueuePanel / LyricsPanel / FetchLyricsModal / SyncedLyricsEditor

State:
  zustand ×4: playerStore (persist: queue/index/context/volume/shuffle/repeat — Strong)
              nowPlayingStore (overlay UI — Strong)
              themeStore (NOT persisted; accent/mode lost on boot — F3)
              libraryStore (mixed: selection persisted, server list in-store — F15)
  react-query: server state; two parallel key families for albums/songs/search (F12)

HTTP — three flavors, two layers:
  lib/api.ts   ~65 call sites; plain Error (no status discrimination); 401 → sonarly:unauthorized
  contract/wrapper.ts  typed, tested (11 cases) — ZERO production consumers (F16)
  contract/schema.ts   generated, fresh — imported by no one (F17)
  ProfileForm.tsx raw fetch (3rd flavor; bypasses the 401 dispatch) (F29)
```

---

## 3. Per-Dimension Assessments

Grades: **Strong** · **Acceptable** · **Needs improvement** · **High risk**. Evidence cited per row; findings cross-referenced.

| # | Dimension | Grade | Basis (evidence) |
|---|---|---|---|
| D1 | Component architecture | **Acceptable** | 45 components. Real primitives (`Modal.tsx:42-72` trap+restore, `VirtualGrid/List`, `ErrorBoundary` + `reportClientError`) vs. three hotspots: `EditEntityModal.tsx` 887 LOC god component (F22), four reimplemented popover menus (~700 LOC, F21), mixed concerns in `TopBar.tsx`. |
| D2 | Client state (zustand) | **Strong** (1 exception) | `playerStore.ts` pure transitions + minimal persist surface + rehydrate repair + 30 tests; `nowPlayingStore` clean. `libraryStore.ts` straddles server/client (F15); `themeStore` boot defect (F3, High risk). |
| D3 | Server state (react-query) | **Needs improvement** | Lists are excellent — documented key families (`useLibraryLists.ts:1-23`), `keepPreviousData`, 30s staleTime, `patchItem`, SSE prefix invalidation mirroring the families. But detail pages + HomePage + admin are hand-rolled `useState`+`api()` (F7), invalidation completeness is the weakest area (F11), two parallel key families (F12), cache never cleared on user switch (F6). |
| D4 | Player subsystem | **Strong** core; **High risk** guest surface | Queue/shuffle model clean (`shuffledIndices` consistently maintained); scrobble rule exact (`min(50%, 4min)`, double-submit guard, repeat-one pre-reset `AudioController.tsx:306-310`); `getNextSong` single oracle shared by preloader and `next()`; Media Session complete + defensive. Gaps: missing `onPause` sync + stall-timer false error (F13), replay scrobble hole (F14), no resume despite shipped bookmark API (question Q3), and the Critical guest-stream/cover regressions (F1). |
| D5 | Routing & code splitting | **Strong** | 33 routes lazy with shaped Suspense fallbacks (`App.tsx:24-37`); comment accurately describes chunk strategy; every Switch inside ErrorBoundary so player survives crashes (`App.tsx:361`); boot/auth flow differentiates 401 from network failure with retry UI (`App.tsx:287-306`). Gap: no scroll restoration at all (F8). |
| D6 | List rendering / virtualization | **Strong** design; **Needs improvement** coverage | Selection lives in `LibraryView` (survives windowing — tested `LibraryView.virtualization.test.tsx:82`); dnd/grouped exclusion explicit and tested (`LibraryView.tsx:352-355`); graceful unwindowed fallback; lazy cover art. But windowing only exists in `LibraryView` and only >150 items: `SongTable`→`ui/Table` (album detail, playlist detail up to 500 rows) and `TrackList`/`AlbumList` render everything (F23). |
| D7 | Styling & design system | **Strong**; one **Needs improvement** | Zero raw hex/rgb in TSX; 19 tokens × 3 themes × 10 accents mapped once into Tailwind; `text-bg-primary`-on-`bg-accent` trick passes contrast both directions; slider CSS careful (24px forced hit area, hover-guarded thumb, `-moz-range-progress`); hover-reveal contract verified in code. Light-mode `--danger`/`--success` fail WCAG AA (F10); accent default contract broken across code/bootstrap/docs (F3 facet). |
| D8 | Accessibility | **Acceptable→Strong** practices; two systemic gaps | Focus-visible on every `outline-none` (verified by full grep); reduced-motion exemplary (CSS + JS + WAAPI skip `NotificationContext.tsx:38-41`); context-menu keyboard contract (Shift+F10, Escape restores focus); statistics charts carry a real SR story. Gaps: light-mode contrast (F10), all toasts assertive + no now-playing announcement (F26), sub-24px desktop targets + APG menu deviations + no overlay focus trap (F27). No blockers. |
| D9 | Testing | **Strong** culture; one **High risk** gap | Per-hook discipline, SSE edge cases, virtualization with faked layout, budget gate has its own tests, sound mock strategy (`vi.hoisted`, instance registries, `retry:false`). `AudioController.tsx` — the most failure-prone file — has zero tests (F9). `appsmoke.diag.test.tsx` burns 29s of the 30s suite and cannot fail in CI (F28-batch, plan Phase 0). |
| D10 | Performance | **Acceptable** | Budget gate green and enforced; initial JS ≈ 481 KiB raw / ~148 KiB gzip (healthy); no `setInterval` progress loop. Needs improvement: dnd-kit (45.9 KiB raw / 15.3 KiB gzip) statically in the entry chunk including `/login` (F19); full `PlayerBar` footer reconciles ~4×/s on `timeupdate` (F20). |
| D11 | Security | **Strong** | Zero `dangerouslySetInnerHTML`/`innerHTML`/`target="_blank"` in src; session cookie `credentials:'include'`; no tokens in JS storage; share token never leaves URL/query-scoped calls (client-error report sends pathname only, `ErrorBoundary.tsx:19`); 7 runtime deps, `pnpm audit --prod` clean. Note: no CSP (server-header concern, out of web scope). |
| D12 | Docs & cross-cutting consistency | **Needs improvement** | `docs/design-language.md:33,37` + `agents/design-language.md:6` document a blue/cyan default accent the code abandoned (F3); `docs/architecture.md:96` claims the generated contract is the live API layer (F16); two components named `PlayButton` with different semantics (F29); four menu implementations with divergent a11y wiring (F21). |

---

## 4. Findings Catalog

Severity: **Critical** (user-visible production breakage) · **High** (defect class, privacy, or largest UX gap) · **Medium** (real harm, bounded) · **Low** (hygiene/consistency). "Sources" lists the subsystem reports that flagged the issue (deduplicated). Every location was either verified directly during synthesis (marked ✔) or reported by a subsystem that read the code and ran the suite (marked ▸).

### Critical

---

**F1 — Guest share-link playback is broken end-to-end: query-param mismatch between client and server, plus session-gated cover art.** ✔
**Location:** `web/src/components/AudioController.tsx:21-26` (`streamUrl()` sends `/api/stream/<id>?shareToken=…`; the gapless preloader uses the same URL); `server/internal/modules/playback/routes.go:95` (handler reads only `q.Get("share")`); `server/internal/modules/playback/service.go:119-123` (anonymous + empty share → 401); `server/internal/modules/catalog/routes.go:44-57` (`/api/cover-art/{id}` sits behind `AuthMiddleware, RequireAuth` with no token consult); `web/src/components/CoverArt.tsx:33` (client sends `?shareToken=`).
**Behavior:** (fact) Every anonymous stream request 401s because the parameter names disagree; the hidden preloader 401s identically. Guest cover art 401s because the route is fully session-gated; `CoverArt.onError` silently swaps to the placeholder icon, and guest Media Session notifications show no artwork.
**Why it matters:** Share links are the product's only sharing mechanism; a guest opening one sees an unplayable playlist with blank artwork. Regression from v1→v2 cutover: v1's Fastify handler read `?shareToken=` (`packages/server/src/features/songs/routes.ts:633` @ `73b22ab`, git-verified by the player subsystem); v2 renamed to `?share=` and the client was never updated. The server's own naming is inconsistent — `/api/playlists/{id}` and OpenSubsonic accept `shareToken` (`playlists/routes.go:57`, `opensubsonic/auth.go:42`) — which is likely how the client got orphaned.
**Evidence:** code-verified both sides this session; H1/H2 of the player subsystem.
**Sources:** Player (H1, H2), Data layer (withShareToken call-path audit).

---

**F2 — Guest "open Now Playing" navigation drops the share token and bounces the guest to /login.** ✔ (code chain) / inference (user impact)
**Location:** `web/src/components/PlayerBar.tsx:61-71` (`handleOpenNowPlaying` builds `setLocation('/now-playing/…')` with no token); `web/src/App.tsx:348-350` (the guest now-playing route gate re-reads `getShareToken()` from the URL and redirects to `/login` without it); `web/src/features/now-playing/pages/NowPlayingRoute.tsx:155` (guests are excluded from the auto-open path, so the manual tap is the only path); `NowPlayingRoute.test.tsx` has zero shareToken/guest cases (grep-verified).
**Behavior:** (fact) A guest playing a shared playlist sees the full `PlayerBar` (`GuestPlaylist.tsx:8-27` renders it); tapping the cover art navigates to `/now-playing/playlist/…` *without* the query string; the route gate then finds no token and redirects to `/login`.
**Why it matters:** The one interactive path that makes a shared link feel alive — tap artwork, see the big player — ejects the guest from the app entirely. No test exercises any guest navigation flow.
**Evidence:** full code chain verified this session; end-user impact inferred from the chain (no runtime verification against a live server was possible).
**Sources:** Testing/Perf/Security (F3), Routing (guest route tree).

---

### High

---

**F3 — Theme/accent preferences are lost on every cold boot; the accent contract is broken across code, pre-hydration bootstrap, and docs.** ✔
**Location:** `web/src/stores/themeStore.ts:46-84` (no zustand persist; the only localStorage write is resolved-mode-only at `:79`); `web/src/main.tsx:21` (post-hydration `apply()` strips the bootstrap classes and applies `accent-monochrome` per `resolveAccent` `:39-44` with defaults `'auto'` at `:47-48`); `web/index.html:34` (pre-hydration bootstrap applies `accent-blue`/`accent-cyan` — a visible accent flip on first paint, unconditional because the accent is never persisted); `web/src/hooks/usePreferences.ts:26-27` (only writers of server-stored prefs into the store — fire only after a mutation); FF8 comments at `usePreferences.ts:19-23`, `Layout.tsx:65-67`, `SettingsAppearance.tsx:32-34` confirm the boot push was removed and never replaced. Doc drift: `docs/design-language.md:33,37`, `agents/design-language.md:6` still document blue/cyan defaults.
**Behavior:** (fact) After reload: accent reverts to monochrome regardless of the stored preference, OLED/light choice reverts to `matchMedia`, and Settings → Appearance shows "Auto" until the user re-saves. Two secondary defects in the same function: `resolveAccent`'s `resolvedMode` parameter is unused (dead branch), and `accent-auto` is listed in `accentClasses` (`themeStore.ts:27`) but has no CSS rule (`index.css:108-116`).
**Why it matters:** A shipped, user-facing preference silently resets every session; the first-paint accent flip makes the app visibly re-theme itself on every cold load. The code comment records monochrome as a deliberate owner decision *today* (2026-09-26), so the docs and bootstrap are the stale side — but a decision must be recorded (see Q1).
**Sources:** Components/State (F1), Styling/A11y (M2 + drift report).

---

**F4 — Now-playing album deep links crash: client reads `detail.album.songs`, server returns top-level `songs`.** ✔
**Location:** `web/src/features/now-playing/pages/NowPlayingRoute.tsx:21-23` (`AlbumDetailResponse { album: { songs } }`), `:105-107` (`songs = detail.album.songs`), `:114` (`songs.length` throws on `undefined`); server `server/internal/modules/catalog/routes.go:172-182` returns `{"album": album, "songs": songs}` (verified this session). The playlist branch (`detail.playlist.entries`) matches the real shape; album and the songs-filter branches were not aligned with v2 responses.
**Behavior:** (fact) Cold-opened `/now-playing/album/…` links (cleared queue, or songId not covered by the persisted queue) fetch the album, then throw `Cannot read properties of undefined (reading 'length')`, surfaced as the page error state. Masked on refresh only because queue+context persist.
**Why it matters:** Shared/cold now-playing links for albums crash — one line plus a test. `NowPlayingRoute.test.tsx` exists and doesn't cover the album cold-load path.
**Sources:** Routing (F1).

---

**F5 — SSE reconnect hole: lost invalidations are never recovered, contradicting the server's documented client contract.** ✔
**Location:** `web/src/hooks/useServerEvents.ts:60-64` (`onerror` is a no-op comment); `server/internal/modules/events/broker.go:11-14` (verified: "No replay… The client refetches on reconnect (the web app's useServerEvents hook already does)").
**Behavior:** (fact) The server deliberately buffers nothing and drops events for slow clients; the browser auto-reconnects the EventSource silently; no invalidation runs on reconnect. Any `library:changed` events during a disconnect/restart window are silently unrecoverable → indefinite stale library data on a healthy-looking connection.
**Why it matters:** This is the designed-in recovery path for the entire server-push architecture, on both sides of the wire — and it was never implemented on the client. ~5 lines.
**Sources:** Data layer (F1).

---

**F6 — react-query cache is never cleared across user switches; per-user data bleeds between accounts.** ✔ (grep-verified) / inference (exploitability)
**Location:** `web/src/App.tsx:221-225` (the `sonarly:unauthorized` handler navigates to login without touching the cache); `web/src/main.tsx:9` (module-level QueryClient); grep across `web/src` for `queryClient.clear|removeQueries|resetQueries` finds only a test (`LyricsPanel.test.tsx:23`).
**Behavior:** (fact) Starred flags, ratings, preferences, and search history of user A remain in the query cache and are displayed — deliberately via `keepPreviousData` — while user B's fetches are in flight, and persist until natural eviction.
**Why it matters:** On a shared browser profile (family machine, demo, kiosk — realistic for a self-hosted multi-user app) the next account sees the previous account's library interactions. Privacy defect, one line each at logout and login.
**Sources:** Data layer (F3).

---

**F7 — Entity detail pages (Track/Album/Artist) are hand-rolled outside react-query: sticky errors, navigation races, no caching, no retry.** ✔ (Track; Album pattern identical) / ▸ (Artist)
**Location:** `web/src/features/tracks/pages/Track.tsx:39-50` (`load()` never clears `error`; mutations write the same `error` slot at `:58,68` → `EntityDetail.tsx:47-49` renders the error branch even while data loads underneath, until a *different route* remounts); `web/src/features/albums/pages/Album.tsx:86-99` (same pattern); `Artist.tsx:53-66`; no cancellation/sequencing (fast A→B navigation clobbers state); no query cache → full spinner on every back-navigation; `EntityDetail` has no `onRetry` prop (`EntityDetail.tsx:8-23`) though `PageState.tsx:55-59` supports one. Invalidation: Track delete (`Track.tsx:96-99`) navigates without invalidating `['songs']` — a deleted track reappears when the list cache is <30s fresh; Album edits/deletes never invalidate `['albums']`/`['songs']`.
**Behavior:** (fact) One transient failure (e.g., a favorite toggle on a flaky connection) bricks the page into its error state for the session; the list→detail→back loop renders a full loading state twice per iteration.
**Why it matters:** This is the exact pattern the FF1 migration removed from lists, left in place on the pages users drill into most; it is a defect *class* (four bugs share one root). The 30s staleTime + SSE are only partial mitigations (whether tag edits emit `library:changed` is server-side and unverified — Q2).
**Sources:** Routing (F2–F5, F12), Components/State (F4, F5).

---

**F8 — No scroll restoration: every navigation resets to top, including when closing the Now Playing overlay.** ✔
**Location:** `web/src/components/Layout.tsx:50-63` (the only scroll code in the app is the unconditional reset; grep for `scrollRestoration` finds nothing else); `NowPlayingRoute.tsx:174-187` (closing the overlay navigates back to `returnPath` *after* `isOpen` flips false, so the reset fires there too — the user always returns to the top of the underlying page). The overlay itself is handled thoughtfully (`Layout.tsx:53-63`).
**Behavior:** (fact) Back from a track detail to a 5,000-track list lands at the top and the virtualizer re-renders from offset 0.
**Why it matters:** For a browsing-heavy music UI this is the single largest navigation-UX gap: it punishes the app's core interaction loop on every single drill-down.
**Sources:** Routing (F7).

---

**F9 — `AudioController.tsx` — the most failure-prone module in the app — has zero direct tests.** ✔
**Location:** `web/src/components/AudioController.tsx` (349 lines: scrobble threshold `:271-298`, stall timer `:235-262`, gapless preload `:116-139`, seek sync `:141-150`, Media Session `:153-225`, sleep-timer end-of-track `:300-322`, autoplay-block handling `:63-75`); grep confirms no `AudioController.test.*` exists. The store beneath it has 30 tests; the wiring above it has none. Media-element stubbing precedent exists (`appsmoke.diag.test.tsx:55-58`).
**Why it matters:** Every one of these code paths has bug-fix-shaped comments (regression-prone), and a silent regression here hits production users directly (scrobbles lost, false errors, broken autoplay). Highest-impact test gap in the codebase.
**Sources:** Testing/Perf/Security (F1), Player (L1).

---

**F10 — Light-mode `danger` and `success` text fail WCAG AA contrast.** ▸ (computed from token HSL, not browser-measured)
**Location:** `web/src/index.css:31-33` (light theme: `--danger: 0 84% 60%`, `--success: 142 71% 45%`). Computed on `--surface` (#FFF): danger ≈ **3.8:1**, success ≈ **2.3:1** — both below 4.5:1 for the 14px text they render as. Observed usages: `.btn-danger` label (`index.css:156`), the success/error toast body (`NotificationContext.tsx:95-98` — the whole card inherits the semantic text color), and `role="alert"` error paragraphs in ~12 files (e.g. `UploadModal.tsx:337`, `ProfileForm.tsx:146`). The `.btn-danger` *hover* inversion (`bg-danger text-bg-primary`) computes ≈3.4:1, also failing. Dark/OLED variants pass (5.4:1 / 10.2:1).
**Why it matters:** Error and confirmation messages are exactly the text users most need to read; in light mode they are unreadable to a low-vision audience. One-token fix, verify across all three modes (the design language's fixed status constrains hues, not lightness — see plan).
**Sources:** Styling/A11y (M1).

---

### Medium

---

**F11 — Playlist favorite/rate mutations never reach the UI; errors are swallowed behind a factually wrong comment.** ✔
**Location:** `web/src/features/playlists/pages/Playlists.tsx:44-58` and `PlaylistDetail.tsx:115-131` call `setFavorite`/`setRating` but never patch or invalidate `['playlists']`/`['playlist']` — `useFavoriteActions.ts:17-32` is a bare `api()` wrapper with **no notification code** (verified this session), making the comment "Error is already surfaced by the action hook via notifications" false. Songs/albums/search do this correctly via `patchItem`/`patchResult` (`Tracks.tsx:68-75`, `SearchResults.tsx:106-139`).
**Behavior:** (fact) The star toggle on a playlist silently never updates — the button appears dead until an unrelated refetch — and a failed toggle fails completely silently.
**Sources:** Routing (F5), Data layer (F4).

---

**F12 — Two parallel query-key families for the same albums/songs/search data.** ✔ (keys verified)
**Location:** `web/src/components/TopBar.tsx:293,301` (`['albums', libId]`, `['songs', libId]` hitting the same list endpoints as `['albums','list',params]`/`['songs','list',params]`, with divergent 60s staleTime and no `keepPreviousData`); `web/src/components/SearchBox.tsx:21` (`['search', query, libId]`) vs the results page's `['search','results',…]` (`useLibraryLists.ts:169`).
**Behavior:** (fact) The same payloads are fetched and cached twice — the TopBar `/songs` filter-options fetch can be the entire library; Enter in search re-downloads data the preview already fetched. Correctness survives because prefix invalidation matches both families, but bandwidth, memory, and two staleTime conventions for "the same" data are the cost.
**Sources:** Components/State (F2), Routing (F19), Data layer (F7).

---

**F13 — Pausing during a stall window produces a spurious "Playback stalled" error; missing `onPause` handler desyncs store and Media Session.** ✔
**Location:** `web/src/components/AudioController.tsx:254-262` (stall timer armed on `waiting`/`stalled` while playing); the only cancel paths are `timeupdate`/`play`/`playing`/`error`/unmount (`:275,245,250,301,325`) — the pause path never clears it; the rendered `<audio>` (`:332-344`) has **no `onPause` handler**.
**Behavior:** (fact, reproducible from code) User pauses while buffering → 15s later `setStatus('error')` + "Playback stalled — check your connection" fires anyway. Separately (fact of absence; impact inference): element-initiated pauses (OS audio interruptions, some headphone disconnects) leave the store and Media Session `playbackState` saying `playing`.
**Sources:** Player (M1, M2).

---

**F14 — Scrobble guard misses replays that don't change the song id.** ▸
**Location:** `web/src/components/AudioController.tsx:278,288,306-310` — `lastScrobbledRef` resets only in the `[currentSong?.id]` effect and the repeat-one branch. Replaying the *same* song via `playNow(currentSong)`, or pressing play after queue-end idle (element restarts from 0 per spec), replays the full track but never re-scrobbles.
**Behavior:** (fact) Silent listening-history loss in narrow but real scenarios.
**Sources:** Player (M3).

---

**F15 — `libraryStore` holds server state in zustand: stale sidebar selector after admin CRUD; load error never rendered.** ✔ (store; refresh-path ▸)
**Location:** `web/src/stores/libraryStore.ts:25-34` (hand-rolled `loadLibraries`), `:48-50` (FF7 comment: the list "must not survive in storage" — yet lives in zustand with no invalidation/staleTime/dedup); `web/src/components/TopBar.tsx:388-390` (only refresh trigger is TopBar mount; `:389` swallows errors); `web/src/features/admin/pages/AdminLibraries.tsx:130/176/198` (CRUD invalidates only admin keys, never the store). Dead exports verified this session: `getSelectedLibrary`/`getSelectedLibraryId` (`libraryStore.ts:55-63`) have zero call sites.
**Behavior:** (fact) A library created/renamed/deleted in admin doesn't appear in the TopBar selector until reload; a failed libraries load shows no error anywhere.
**Sources:** Components/State (F6), Data layer (F9/F10).

---

**F16 — The generated-contract runtime layer is dead code, the docs claim it's live, and two HTTP layers with incompatible error classes now coexist.** ✔ (consumers; docs) / ▸ (wrapper quality)
**Location:** `web/src/contract/wrapper.ts` (147 lines, 11 passing tests) has **zero production consumers** — grep finds only `wrapper.test.ts`; `contract/schema.ts` (6,524 lines) is imported by nothing; all ~65 runtime call sites use `web/src/lib/api.ts`, which throws plain `Error` (no programmatic status discrimination) while the wrapper throws `ApiError` — `instanceof` discrimination silently breaks if both are ever used together. `docs/architecture.md:96` claims "API access through `src/contract/`" (verified stale this session). CI (`.github/workflows/ci.yml:35-39`) builds + tests but never checks `contract:gen` idempotency (regeneration verified byte-identical by the data-layer subsystem).
**Why it matters:** The worst outcome — a documented-but-dead canonical layer — misleads every future contributor and review. A decision is required (Q4); the plan picks one.
**Sources:** Data layer (F2, F6), Components/State (dead-code §5).

---

**F17 — Hand types vs generated schema drift in both directions; `as unknown as` casts switch off the type system at contract boundaries.** ▸
**Location:** `web/src/types/song.ts:31-32,44` (marks `starred`/`explicit`/`active` optional; schema requires them — the type lies about the wire); reverse drift: schema `Song.albumArtistName` (`schema.ts:2164`) absent from the hand type; `types/song.ts:55` types `syncedLyrics?: SyncedLyricLine[]` while the schema honestly says `SyncedLyricLine[] | string` (`schema.ts:2154` — defensively funneled through the excellent `normalizeSyncedLyrics`, which is why this hasn't bitten); four overlapping Song shapes (`types/song.ts`, `lib/types.ts:3`, `SongTable.tsx:7`, `TopBar.tsx:30`); `as unknown as Song[]` casts at `PlaylistDetail.tsx:64,104,242` and `NowPlayingRoute.tsx:104,107,111`. F4 is an instance of this class that already shipped as a crash.
**Sources:** Data layer (F8), Routing (F1).

---

**F18 — Upload: no abort, divergent error envelope (no 401 dispatch), and a silent disable when the settings prefetch fails.** ▸ (hook verified by data-layer subsystem; modal paths read)
**Location:** `web/src/hooks/useUpload.ts:55` (chunk failure rejects with `xhr.statusText`, discarding the server's `{error}` JSON body; a 401 mid-upload does not dispatch `sonarly:unauthorized`), no `AbortController`/`xhr.abort()` anywhere; `web/src/components/UploadModal.tsx:234` (close is a no-op while uploading), `:104-111` (`.catch(() => setDuplicateStrategy(''))` leaves the select empty and `canUpload` false at `:178` — the Upload button silently disabled with zero feedback). `UploadModal` itself is untested (hook only — Testing F4).
**Why it matters:** A user who drops a large folder has no way out short of killing the tab; a session expiring mid-upload surfaces as a bare "Upload failed" instead of bouncing to login.
**Sources:** Data layer (F5, F10), Testing (F4).

---

**F19 — dnd-kit (45.9 KiB raw / 15.3 KiB gzip) ships in the entry chunk on every first paint, including `/login`.** ✔
**Location:** Chain: `Layout.tsx:115` mounts `PlayerBar` → `PlayerBar.tsx:14` imports the now-playing **barrel** (`features/now-playing/index.ts`, which eagerly re-exports `QueueModal`, `LyricsPanel`, `NowPlayingRoute`, …) → `QueueModal.tsx:7` → `QueueList.tsx:4` → `LibraryView.tsx:10-17` (`@dnd-kit/core+sortable+utilities`, the only dnd-kit importer in src). Verified against the current build: `dist/assets/index-DjAg8MPD.js` (entry, 212.6 KiB) statically imports `./dnd-kit-rGtLdNdE.js` (45,864 bytes). The `vite.config.ts:25-35` manualChunks comment assumes vendor chunks are cache-strategy only and doesn't account for the eager import.
**Why it matters:** Defeats the documented lazy-route intent for the heaviest dependency; ~15 KiB gzip of drag-and-drop on the login screen. Fix is import-graph surgery, not config.
**Sources:** Testing/Perf (P1).

---

**F20 — Per-tick re-render blast radius: the entire `PlayerBar` footer reconciles ~4×/s during playback.** ▸
**Location:** No `setInterval` progress loop — the `<audio>` `timeupdate` (~4Hz) drives `setCurrentTime` (`AudioController.tsx:271-285`); `currentTime` subscribers include the always-mounted `PlayerBar.tsx:30`, `TransportControls.tsx:16`, `LyricsPanel.tsx:33`, and `AudioController` itself (15 selectors); the preload effect deps include `currentTime` and re-run ~4×/s, early-returning on a ref compare (`:116-139`). Mitigating fact: the Media Session position update is correctly floored to 1Hz (`:212-225`) — the same idea applied to the seek slider would cut ~90% of per-tick reconciliation.
**Why it matters:** Tolerable at 4Hz (not a bug), but it is the widest hot path in the app and the cheapest meaningful perf win.
**Sources:** Testing/Perf (P3, P4), Player.

---

**F21 — Four independent reimplementations of the same popover menu.** ✔ (count/locations) / ▸ (~700 LOC estimate)
**Location:** `SleepTimerButton.tsx` (205 LOC), `TrackActionsMenu.tsx` (180), `TopBar.UserMenu` (~150 within `TopBar.tsx:455`), `PlayersDropdown` (~65) each duplicate open-state, click-outside, Escape, `useLayoutEffect` viewport-clamp, focus-first-item, and arrow-roving logic that `ItemContextMenu` already generalizes (it even supports `anchorToTrigger`). The duplication has already drifted: the a11y subsystem found `aria-haspopup`/`aria-expanded` present on `SleepTimerButton.tsx:183-184`, `TrackActionsMenu.tsx:31-32`, `TopBar.tsx:196-197` but missing on `PlayerBar.tsx:262-284`'s Auto-DJ trigger and other ItemContextMenu consumers.
**Why it matters:** ~700 LOC that could be ~150, and four places to fix any menu bug — with a11y behavior already diverging between them.
**Sources:** Components/State (F3), Styling/A11y (m4).

---

**F22 — `EditEntityModal.tsx` (887 LOC) is a god component: 4 entity types × single+multi edit, 5 nested modals, direct API mutation.** ✔ (size; structure ▸)
**Location:** `web/src/components/EditEntityModal.tsx` — tag parsing/normalization, cover-art editor + lightbox, delete confirm, smart-playlist rules editor, MusicBrainz + lyrics fetch modals, a direct lyrics `PUT` + query invalidation (`:660-667`, verified), an album-stats side-fetch (`:239-273`), ~15 `useState` slots. The 10 pure helpers (`:68-166`) and the per-entity field configs (`SONG_FIELDS`/`ALBUM_FIELDS`) are cleanly factored — the split points already exist.
**Why it matters:** Biggest file in the tree; the song editor is the 80% case and could stand alone. Split candidates: per-type editors behind the existing field configs; lift the fetch-modals and cover-art/lightbox to callers.
**Sources:** Components/State (§1.1).

---

**F23 — Virtualization blind spot on the heaviest lists; selection logic duplicated between `Table` and `LibraryView`.** ✔ (Table consumers corrected) / ▸ (windowing thresholds)
**Location:** Windowing exists only in `LibraryView` and only above 150 items (`LibraryView.tsx:208,354-355,521`); grouped lists are never windowed (`:352-355`). `ui/Table.tsx` (279 LOC, 8 production consumers — **not** dead, contra the components report) has no virtualization at all: album detail (disc-grouped) and `PlaylistDetail` render every row — playlists up to the 500-entry cap → 500 DOM rows; `TrackList`/`AlbumList` on Genre/Year/Composer/Label details render up to 500 `<li>` each. Separately, `Table.tsx:67-132` and `LibraryView.tsx:223-285` are two near-identical select/toggle/range/Escape implementations that have already diverged (Table gates on `selectable`, LibraryView doesn't — Routing F16).
**Why it matters:** The two pages most likely to hold 100–500 rows are the unwindowed ones; the duplicated selection model is a drift engine.
**Sources:** Routing (F6, §3), Components/State (F7, corrected).

---

**F24 — Silent 500-row server cap undermines client-side filtering/aggregation; Artist detail double-fetches and discards the better data.** ▸ (server cap verified at `routes.go:17-19,160`; shapes verified)
**Location:** `server/internal/modules/catalog/routes.go:17-19` (`defaultListLimit = maxListLimit = 500`); the web client never passes `limit` and never surfaces truncation. Consequences (all observed): Tracks-page filters operate on ≤500 songs; Artist "top tracks" is a client filter of ≤500 (`Artist.tsx:58-63`) and its Play button plays only those; Year counts from ≤500 (`Year.tsx:24-29`); AlbumArtists derived from ≤500 albums; Genres/Years/Composers play/shuffle from ≤500. Meanwhile `Artist.tsx:56-59` fetches `/artists/:id` — whose response already embeds the artist's songs server-side (`catalog/routes.go:196-207`, verified) — **and** the full `/songs` list, then ignores the embedded songs.
**Why it matters:** For libraries >500 songs these views are silently incomplete — a correctness issue, not just performance. Cheapest fix consumes the embedded songs; the systemic fix is server-side filtering (out of web scope, flagged).
**Sources:** Routing (F8, F9).

---

**F25 — Now-playing underlay: remount + parallel duplicate fetch on cold open.** ▸
**Location:** `NowPlayingRoute.tsx:84-128` hand-fetches context songs while the freshly mounted underlay page (`:193-202` mounts `PlaylistDetail`/`Album`/`Genre`/…) fetches the same resource through its own channel — `usePlaylist` react-query vs raw `api` for album, no shared cache; closing/reopening remounts the underlay (hand-rolled pages: another full spinner cycle, F7). The Immich-style URL swap itself is well-implemented (FF5 store-derived queue, `replace` sync `:70-81,160-170`, test-pinned zero-request refresh `NowPlayingRoute.test.tsx:72-84`).
**Why it matters:** Two identical requests on cold deep-link; double spinner churn on overlay toggle. Fixed for free when detail pages share react-query keys (plan Phase 5) — the overlay should consume the same hooks.
**Sources:** Routing (F11), Player (FF5 verification).

---

**F26 — Screen-reader semantics of the player: all toasts assertive; no now-playing announcement channel.** ✔ (toast role) / ▸ (live-region grep)
**Location:** `web/src/contexts/NotificationContext.tsx:111` — every toast renders `role="alert"` (assertive), so "Link copied" interrupts a screen reader; only errors should be. Grep confirms the only `aria-live` in the app is `RenameProgressModal.tsx:116`; track changes update `PlayerBar.tsx:127-134` / `NowPlaying.tsx:236-265` silently — a user pressing Next gets no feedback.
**Why it matters:** For SR users of a *music player*, the two highest-frequency events (toast feedback, track change) are exactly the ones with no polite channel. Small fix, high value.
**Sources:** Styling/A11y (m1, m2).

---

**F27 — Accessibility batch: sub-24px desktop targets, APG menu deviations, no overlay focus trap, combobox gaps, unexposed settings state, hold-to-shuffle keyboard gap.** ▸ (all read by the a11y subsystem; coarse-pointer 44px variants verified correct)
**Location:** (a) Desktop targets below 24×24 (WCAG 2.5.8): star buttons ~20px (`ActionButtons.tsx:109-111`), inline row-play 20px (`PlayButton.tsx:139`), playlist drag handle ~18px (`ListRow.tsx:128-135`), queue remove 28px is fine but the strip likely fails the spacing exception. (b) Menus: `ItemContextMenu.tsx:167-175` handles only arrows/Escape — Tab escapes into the page while the menu stays open; no Home/End (APG). (c) `NowPlaying.tsx:106-115` moves focus in and restores on close but has no Tab cycle — Shift+Tab from the first control falls through to the PlayerBar/Sidebar under the `aria-modal` overlay. (d) `SearchBox.tsx:194-209,261-277`: no `aria-controls`; options are focusable `<button role="option">`s creating a contradictory second tab path alongside `aria-activedescendant`; `li` wrappers lack `role="presentation"`; the document-level Escape handler (`:107-111`) blurs the input on *any* Escape in the app. (e) Theme/accent selectors show selection by border/ring only (`SettingsAppearance.tsx:49-86`) where sibling toggles use `aria-pressed` (`CreatePlaylistModal.tsx:192,220`, `SettingsPlayback.tsx:148,188`). (f) Hold-to-shuffle announces "(hold to shuffle)" on the accessible name but keyboard activation (`e.detail === 0`, `PlayButton.tsx:84-86`, `ActionButtons.tsx:69`) only triggers play — the announced affordance can't be performed without a pointer.
**Why it matters:** No blockers, but this is the difference between "has a11y features" and "is operable" for keyboard/SR users. All fixes are small and local; the standing floors (24px/44px, reduced-motion) apply.
**Sources:** Styling/A11y (m3–m7, m10, m11).

---

### Low

---

**F28 — UX consistency batch.** ▸
Artists page genre filter shows a factually wrong empty state while songs load (`Artists.tsx:35-38,113-114`); explicit-content policy not applied on track detail (`Track.tsx:130-133` renders raw title; honored on `Tracks.tsx:91-95` and `Album.tsx:327-334`); SearchResults favorite/rate produce unhandled rejections (`SearchResults.tsx:121-129,275-276` → global reporter, no in-UI feedback); Playlists empty copy always says "match the current filters" even with none (`Playlists.tsx:127`); dead selection affordance on pages without `onPlaySelection` (rows highlight, Enter does nothing — `LibraryView.tsx:261-279` vs Table's `selectable` gate, the F23 divergence); view-mode toggle is local state, resets on every mount (`LibraryView.tsx:211`); AutoDJ failure swallowed while success toasts (`useAutoDj.ts:83-95`); keyboard focus lost when a focused windowed row unmounts (`ListRow.tsx:112`, no roving tabindex — inherent to windowing, document or retain); `Redirect` is effect-based, one blank frame (`App.tsx:172-178`).

---

**F29 — Code-hygiene batch.** ✔ (dead exports, barrel, tsconfig, dist) / ▸ (rest)
Dead exports with zero call sites (verified this session unless noted): `libraryStore.ts:55-63` (`getSelectedLibrary`, `getSelectedLibraryId`), `playerStore.ts:475-477` (`resetPlayer`, test-only), `useScrollParent.ts:11` (`findScrollParent`), `VirtualGrid.tsx:8` (`defaultGridColumns`), `useLibraryLists.ts:29` (`LIBRARY_LIST_STALE_TIME` external), ~25 exported interfaces with no external consumer. Two components named `PlayButton` (`components/PlayButton.tsx` play-trigger vs `PlayerControls.tsx:47` play/pause toggle — accident waiting for a review). tsconfig has no `noUnusedLocals`/`noUnusedParameters` (verified — nothing catches the above). zustand persist has no `version`/`migrate` (`playerStore.ts:440-471`). `accent-auto` in `accentClasses` with no CSS rule; `resolveAccent` dead `resolvedMode` param (F3). `Slider`'s `variant` prop is dead (`PlayerControls.tsx:89,100` — behavior is all CSS). Double dominant-color decode per track change (`Layout.tsx:78` + `NowPlaying.tsx:23`, `useDominantColor.ts:30-96` — memoizable). Preloader `preload="auto"` downloads the entire next file from T-30s unconditionally, no user toggle (`AudioController.tsx:346`; honest "gapless aid" comments, but the name could oversell). `NowPlayingRoute.tsx:181` hand-rolls `?shareToken=` instead of the `withShareToken` helper. `ProfileForm.tsx:71-85` raw `fetch` duplicates envelope parsing and bypasses the 401 dispatch (despite `lib/api.ts:5` supporting FormData). Statistics `mode="overall"`/`userId` props dead (no route exercises them). `queueIndex` rehydrate edge leaves queue-without-currentSong (`playerStore.ts:464-466`). Ring-offset patch uses `bg-primary` on `bg-surface` elements (cosmetic). `usePlaylists`/`usePreferences` have no staleTime → refetch on every mount/sidebar navigation (wasteful, always-fresh).

---

## 5. Strengths (genuine, specific — preserve these)

- **`playerStore` is exemplary**: pure transitions, minimal persisted surface with `partialize`, rehydrate repair forcing `status:'idle'`, deterministic shuffle preserving played history, Spotify-style clearQueue, previous-restart threshold — 30 focused tests (`playerStore.ts:362-395,452-470`).
- **`AudioController`'s edge-case engineering**: AbortError swallowed on rapid skips, `NotAllowedError` → friendly "Press play" notification, stall detection with progress-cancel, honest "gapless aid" comments, and the repeat-one scrobble-guard pre-reset (`:306-310`) — the failure mode was actually thought through.
- **The scrobble percentage fix is defended in depth**: client clamp (`:292-294`), server clamp + tests (`server/.../playback/scrobble.go:60-61`, `scrobble_test.go:71-97`), backfill migration 047, git history confirming the bug→fix arc.
- **FF5 zero-request refresh** works exactly as documented and is test-pinned, including shuffle-index preservation (`NowPlayingRoute.test.tsx:72-84,112-126`); `storeQueueCoversUrl` is precisely scoped.
- **`ItemContextMenu`** is the best-engineered interactive piece in the tree: Shift+F10/Menu-key open, Escape restores focus, measure-then-position in `useLayoutEffect` (no flash), ResizeObserver re-clamp, 10px long-press tolerance, synthetic-click swallower; `menuPosition.ts` is pure and matrix-tested.
- **Token discipline**: zero raw hex/rgb in TSX; charts consume `--chart-*` via a token list; the `text-bg-primary`-on-`bg-accent` button trick is mode-aware by construction.
- **Reduced motion is genuinely complete**: global CSS dampener + explicit per-animation opt-outs + `motion-reduce:` on every spinner + JS `matchMedia` checks in 6 components including full WAAPI skip in toasts.
- **The new slider CSS**: 24px forced hit area, hover-revealed thumb guarded by `(hover:hover) and (pointer:fine)`, separate Firefox progress path, `aria-valuetext` "0:42 of 3:17" on the seek slider.
- **Routing architecture**: 33 lazy routes with shaped fallbacks, ErrorBoundary composition that keeps the player alive through route crashes, and a boot/auth flow that distinguishes 401 from network failure with a retry UI — unusually well-commented, and the comments are accurate.
- **`useLibraryLists`' documented key-family contract** + `patchItem` in-place updates + SSE prefix invalidation that mirrors it — exactly the right server-state design; `usePlaylist`'s shareToken-in-key is cache-key hygiene most codebases miss.
- **Race-safety patterns**: Auto DJ generation counter (`useAutoDj.ts:70-95`), `useSongInteraction` mutation-version rollback (`useSongInteraction.ts:22-48,59-85`).
- **Testing culture**: per-hook suites, SSE edge cases (invalid JSON, close-on-unmount, never-invalidate-`[]`), virtualization with faked layout + explicit prototype cleanup, `retry:false` in the shared renderer, fake timers — and mock-sound discipline throughout.
- **The bundle budget gate** is wired as the final `pnpm build` step with its own test file (`scripts/bundle-budget.mjs`, LIMITS at entry 250 KiB / lazy 350 KiB / total 900 KiB) — growth cannot ship silently.
- **Security clean sheet** (D11): no XSS surface, no tokens in JS storage, share token confined to URL/query-scoped calls and never to client-error reports, 7 runtime deps with a clean production audit.
- **`normalizeSyncedLyrics`** (`lib/syncedLyrics.ts:1-64`): one documented, tested choke point for wire ambiguity — the model for how F17's drift should have been handled everywhere.
- **Mutation UX consistency**: `catch → notify(err.message, 'error')` applied across ~40 call sites with the server's own message text.

---

## 6. Top-10 Highest-Value Improvements (grouped, not ranked)

**Critical first — restore what is broken:**
1. **Guest share experience, end-to-end** (F1, F2): client stream URL sends the server's `share` param; server exempts + token-validates `/api/cover-art/{id}` (v1 semantics); `PlayerBar` navigation preserves the token; regression tests for all three, plus one manual pass against a live server (nothing in the 467-test suite exercises `streamUrl()` against the real contract).
2. **Boot-time preference loss + accent contract** (F3): persist/seed theme+accent so a cold boot restores the user's choice; align `index.html` bootstrap and both design-language docs to the monochrome default (or reverse the decision — see Q1); delete the dead `resolvedMode` param and `accent-auto` class.
3. **Now-playing album deep-link crash** (F4): one line (`detail.songs`) + a cold-load test.
4. **Cache-integrity quartet** (F5, F6, F11, F12): refetch-on-reconnect in `useServerEvents` (honoring the server's documented assumption), `queryClient.clear()` on 401/login, wire playlist favorite/rate into the caches with real error surfacing, unify the duplicate query-key families onto the documented `useLibraryLists` contract.

**High priority — close the defect classes:**
5. **Migrate Track/Album/Artist detail pages to react-query** behind a shared invalidation map (F7, F25): kills sticky-error/race/no-cache/no-retry as a class, aligns with the documented FF1 direction, and lets the now-playing overlay share the same cache; Artist detail should consume its server-embedded songs (F24).
6. **Scroll restoration** (F8): per-pathname offset map, restore on popstate-direction navigations, keep reset on pushes, and don't reset when the overlay hands back to `returnPath` — the biggest perceived-perf win for the core loop.
7. **AudioController regression harness + the two player one-liners** (F9, F13, F14): fake-media-element harness (precedent exists), then stall-timer-clears-on-pause + `onPause` sync, and a play-session-scoped scrobble guard.
8. **Accessibility floors** (F10, F26, F27): light-mode danger/success token lightness (verify computed ratios in all three modes), 24px desktop target floor, toast politeness split, now-playing live region, APG menu keys, overlay focus trap.

**Medium priority — structural and perf:**
9. **Entry-chunk diet + hot-path split** (F19, F20): cut dnd-kit out of the entry (lazy `QueueModal` off the barrel path — verify via the built chunk graph), split a `Progress` slice out of `PlayerBar`, cache dominant-color decodes. The budget gate stays green throughout.
10. **Retire the structural debt in order** (F15, F16, F17, F21, F22): libraries into react-query; the contract wrapper decision (finish or prune — the plan prunes, with triggers recorded); consolidate hand types onto the generated schema; collapse the four popovers onto one implementation; split `EditEntityModal` behind its existing field configs.

---

## 7. Questions / Unknowns

1. **Accent default direction** (F3): the code records monochrome as an owner decision dated 2026-09-26 (same day as HEAD `e4f37b7`); the docs record blue/cyan. Which is the contract going forward? This audit treats *code as truth* (docs + bootstrap are stale) but the plan needs the decision confirmed before Phase 2's doc rewrite. Severity is unchanged either way.
2. **Does the server emit `library:changed` on tag edits?** (mitigates F7's stale-list paths): if yes, the 30s staleTime + SSE bounds the harm; if no, the invalidation map must be exhaustive client-side. Server-side, unverified here.
3. **Resume/bookmarks** (player M4): the bookmark API is shipped and live (`contract/schema.ts:704-733`) but the client never calls it; reload restarts the current track at 0. Product decision: wire a minimal resume, or document as not-planned.
4. **Contract wrapper: finish adoption or prune?** (F16): the plan picks **prune** (delete wrapper + fix `docs/architecture.md:96`/`docs/api.md:67`, keep `lib/api` canonical) because ~65 stable call sites and the incompatible error classes make half-adoption the worst state; recorded trigger for revisiting: growth of the endpoint surface or a need for programmatic status discrimination.
5. **Guest-flow runtime confirmation**: F1/F2 are code-verified (and F2's end impact is an inference chain); after Phase 1, one manual pass against a running instance with a real share link is required — no automated coverage exists.
6. **Contrast figures are computed, not measured** (F10): derived from token HSL under the assumption tokens apply unmodified; a 10-minute devtools confirmation in light mode is part of the plan.
7. **AutoDJ failure semantics** (F28): "failure is swallowed so playback continues" — deliberate or oversight? One line either way.
8. **Is `appsmoke.diag.test.tsx` load-bearing?** It exists because it caught route crashes during the migration; with the migration done and no server in CI it now burns 29s proving nothing. Keep-gated vs delete is a Phase-0 decision (plan: gate behind an env var with explicit skip, decide deletion after one quarter).

---

*End of audit. No production code was modified during this assessment. Implementation plan: `2026-09-26-frontend-uiux-plan.md`.*
