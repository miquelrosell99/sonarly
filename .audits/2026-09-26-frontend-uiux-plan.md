# Sonarly Frontend UI/UX Audit — Implementation Plan (web/)

**Date:** 2026-09-26
**Companion:** `.audits/2026-09-26-frontend-uiux-audit.md` (findings F1–F29; this plan references them)
**Goal:** reach 100% of the Must backlog and the Should backlog, with the suite and the bundle budget gate green after every phase.
**Audience:** coding agents executing without further questions. Decisions that the audit flagged as ambiguous are **made here** (noted "DECISION:"); only Q1 (accent direction) requires owner confirmation, and Phase 2 is sequenced so it can start on the assumption stated there.

## Standing constraints (apply to every phase)

- Design language is fixed (`docs/design-language.md`): token hues and the monochrome-accent decision are not redesignable; contrast fixes adjust **lightness only** and must keep dark/OLED ratios passing.
- No new heavy dependencies. Nothing in this plan adds a runtime dependency.
- Bundle budget gate must stay green: entry ≤ 250 KiB, any lazy chunk ≤ 350 KiB, total ≤ 900 KiB (`web/scripts/bundle-budget.mjs`). Every phase that touches imports ends with `pnpm build` and a check of the gate output.
- Accessibility floors stay: 44px coarse-pointer targets, 24px minimum desktop targets, reduced-motion behavior must never regress.
- Test suite: 70 files / 467 tests currently green (~30s). Verification per phase: `cd web && npx tsc --noEmit && pnpm test && pnpm build`. Phases touching `server/` also run `cd server && go test ./...`.
- One commit per step, in the order written. Rollback is always "revert the commit(s)"; phases state anything different.
- Facts vs inferences: findings F2's user impact and F10's contrast numbers are the only inference/computed items; Phase 1 includes a manual runtime confirmation, Phase 6 includes a devtools ratio confirmation.

## Ordering rationale

Impact × Risk × Effort: pure-wins and critical defects with tiny blast radius first (Phases 0–4); contained migrations next (5–7); performance import-surgery after test coverage protects it (8); write-path hardening (9); large structural refactors strictly last (10); hygiene sweep (11). Nothing before Phase 5 rewrites a page; nothing before Phase 8 touches the import graph.

---

## Phase 0 — Suite hygiene: gate the diagnostic smoke test

**Objective:** reclaim ~29 of the 30 suite seconds and make the server-less CI behavior explicit.
**Findings:** F28 batch (appsmoke cost; audit §7-Q8).
**Files:** `web/src/appsmoke.diag.test.tsx` only.

**Steps:**
1. Replace the hardcoded `BASE` (`:7`) with `process.env.SONARLY_SMOKE_URL ?? ''`.
2. Wrap the suite: `describe.skipIf(!process.env.SONARLY_SMOKE_URL)('UI-vs-v2 repro…', …)` so an absent server produces explicit skips, not vacuous passes.
3. Keep the 2.5s sleep and assertions unchanged for the gated case (it still has value when run manually against a live server).
4. Run the suite twice: once ungated (all other suites pass, smoke skips), once with `SONARLY_SMOKE_URL=http://127.0.0.1:4620` if a server is up (smoke runs; if no server is available, note it in the commit message — the skip path is the tested one).

**Test requirements:** suite wall time < 6s without the env var; `vitest --run` reports the 11 smoke tests as skipped, not passed.
**Verification:** `cd web && npx tsc --noEmit && pnpm test`
**Rollback:** revert. **Dependencies:** none.

---

## Phase 1 — Restore the guest share experience (Critical)

**Objective:** make a share link playable and navigable end-to-end for anonymous visitors.
**Findings:** F1 (stream param + guest cover art), F2 (token-dropping navigation). Server changes are included and marked.
**DECISION:** the client stream URL adopts the server's existing `?share=` param (zero server risk today); the cover-art fix is server-side and accepts `shareToken` (what every client call site already sends, via `withShareToken`).

**Files/steps:**
1. **Extract + fix the stream URL.** Move `streamUrl` from `web/src/components/AudioController.tsx:21-26` to a new `web/src/lib/streamUrl.ts` (export the function; AudioController imports it). Change the guest branch to `` `/api/stream/${songId}?share=${encodeURIComponent(shareToken)}` ``. Session branch unchanged.
2. **Test:** new `web/src/lib/streamUrl.test.ts` — guest URL contains `share=` (not `shareToken=`), session URL hits `/rest/stream.view`; both URL-decoding and encoding round-trip.
3. **Preserve the token on navigation.** In `web/src/components/PlayerBar.tsx:61-71`, append the token to the two `setLocation` calls when present: build `` const suffix = getShareToken() ? `?shareToken=${encodeURIComponent(getShareToken()!)}` : '' `` and append. Import `getShareToken` from `lib/shareToken.js` (already a PlayerBar dependency via feature code — verify import list).
4. **Test:** extend the PlayerBar suite (or add `PlayerBar.guest.test.tsx`) — render as a guest (location carries `?shareToken=t`), click the cover-art/now-playing trigger, assert the new location contains `shareToken=t`.
5. **Fix the helper hand-roll.** `web/src/features/now-playing/pages/NowPlayingRoute.tsx:181` builds `?shareToken=` manually — route the string through the existing `withShareToken` helper (already imported at `:5`).
6. **Server: guest cover art.** In `server/internal/modules/catalog/routes.go`, move `r.Get("/api/cover-art/{id}", h.getCoverArt)` from the session-required group (`:44-57`) into a group with `AuthMiddleware` only (no `RequireAuth`); in the handler (`getCoverArt`, ~`:274-284`), when `identity(r)` is anonymous, validate `q.Get("shareToken")` against the playlist-share policy (reuse the same token lookup the stream path uses) and return 401 on missing/invalid — mirroring v1's exemption (`packages/server/src/app.ts:201-208`).
7. **Server test:** cover-art handler matrix — session 200; valid token 200; missing/invalid token 401; add to the catalog module's route tests following the existing pattern.
8. **Manual runtime confirmation (F1/F2 inference check):** against a running instance, open a shared playlist as an anonymous tab: tracks play, artwork renders, tapping the cover opens Now Playing and does not redirect to /login. Record the result in the commit message.

**Test requirements:** steps 2, 4, 7 are the automated gates; step 8 is the recorded manual gate.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`; `cd server && go test ./...`
**Rollback:** steps 1–5 revert together (client); steps 6–7 revert together (server). Independent otherwise.
**Dependencies:** none. **Note:** nothing in the existing suite exercised this contract — the new tests in steps 2/4 are the regression net.

---

## Phase 2 — Theme boot path + accent contract

**Objective:** a cold boot restores the user's theme mode *and* accent; no first-paint accent flip; docs match code.
**Findings:** F3. **DECISION:** code is truth — monochrome stays the default accent (owner decision recorded in `themeStore.ts:41-42`); docs and the pre-hydration bootstrap are brought in line. Persistence format: upgrade the `sonarly-theme` localStorage value from a bare mode string to `{ "mode": "…", "accent": "…" }`, accepting the legacy string on read.

**Files/steps:**
1. **`web/src/stores/themeStore.ts`**: (a) `apply()` writes `{ mode: resolvedMode, accent: resolvedAccent }` to `sonarly-theme` (keep the try/catch); add a `loadPersisted()` that reads the key, accepts `"dark"|"light"|"oled"` (legacy) or `{mode, accent}`, seeds `themeMode`/`accentColor` via `setState`, and is invoked at module init or from `main.tsx` before `apply()`; (b) delete the unused `resolvedMode` parameter of `resolveAccent` (`:39-44`) and the `accent-auto` entry in `accentClasses` (`:27`).
2. **`web/index.html:19-37`**: bootstrap reads the JSON form, falls back to legacy string; applies `accent-monochrome` when no accent is stored (replace the `accent-blue`/`accent-cyan` ternary at `:34`).
3. **`web/src/main.tsx:21`**: call `useTheme.getState().loadPersisted()` (or rely on step 1's module init) before `apply()`; keep the `matchMedia` change listener.
4. **Docs:** update `docs/design-language.md:33,37` and `agents/design-language.md:6,8` — default accent is monochrome (`--accent` follows `--fg-primary`); token table brought in line with the 19 defined tokens. No other doc language changes.
5. **Tests:** extend `themeStore` tests — round-trip write/read of the JSON form; legacy string parses; `apply()` emits `theme-*` + `accent-monochrome` for `auto` accent; Settings → Appearance renders the stored (non-Auto) selection on boot (mock preferences query resolving with `accentColor: 'purple'` → store seeded → swatch selected).

**Test requirements:** step 5 all green; no test may write the old string format.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** revert. **Dependencies:** none. If Q1 reverses the accent decision, only steps 2 and 4 change (one line + doc wording).

---

## Phase 3 — Player correctness one-liners + AudioController regression harness

**Objective:** land the three small player fixes **with** a permanent test harness for the most failure-prone module.
**Findings:** F9 (harness), F13 (stall/pause + `onPause`), F14 (replay scrobble), plus F26-toast role and F27e (cheap a11y one-liners riding along).

**Files/steps:**
1. **Harness.** New `web/src/components/AudioController.test.tsx`: stub `HTMLMediaElement.prototype.play/pause/load` and define `duration`/`currentTime` setters (precedent: `appsmoke.diag.test.tsx:55-58`); capture the rendered `<audio>` elements' props via `render` + container query; drive events by calling the captured handlers (`onTimeUpdate`, `onEnded`, `onPlay`, `onWaiting`, …); mock `api` and the stores' non-player deps; assert against the player store state and the notification mock.
2. **F13 stall/pause:** in `AudioController.tsx`, clear the stalled timer in the status-watching pause path (the effect at `:98-101` that reacts to status) — call `clearStalledTimer()` when the element is paused; add `onPause={handlePause}` to the `<audio>` (`:332-344`) where `handlePause` clears the timer and, if `usePlayer.getState().status === 'playing'` while the element reports paused, calls `pause()`.
3. **F13 tests:** (a) arm the stall timer via `onWaiting` while playing, fire the pause path, advance fake timers 15s → no error status, no "Playback stalled" notification; (b) element-initiated pause (invoke captured `onPause` with store playing) → store status becomes `paused`.
4. **F14 replay scrobble:** add `playSession: number` to `playerStore` (default 0), bumped in `playQueue`, `playAtIndex`, and `playNow` (restart-from-idle replays also route through `play()` after idle — covering that path); **do not** add it to the persist `partialize` (`playerStore.ts:452-460`). In `AudioController.tsx`, subscribe to `playSession` and reset `lastScrobbledRef.current` when it changes.
5. **F14 tests:** harness test — play song X to the scrobble threshold (assert one POST), then trigger a same-song replay via a store action bumping `playSession`, drive `timeupdate` past threshold again → second POST; and a repeat-one regression (existing behavior: exactly two scrobbles across the replay).
6. **F26 toast politeness:** `web/src/contexts/NotificationContext.tsx:111` — `role={notification.type === 'error' ? 'alert' : 'status'}`; test both roles.
7. **F27e settings state:** add `aria-pressed` to the theme-mode buttons and accent swatches in `web/src/features/settings/pages/SettingsAppearance.tsx:49-86`; test asserts the attribute follows selection.

**Test requirements:** steps 3/5 are the gate (new file, ≥5 cases); steps 6/7 extend existing suites.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** each step its own revert; the store change in step 4 is additive and inert without the controller subscription.

---

## Phase 4 — Cache integrity: reconnect, auth switch, playlist favorites, key families

**Objective:** close the four cache-correctness defects and unify the duplicated query families.
**Findings:** F5, F6, F11, F12 (and the `lyrics`/library-refresh gaps from F15/F29).

**Files/steps:**
1. **F5 SSE reconnect.** `web/src/hooks/useServerEvents.ts`: add a `hasOpenedRef`; in `onopen`, if this is *not* the first open, run the same prefix invalidation as `onmessage` (`:50-57`) and dispatch the DOM event; keep `onerror` a no-op. Add `'lyrics'` to `LIBRARY_QUERY_PREFIXES` (`:16-25`).
2. **Test:** extend `useServerEvents.test.ts` — connect → invalidate-count baseline; simulate reconnect (second `onopen`) → the 8 prefixes invalidate again; initial open does not invalidate.
3. **F6 auth switch.** In `web/src/App.tsx` add `const queryClient = useQueryClient()`; call `queryClient.clear()` in the `sonarly:unauthorized` handler (`:221-225`) and in the login success path (`onLogin`, `:340`). Test: seed a cache entry, fire the unauthorized event, assert cache empty (pattern from `LyricsPanel.test.tsx:23`).
4. **F11 playlist favorites.** In `web/src/features/playlists/pages/Playlists.tsx:44-58` and `PlaylistDetail.tsx:115-131`: on success `queryClient.invalidateQueries({ queryKey: ['playlists'] })` (detail page also `['playlist', id]`); on error `notify(err.message, 'error')`; **delete the false comment** ("already surfaced by the action hook"). Test: toggle → cache invalidated (assert refetch), failure → notify called.
5. **F12a TopBar filter data.** `web/src/components/TopBar.tsx:284-321`: delete the local `['albums', libId]`/`['songs', libId]` queries; derive filter options from the `useLibraryLists` families (add exported `useAlbumsList(params)`/`useSongsList(params)` hooks there if not already exported, with `LIBRARY_LIST_STALE_TIME` and `keepPreviousData`). Assert one network fetch when list + filter consumers mount together (fetch-mock count in a new TopBar test).
6. **F12b search.** Add `useSearchPreview(q)` to `useLibraryLists.ts` keyed `['search','preview',{q,libraryId}]` (limit 5); `SearchBox.tsx:19-26` adopts it; the results page uses it as `placeholderData` when `q` matches. Test: Enter after a preview does not re-fetch (placeholder served), changing `q` fetches.
7. **Library refresh.** In `TopBar.tsx:388-390`'s effect, also re-run `loadLibraries()` on the `sonarly:library-changed` DOM event (addEventListener + cleanup); render `libraryStore.error` in the selector as a disabled "Libraries unavailable" item when present. (Full migration to react-query is Phase 10e — this is the interim correctness fix.)

**Test requirements:** each step lands with the listed test in the same commit.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** per-step revert; step 1's prefix addition and step 3's clear are each one-liner reverts.
**Dependencies:** none. Conventions established here (invalidation-by-prefix, hooks in `useLibraryLists`) are reused by Phase 5.

---

## Phase 5 — Detail pages onto react-query + shared invalidation map

**Objective:** retire the hand-rolled detail-page idiom (sticky error, races, no cache, no retry) and let the now-playing overlay share the same cache.
**Findings:** F7, F25; consumes the F24 embedded-songs correction; aligns HomePage/SearchResults invalidation with one map.

**Files/steps:**
1. **Detail hooks.** New `web/src/hooks/useEntityDetails.ts`: `useSongDetail(id)`, `useAlbumDetail(id)`, `useArtistDetail(id)` — keys `['songs','detail',id,libraryId]` etc., `staleTime: 30_000`, libraryId from `libraryStore`.
2. **Invalidation map.** New `web/src/hooks/useLibraryMutation.ts`: a `useMutation` wrapper taking a mutationFn + an entity key from one exported map — `song: ['songs','search','albums','artists']`, `album: ['albums','search']`, `playlist: ['playlists','playlist']` — applied in `onSettled`. Error → `notify(err.message,'error')` (existing convention).
3. **Track.tsx:** replace `load()`/`useState` (`:39-50`) with `useSongDetail`; favorites/rating/tags/delete become `useLibraryMutation` calls (delete keeps its navigate); remove the local `error` state entirely (react-query's error auto-clears on retry/param change). Add `onRetry` wiring: extend `EntityDetail.tsx:8-23` with an optional `onRetry` prop rendered via `PageState`'s existing retry support (`PageState.tsx:55-59`).
4. **Album.tsx:** same migration (`:86-99`, mutations at `:150-237`); album edits/deletes now invalidate `['albums']`/`['songs']` per the map (closes the stale-list path).
5. **Artist.tsx:** same migration **and** drop the parallel `GET /songs` fetch (`:56-59`) — consume the songs embedded in the `/artists/:id` response (server shape verified: `{"artist","songs"}`, `catalog/routes.go:196-207`); "top tracks" derives from the embedded list.
6. **NowPlayingRoute:** replace its hand-rolled context fetches (`:96-120`) with `usePlaylist(contextId)` (shareToken-in-key already correct) and the new `useAlbumDetail`; the underlay no longer double-fetches (F25). Apply the F4 shape fix in the same commit: `AlbumDetailResponse` becomes `{ album: Record<string, unknown>; songs: Song[] }` and the album branch reads `detail.songs`.
7. **HomePage/SearchResults:** route their existing hand-rolled mutations through `useLibraryMutation` (SearchResults adds `['albums']`/`['artists']`; HomePage adds `['search']`).
8. **Tests (per page, same commit as the page):** (a) cache hit — mount detail, unmount, remount → zero additional fetch; (b) error state renders `PageState` retry → clicking retry refetches and recovers; (c) param change (render `/tracks/a` → navigate `/tracks/b`) fetches b and cannot be clobbered by a late a-response; (d) Track delete → `['songs']` invalidated (list remount shows the deletion); (e) NowPlayingRoute album **cold-load** regression: empty store, URL `/now-playing/album/x/1`, mocked fetch returns the real `{album, songs}` shape → queue built, overlay opens, no error text. (f) Artist: assert exactly one aggregate fetch, embedded songs rendered.

**Test requirements:** (a)–(f) are the gate; the existing page suites (error-boundary assertions etc.) must stay green untouched where possible — expect to update mocks, not assertions.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** one revert per page (steps 3, 4, 5 independent); step 6 reverts with F4 re-applied (keep the one-liner regardless — split commits so F4 lands first).
**Dependencies:** Phase 4 conventions; F4's one-liner should land first (cherry-pick it ahead if needed).

---

## Phase 6 — Accessibility: contrast tokens, targets, SR semantics, menu/overlay keyboard contract

**Objective:** close F10, F26, F27 without touching the design language's hues or any reduced-motion behavior.
**Findings:** F10, F26, F27a-f.
**Findings:** F10, F26, F27a–f.

**Files/steps:**
1. **F10 contrast.** `web/src/index.css:31-33` (light theme only): `--danger: 0 72% 45%`, `--success: 142 70% 32%`. Recompute the three cited usages (`.btn-danger` label + hover inversion at `:156`, toast bodies, `role="alert"` paragraphs) against `--surface` and `--bg-primary`; target ≥ 4.5:1 for 14px text in all three modes. **Manual gate:** open Settings in light mode with a devtools contrast check on an error toast and a danger button; paste the measured ratios in the commit message (numbers are computed until then).
2. **F27a targets.** Desktop-only bumps, coarse-pointer 44px variants untouched: star buttons `ActionButtons.tsx:109-111` → minimum 24×24 hit box (`p-0.5`→`p-1` or `min-h-6 min-w-6` wrapper); inline play `PlayButton.tsx:139` → 24px container; drag handle `ListRow.tsx:128-135` → 24px. Visual size of the icons may stay 16–18px.
3. **F26 live region.** New visually-hidden `aria-live="polite"` region (a `sr-only` div in `Layout.tsx`, near the skip link) announcing `Now playing: {title} by {artist}` on `currentSong?.id` change (subscribe in a tiny `NowPlayingAnnouncer` component). Test: render Layout-level component, change song, assert region text updates.
4. **F26 toast roles** — landed in Phase 3 step 6 (skip here).
5. **F27b menu APG.** `web/src/components/ItemContextMenu.tsx:167-175`: Tab closes the menu and returns focus to the trigger (APG); Home/End move to first/last item. Add `aria-haspopup="menu"` + `aria-expanded` to the Auto-DJ trigger (`PlayerBar.tsx:262-284`) and audit the other ItemContextMenu consumers in the same pass. Tests: Tab-from-menu closes + focuses trigger; Home/End work; expanded state toggles.
6. **F27c overlay trap.** `web/src/features/now-playing/components/NowPlaying.tsx:106-115`: add a Tab cycle for the overlay (query focusables within the overlay root, wrap Tab/Shift+Tab) mirroring `Modal.tsx:42-72`; keep the existing focus-in/restore. Test: Shift+Tab from the first control stays inside.
7. **F27d combobox.** `SearchBox.tsx:194-209,261-277`: add `aria-controls` (id via `useId`) linking input→listbox; `role="presentation"` on the `li` wrappers; make options `tabIndex={-1}` so `aria-activedescendant` is the single focus path. Update the existing SearchBox tests' focus expectations.
8. **F27f hold-to-shuffle.** `PlayButton.tsx:84-86` + `ActionButtons.tsx:69`: on keyboard activation (`e.detail === 0`) trigger shuffle-play (the announced affordance); pointer click stays play, long-press stays shuffle. Test: keyboard event fires the shuffle path.

**Test requirements:** automated gates per step; step 1's manual ratio check recorded.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** CSS revert (step 1) is independent; component steps per-commit.
**Dependencies:** none. May run parallel with Phase 5 by different agents (disjoint files except `PlayerBar` — coordinate).

---

## Phase 7 — Scroll restoration + drill-down navigation UX

**Objective:** restore scroll positions on back/forward navigation; stop resetting scroll when the overlay hands back to `returnPath`; persist view-mode per page.
**Findings:** F8, F28 (view-mode amnesia, overlay-close reset).

**Files/steps:**
1. **Hook.** New `web/src/hooks/useScrollRestoration.ts`: a module-level `Map<pathname+search, number>`; the Layout `<main>` (`Layout.tsx:105-112`) gets an onScroll (rAF-throttled) writer; a wouter `useLocation` history-depth tracker distinguishes push (reset to 0) from popstate-direction (restore saved offset, default 0); restore runs in an effect after commit (post-virtualizer mount).
2. **Overlay hand-back.** In `NowPlayingRoute.tsx:174-187`, closing the overlay navigates to `returnPath` — set a one-shot suppress flag (e.g., `nowPlayingStore` field `suppressNextReset`, consumed by the hook) so the underlay's saved offset survives. Same flag protects the overlay-open navigation (already handled at `Layout.tsx:53-63` — keep).
3. **View mode.** `LibraryView.tsx:211`: replace local `useState` with a `usePersistentViewMode(pageKey)` hook (localStorage, per-page key passed by callers, default from props); pages pass a stable key (`'tracks'`, `'albums'`, …).
4. **Tests:** memory-location suite — scroll `<main>` to an offset (jsdom allows `scrollTop`), push-navigate → 0; back → offset restored; overlay open/close cycle → underlay offset preserved; view mode survives remount. Extend `LibraryView.virtualization.test.tsx` with a restore-after-windowing case.

**Test requirements:** step 4 all green; no change to the virtualization contract (threshold 150, dnd/grouped exclusion).
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** revert (self-contained hook + two integration points).
**Dependencies:** Phase 5 recommended (detail pages cache makes back-nav fast enough for restoration to matter), not required.

---

## Phase 8 — Entry-chunk diet + render hot paths

**Objective:** cut dnd-kit out of the entry chunk; shrink the per-tick reconcile; cache dominant-color decodes.
**Findings:** F19, F20, F29 (double decode, editor payload).

**Files/steps:**
1. **Lazy QueueModal.** `web/src/components/PlayerBar.tsx`: replace the barrel import (`:14`, `import { useNowPlaying, QueueModal } from '../features/now-playing/index.js'`) with (a) `useNowPlaying` imported from the store path directly, and (b) `const QueueModal = lazy(() => import('../features/now-playing/components/QueueModal.js').then((m) => ({ default: m.QueueModal })))` rendered as `{user && <Suspense fallback={null}><QueueModal user={user} /></Suspense>}` (`:285`). The barrel re-exports `NowPlayingRoute`/`LyricsPanel` eagerly — bypassing it for PlayerBar is the fix; do not change the barrel itself (other consumers rely on it).
2. **Verify the chunk graph:** `pnpm build` → grep the entry chunk (find it via `dist/index.html`'s script tag, per `bundle-budget.mjs`) for `dnd-kit` — must be absent; dnd chunk still emitted for lazy consumers. Budget gate green; entry should drop ~15 KiB gzip.
3. **Progress slice.** In `PlayerBar.tsx` extract `<SeekProgress>` subscribing only to `currentTime`/`duration` (+ currentSong fallback), memoize the cover/title subtree (`React.memo` on the existing cover component with stable props). Probe test: render PlayerBar with a store, advance `currentTime`, assert a probe outside SeekProgress does not re-render (render-count via a mocked child).
4. **Dominant-color cache.** `web/src/hooks/useDominantColor.ts`: module-level `Map<coverArtId, string>` cache (bounded: clear when size > 200, FIFO); both consumers (`Layout.tsx:78`, `NowPlaying.tsx:23`) benefit.
5. **Optional if entry still > 240 KiB:** lazy `SyncedLyricsEditor` inside `FetchLyricsModal` (it owns an audio preview). Decide from the step-2 build numbers; skip otherwise and record why.

**Test requirements:** existing PlayerBar/Layout suites green; step 3's probe test; step 2's grep assertion scripted as a small node check added to `scripts/bundle-budget.test.mjs` (entry must not import the dnd vendor chunk).
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build` (gate output inspected).
**Rollback:** revert; the new chunk-graph assertion fails loudly if a revert reintroduces the eager import.
**Dependencies:** Phase 3 (harness protects player changes).

---

## Phase 9 — Upload hardening

**Objective:** abortable uploads, uniform error semantics, no silent disables.
**Findings:** F18.

**Files/steps:**
1. **`web/src/hooks/useUpload.ts`:** (a) parse the server's `{error}` JSON envelope on non-2xx in `uploadChunk` and reject with its message (fall back to statusText); (b) when status is 401, dispatch `window.dispatchEvent(new Event('sonarly:unauthorized'))` alongside the rejection; (c) accept an `AbortSignal`; wire to `xhr.abort()`; reject in-flight chunks with a distinct `UploadAbortedError` (exported class or discriminating flag).
2. **`web/src/components/UploadModal.tsx`:** Cancel button visible while uploading (calls the abort); close button remains a no-op during upload but now shows a tooltip/hint; `:104-111` `.catch` gains `notify('Could not load upload settings', 'error')` and keeps the select empty-disabled (no silent disable); `:178` gate renders an explanatory line when the strategy is unloaded.
3. **Tests:** extend `useUpload.test.tsx` — abort mid-batch stops subsequent chunks; non-2xx with JSON body surfaces the server message; 401 dispatches the unauthorized event. New `UploadModal.test.tsx` — drop zone renders, strategy gating shows the explanation, Cancel aborts (mocked XHR), close hint appears while uploading.

**Test requirements:** all step-3 tests in the same commits as steps 1–2.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** revert. **Dependencies:** none.
**Out of scope (server follow-up, Could backlog):** orphaned upload-session cleanup needs a DELETE endpoint that doesn't exist — do not invent it here.

---

## Phase 10 — Structural refactors (strictly last; sub-tracks are independent)

Each sub-track is its own commit series and can ship/revert independently. Order within the phase: 10e → 10c → 10a → 10d → 10b (ascending risk/effort).

**10e — libraries into react-query (F15).** New `useLibraries` hook keyed `['libraries']` (30s staleTime) in `useLibraryLists.ts`; `libraryStore` keeps *only* `selectedLibraryId` (persist partialize already does — drop `libraries`/`isLoading`/`error`/`loadLibraries` state); `TopBar` consumes the hook; `AdminLibraries.tsx:130/176/198` invalidates `['libraries']`; delete dead exports `getSelectedLibrary`/`getSelectedLibraryId` (`libraryStore.ts:55-63`). Tests: selector reflects admin CRUD after invalidation; selection persistence unchanged.

**10c — contract decision: prune (F16).** DECISION: **prune** (finish-or-adopt loses to delete at the current call-site count). Delete `web/src/contract/wrapper.ts` + `wrapper.test.ts`; keep `contract/schema.ts` (regenerated, fresh — it becomes the source for 10d); fix `docs/architecture.md:96` and `docs/api.md:67` to state `lib/api.ts` is the canonical HTTP layer and the generated schema is types-only for now; add a CI step regenerating the contract to a temp path and failing on diff (`.github/workflows/ci.yml`, after the build/test job). Recorded revisit trigger: endpoint-surface growth or a need for programmatic status discrimination (then reintroduce a wrapper whose error classes *extend* the `lib/api` convention). Tests: none beyond green suite; CI job proves idempotency.

**10a — popover consolidation (F21).** New `web/src/components/ui/usePopoverMenu.ts` capturing the shared open/close/outside-click/Escape/clamp/focus-first/roving logic (extracted from `ItemContextMenu`'s proven behavior, including `anchorToTrigger`). Migrate one consumer per commit: `PlayersDropdown` (smallest) → `TrackActionsMenu` → `TopBar.UserMenu` → `SleepTimerButton`; preserve each component's visual markup and the a11y attributes fixed in Phase 6. Keep `ItemContextMenu` as the context-menu specialist. Tests: the existing 5 menu suites stay green per migration; add one shared-behavior suite for the hook (open/Escape/arrow/Tab-closes).

**10d — type consolidation onto the generated schema (F17).** In `web/src/types/`: re-derive `Song`/`Album`/`Artist`/`Playlist` from `contract/schema.ts` components (keep client-only shapes like `SongWithNames` in `lib/types.ts`); fix optionality mismatches (`types/song.ts:31-32,44` vs schema requiredness; `syncedLyrics` union `schema.ts:2154`); delete the four overlapping Song shapes down to two (schema-derived + `SongListItem` where row-specific); replace `as unknown as Song[]` casts (`PlaylistDetail.tsx:64,104,242`, `NowPlayingRoute.tsx`) with mapper functions. `tsc` is the primary gate; expect to fix `?? false`-style compensations that become unnecessary. Tests: suite green; add one mapper unit test per entity.

**10b — EditEntityModal split (F22).** Behind the existing field configs: extract `SongEditor` / `AlbumEditor` / `ArtistEditor` / `PlaylistEditor` (song editor first — the 80% case) into `web/src/components/edit-entity/`; lift `FetchLyricsModal`/`FetchMetadataModal` invocation to callers via optional render-props or composition; keep the multi-edit reducer and the 10 pure helpers (`:68-166`) in a shared module. Target: main file < 300 LOC + per-type modules < 250 each. Tests: the existing EditEntityModal suites must pass unmodified against the split (they render through the public component); add per-type render smoke after each extraction.

**Verification (whole phase):** `cd web && npx tsc --noEmit && pnpm test && pnpm build`; for 10e also `cd server && go test ./...` is unaffected (no server change) — run anyway.
**Rollback:** per sub-track revert. **Dependencies:** 10e soft-depends on Phase 4 conventions; 10d soft-depends on 10c (schema-only contract); 10b last.

---

## Phase 11 — Hygiene sweep (F27/F29 leftovers)

**Objective:** clear the dead-export/compiler-guard debt unlocked by Phases 4/5/10.

**Steps:**
1. tsconfig: add `"noUnusedLocals": true, "noUnusedParameters": true`; fix fallout (delete or underscore-prefix). Expected deletions: `findScrollParent` export (`useScrollParent.ts:11`), `defaultGridColumns` export (`VirtualGrid.tsx:8`), `LIBRARY_LIST_STALE_TIME` external export (`useLibraryLists.ts:29` — keep internal use), `resetPlayer` if still unreferenced (verify tests use it first), unused exported interfaces.
2. Rename the `PlayerControls.tsx:47` `PlayButton` → `PlayPauseButton` (update imports in PlayerBar/TransportControls; the top-level `components/PlayButton.tsx` keeps its name). `tsc` gate.
3. `playerStore.ts:440-471`: add persist `version: 1` + identity `migrate` (future-proofing only; no shape change).
4. Remove the dead `Slider.variant` prop (`PlayerControls.tsx:89,100`) — behavior is CSS-only; update its test.
5. Small consistencies (one commit each, only if not already fixed by earlier phases): Track detail `ExplicitTitle` (`Track.tsx:130-133`); SearchResults try/catch + `notify` (`SearchResults.tsx:121-129,275-276`); Playlists empty copy branches on `hasActiveFilters` (`Playlists.tsx:127`); gate LibraryView click-selection on a provided `onPlaySelection` (align with Table's `selectable`, F23 divergence — update affected page tests); `ProfileForm.tsx:71-85` raw fetch → `api()` (FormData supported at `lib/api.ts:5`); Statistics dead `mode`/`userId` props removed (`App.tsx:395`); `usePlaylists`/`usePreferences` get `staleTime: 30_000`; AutoDJ failure `notify` (F28 — deliberate-silence question Q7 resolved "notify").
6. Docs sync: `agents/ui-components.md` component inventory refresh (Table correction noted), `agents/technology-stack.md` dependency list verified current.

**Test requirements:** suite green after each commit; tsc gate is the primary guard.
**Verification:** `cd web && npx tsc --noEmit && pnpm test && pnpm build`
**Rollback:** per-commit. **Dependencies:** Phase 10e (libraryStore deletions) and 10d (type deletions) must land first.

---

## Backlog summary

### Must do (ship order = phase order)
| Findings | Phase |
|---|---|
| appsmoke gating | 0 |
| F1 guest stream/cover + F2 guest navigation | 1 |
| F3 theme boot + accent contract | 2 |
| F9 harness + F13 stall/pause + F14 replay scrobble + toast roles | 3 |
| F5 SSE reconnect + F6 cache clear + F11 playlist favorites + F12 key families | 4 |
| F4 album deep-link crash (lands with Phase 5 step 6; may be cherry-picked first) | 5 |
| F7 detail pages + F25 shared cache + F24 embedded songs | 5 |
| F10 contrast + F26 live region + F27 a11y set | 6 |
| F8 scroll restoration | 7 |

### Should do
F19 entry-chunk diet + F20 progress slice (8) · F18 upload hardening (9) · F15 libraries→react-query (10e) · F16 contract prune (10c) · F21 popover consolidation (10a) · F17 type consolidation (10d) · F22 EditEntityModal split (10b) · F28 UX consistency batch (11.5) · F27a/… any a11y items deferred from 6.

### Could do (no phase assigned; pick opportunistically)
Resume/bookmarks wiring (Q3 decision required first) · preload bandwidth toggle + "prewarm" naming (F29) · SyncedLyricsEditor lazy split if entry grows (Phase 8 step 5) · server accepting both `share`/`shareToken` params for stream (naming cleanup after Phase 1 proves out) · server-side filter endpoints to retire the 500-cap client workarounds (F24 systemic half) · view-mode persistence to server preferences instead of localStorage (Phase 3 of 7) · focus retention for windowed rows (F28, document-or-fix) · `queueIndex` rehydrate edge (F29) · ring-offset patch color (F29, cosmetic).

### Do not do
- **Do not** redesign the design language, change token hues, or re-litigate the monochrome accent (Q1's only escape hatch is a one-line + docs change in Phase 2).
- **Do not** add dependencies: no component library, no icons beyond the mdi sprite, no state/router/query replacements, no e2e framework (Playwright/Cypress) — the gated smoke + manual passes are the e2e story for now.
- **Do not** delete `lib/api.ts` or wholesale-adopt a generated wrapper (10c prunes the opposite direction; revisit only on the recorded trigger).
- **Do not** relax or bypass the bundle budget gate; do not raise its limits to make a phase pass — split chunks instead.
- **Do not** virtualize `QueueList` or grouped tables by force: the dnd/grouped exclusion is a documented, tested contract (F23 fix targets unwindowed *plain* lists only, and only if profiling justifies it — not in this plan).
- **Do not** add replay/buffering to the SSE broker; reconnect-refetch (Phase 4) is the designed recovery.
- **Do not** touch reduced-motion behavior beyond extending it; every new animation needs a `motion-reduce` path.
- **Do not** rewrite the player state machine, swap routers, or introduce SSR — none of the findings support it.

---

*Plan complete. 12 phases (0–11; Phase 10 has five independent sub-tracks). Every phase lists its own tests, verification commands, rollback, and dependencies; agents should work one step = one commit, in order.*
