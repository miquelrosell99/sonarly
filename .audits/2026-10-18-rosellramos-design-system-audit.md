# UI Audit: Sonarly web frontend vs RosellRamos design system

Date: 2026-10-18 · Mode: re-audit per `rosellramos-design-system/references/audit-checklist.md` §0 —
verify the open findings of the [2026-10-15 audit](./2026-10-15-rosellramos-design-system-audit.md)
against current code, then deep-sweep the requested surface families: **modals/overlays, context
menus (incl. the new add-to-playlist + drag-and-drop feature, commit `7d65e59`), buttons and raw
elements, lists/tables/views, sidebars/shell, feedback states**. Builds on
[2026-10-15](./2026-10-15-rosellramos-design-system-audit.md) and the
[grids verification](./2026-10-15-grids-adaptivity-verification.md).

Method note: four parallel read-only surface walks (overlays; context menus + new feature; buttons
/raw elements; lists/views/shell) were run, then every Critical/Warning below was re-verified
against the code by the auditor before inclusion. Surfaces swept are named per section; everything
in `web/src` was in scope except `*.test.tsx` (read only where needed to confirm intent).

## §0 Evidence sweep (all clean)

- `--color-*` legacy namespace: zero hits in `web/src`.
- Bare color aliases (`var(--primary)`, `var(--surface)`, …): zero hits.
- Tailwind arbitrary/default-palette classes (`rounded-md|lg|xl`, `text-[…px|em]`, `bg-[#…]`,
  `bg-slate-*`): zero hits in `*.tsx`.
- Hardcoded hex in CSS: only a comment in `web/src/index.css:34-35` (semantic-hue provenance note
  inside the token file) — clean.
- `em` font sizes: zero. `window.confirm/alert/prompt`: only a comment in
  `hooks/useSongsContextMenu.test.ts:214` — clean.
- Canvas paint: only `SyncedLyricsEditor.tsx:327,336`; colors resolve from
  `getComputedStyle(…)--fg-primary` with test-only fallback — allowed per prior audits.
- Gradients on surfaces: zero; gradient-with-accent: zero.
- `shadow-*` grep: all hits are floating transient layers (menus, popovers, modals, toasts,
  lightbox, drag ghost) **except** the recorded Critical at `SharePlaylistModal.tsx:57` and the
  Warnings at `SyncedLyricsEditor.tsx:626`, `EditableCoverArt.tsx:60,75`, `FilterPanel.tsx:28`
  (default class string) — see findings.
- Token-drift gate: `web/scripts/token-drift.mjs` runs in CI (`.github/workflows/ci.yml:39-41`)
  and passes locally (357 TS/TSX files, 2 CSS files, 26 custom properties — no drift).
- Single appearance seam: unchanged from 2026-10-15 (runtime writer `themeStore.ts` +
  matching pre-paint bootstrap in `index.html`) — pass.

## Prior findings — verification

All six warnings open in the 2026-10-15 report are **RESOLVED**:

| Finding (2026-10-15) | State | Evidence |
|---|---|---|
| `min-[420px]` off-grid | PASS-with-note | Registered (`.agents/design-overrides.md` "Off-grid breakpoint usages" now lists 420/640/1280 with rationale) |
| No token-drift CI gate | FIXED | `web/scripts/token-drift.mjs` in `ci.yml:39-41` + `token-drift.test.mjs`; gate passes |
| No About / copyright | FIXED | `features/settings/pages/SettingsAbout.tsx:39` — `© {year} Miquel Rosell Tarragó` |
| `MonthlyActivityChart` raw `rounded-xl` | FIXED | Zero `rounded-xl` remains |
| `ColumnConfigMenu`/`PlayerBar` `rounded-md` | FIXED | Zero `rounded-md`/`rounded-lg` remains |
| `QueueModal` no initial focus | FIXED (partially) | Initial focus added (`QueueModal.tsx:47`); **but focus is not restored on close — new Warning below** |

All 2026-10-08/15 Criticals remain fixed. Register entries (card grid recipe, ambient washes,
700-tier, unlayered accent block, off-grid breakpoints) match current code — PASS-with-note.

## Surfaces swept (coverage statement)

- **Shell**: `Sidebar.tsx`, `SidebarPlaylistItem.tsx`, `TopBar.tsx`, `PlayerBar.tsx`, `Layout.tsx`,
  settings rail `features/settings/components/Settings.tsx`, `PageState.tsx`, `ui/EmptyState.tsx`,
  `Skeletons.tsx`.
- **Overlays**: `ui/Modal.tsx`, `ui/ConfirmModal.tsx`, `AddToPlaylistModal.tsx`, `QueueModal.tsx`,
  `UploadModal.tsx`, `FetchMetadataModal.tsx`, `FetchLyricsModal.tsx`, `EditEntityModal.tsx`,
  `SharePlaylistModal.tsx`, `CreatePlaylistModal.tsx`, `SyncedLyricsEditor.tsx` (dialog),
  `ItemContextMenu.tsx`, `TrackActionsMenu.tsx`, `EntityActionsMenu.tsx`, `ColumnConfigMenu.tsx`,
  `AutoDjTunePopover.tsx`, `SleepTimerButton.tsx`, `LibrarySelector.tsx`, `FilterPanel.tsx`,
  `SearchBox.tsx` (dropdown), `ui/AutocompleteInput.tsx`, `NotificationContext.tsx` (toasts),
  `CoverArtLightbox.tsx`, `TopBar.tsx` (dropdowns), shared `ui/usePopoverMenu.ts`.
- **Context menus + new feature (7d65e59)**: all four context-menu hooks
  (`useSong/Songs/Album/ArtistContextMenu`, plus `usePlaylistContextMenu`),
  `useAddSongsToPlaylist.ts`, `lib/dragSongs.ts`, `stores/addToPlaylistStore.ts`,
  `AddToPlaylistModal.tsx`, `Sidebar.tsx` (playlist list), `SidebarPlaylistItem.tsx`,
  `ListRow.tsx`, `ui/Table.tsx`, `UploadModal.tsx`, mount points (`App.tsx`).
- **Buttons & raw elements**: full inventory of `components/ui/`; every raw
  `<button|<input|<select|<textarea|<a` across `web/src` (142/15/25 occurrences in 70 files —
  all reviewed except tests); `.btn*` classes in `index.css:167-245`; `ErrorBoundary.tsx`,
  `App.tsx`, `ActionButtons.tsx`, `PlayButton.tsx`, `PlayerControls.tsx`, `SponsorButton.tsx`,
  settings/admin/statistics/playlist control surfaces.
- **Lists/tables/views**: `ListRow.tsx`, `ui/Table.tsx`, `LibraryView.tsx`, `EntityDetail.tsx`,
  `EntityHeader.tsx`, `Card.tsx`, `ScrollRow.tsx`, `ui/VirtualGrid.tsx`, and the page surfaces
  under `features/` (albums, artists, tracks, playlists ×3, search, statistics, home,
  now-playing, settings ×all, admin, profile, auth).

## Critical (must fix)

- [ ] `web/src/components/ui/Table.tsx:238` — the playing row gets a full-row accent tint
  (`isPlayingTitle && 'bg-accent/10'`). The accent usage table is explicit: accent MUST NOT appear
  on card/list-item backgrounds, and the sibling `ListRow` deliberately signals playing with only
  a 2.5px left accent bar plus a "never a full-row accent fill" comment (`ListRow.tsx:152-155`).
  The Table row already carries the sanctioned signals — `PlayingIndicator` in the `#` cell
  (`Table.tsx:256`) and the `text-accent` title (`Table.tsx:206`) — so the tint is redundant and
  contradicts the app's own list idiom on the same screen surfaces (SongTable vs LibraryView).
  → Delete the `bg-accent/10` clause; keep the playing-bars indicator and accent title.
- [ ] `web/src/features/playlists/components/SharePlaylistModal.tsx:57` — the selected share-tab
  pill carries `shadow-sm` (`bg-accent text-bg-primary shadow-sm`). Hard rule: elevation exists
  only on floating transient layers; a selected tab is a persistent control and the zero-noise
  rule bans drop shadows outside floating layers. Grep confirms this is the only
  `bg-accent`+`shadow` co-occurrence in the repo. → Drop `shadow-sm` (the accent fill already
  carries the selected signal).

## Warnings (should fix)

**Shared modal primitive (affects every dialog in the app)**

- [ ] `web/src/components/ui/Modal.tsx:88-94` — dialogs render with no enter animation; the DS
  specifies ~400ms ease-out entry (toasts, NowPlaying, and menus all animate; the shared modal
  pops). → Add a keyframed entrance (opacity + slight scale, `cubic-bezier(0.16,1,0.3,1)`,
  `motion-reduce` fallback) on the dialog panel.
- [ ] `web/src/components/ui/Modal.tsx:78-86` — no scroll-bleed prevention: the page behind the
  `bg-black/60` backdrop keeps scrolling while a modal is open (only `NowPlaying.tsx:196` locks
  body overflow today). → Lock `document.body` overflow on open, restore on close (counter for
  nested modals).

**Overlay behavior / a11y**

- [ ] `web/src/features/now-playing/components/QueueModal.tsx:47` — initial focus is moved into
  the panel but never restored on close: Escape/outside-click unmounts it while it holds focus
  and keyboard focus drops to `<body>` (`ColumnConfigMenu.tsx:42` and `usePopoverMenu` both
  restore). → Keep the trigger ref, `triggerRef.current?.focus()` on close.
- [ ] `web/src/components/TopBar.tsx:78-91` — PlayersDropdown spreads `menu.menuProps`
  (`role="menu"`) around static player-info rows with no `menuitem`s; `usePopoverMenu`'s
  focus-on-open finds nothing and screen readers announce an empty menu. → Render this read-only
  content as a plain popover/`role="dialog"` (drop the menu role).
- [ ] `web/src/components/edit-entity/CoverArtLightbox.tsx:12-42` — pointer-only overlay: no
  Escape handler, no focus move-in/trap, no focus restore; keyboard users cannot close it.
  → Add document keydown Escape→`onClose`, focus the close button on open, restore on unmount.
- [ ] `web/src/components/FetchMetadataModal.tsx:420,434,444` and
  `web/src/components/FetchLyricsModal.tsx:271,280` — icon-only buttons ("Apply cover art",
  "Transfer value", "Revert") expose `title` but no `aria-label`; `title` is not announced
  consistently. → Add `aria-label` mirroring the title.
- [ ] `web/src/components/UploadModal.tsx:262` — during upload, `onClose` is silently replaced
  with a no-op: backdrop click, Escape, and the header X all render fully enabled (hover/active
  states) but do nothing. → Disable the header close (`disabled:` dimming + `cursor-not-allowed`)
  while `isUploading`, or route the request to abort.
- [ ] `web/src/contexts/NotificationContext.tsx:132-138` — toast dismiss is a bare text `×`:
  ~16px target, `opacity-70/100` hover only, no focus-visible ring, no hover fill, no
  `type="button"`. → Render a real icon button (`h-6 w-6` min + coarse overlay, `rounded-item`,
  `hover:bg-surface-hover`, `focus-visible:ring-2 focus-visible:ring-accent`).

**Accent-on-row-background idiom (same rule as the Table Critical, lower-stakes sites)**

- [ ] `web/src/components/LibrarySelector.tsx:71-73,88-90` — the selected listbox option uses a
  full-row accent fill (`bg-accent/10 text-accent`) while the app's menu idiom is `text-accent` +
  trailing check (never a row fill). → Replace with `text-accent` + check icon (or register the
  exception).
- [ ] `web/src/components/SidebarPlaylistItem.tsx:107` vs `web/src/components/UploadModal.tsx:354`
  — two drag-over dialects, both putting accent on a surface background (`bg-accent/15 + ring` vs
  `bg-accent/10 + border`). → Unify on `bg-surface-hover` fill + accent ring so accent stays off
  row backgrounds (transient drop feedback counts as an active state, but one dialect is enough).

**Shadow on persistent controls (siblings of the recorded Critical)**

- [ ] `web/src/features/songs/components/SyncedLyricsEditor.tsx:626` — lyric-pill buttons carry
  always-on `shadow-sm` as persistent in-canvas controls (elevation is only for drag ghosts/
  floating layers). → Drop the shadow or scope it to the transient drag state (cf.
  `ListRow.tsx:128`, which applies elevation only `isDragging`).
- [ ] `web/src/components/edit-entity/EditableCoverArt.tsx:60,75` — `shadow-sm` on the persistent
  cover-art edit/remove icon buttons sitting on the `bg-black/60` overlay. → Remove; the surface
  fill is enough separation. (Precedented by the 2026-10-15 grids note treating in-modal icon
  shadows as minor — either clean up or register the convention.)
- [ ] `web/src/components/FilterPanel.tsx:28` — the panel root's default class string carries
  `shadow-lg` on a static, in-flow panel; the sole consumer (`SearchBox.tsx:236`) neutralizes it
  with `shadow-none`. → Drop the default shadow so a future inline use doesn't inherit elevation.

**Buttons & raw elements**

- [ ] `web/src/index.css:183-192` — `.btn-ghost` defines no disabled state (unlike `.btn` /
  `.btn-danger` which have `disabled:cursor-not-allowed disabled:opacity-50`) — a disabled or
  loading ghost button stays fully opaque. → Add the disabled classes.
- [ ] `web/src/index.css:174-199` — `.btn`/`.btn-ghost`/`.btn-danger` are `h-10` (40px) with no
  `@media (pointer: coarse)` bump; JSX icon buttons all carry the coarse override but the CSS
  classes don't, so every text button misses the 44px touch floor on mobile. → Add
  `@media (pointer: coarse) { .btn, .btn-ghost, .btn-danger { height: 44px } }`.
- [ ] `web/src/components/ErrorBoundary.tsx:57-63` and `web/src/App.tsx:315-321` — raw `<button>`
  primary actions (`bg-accent … hover:brightness-110 … rounded-item`): hover **lightens** (the
  app convention is darken — `.btn` uses `brightness-95`), no active press, wrong radius token
  (accent buttons are `rounded-button` 16px, not `rounded-item`), bypass the Button primitive.
  → Replace with `<Button onClick={…}>Reload / Try again</Button>`.
- [ ] `web/src/features/playlists/components/CreatePlaylistModal.tsx:189-205,217-233` —
  playlist-type / smart-resolution segmented buttons receive `disabled` during save but define no
  `disabled:` classes (native disabled gives no dimming). → Add
  `disabled:cursor-not-allowed disabled:opacity-50`.
- [ ] `web/src/components/ActionButtons.tsx:18-40` — `FavoriteButton` renders `disabled` with no
  dimming classes and no active/pressed state (`.icon-btn:active` is not applied). → Add the
  shared `icon-btn` class + `disabled:opacity-40 disabled:cursor-not-allowed`.
- [ ] `web/src/components/LibrarySelector.tsx:41-57` — a list-opening picker renders as a
  borderless hover-fill row; the selection-vs-action register wants a quiet bordered field with
  the trailing chevron (the chevron + rotate-180 is correct). → Give the trigger
  `rounded-input border border-rule bg-surface hover:border-fg-secondary`, matching the
  FilterPanel/SharePlaylistModal select styling.

**Sidebar / shell**

- [ ] `web/src/components/Sidebar.tsx:335` (+ `PlayerBar.tsx:267`) — the desktop sidebar sits on
  `bg-surface`, one step up from the ground, i.e. its own raised panel; the DS sidebar rule is
  solid ground + hairline, never its own card. **However** `docs/design-language.md:33`
  documents exactly this ("`--surface` … Cards, sidebar, panels"), so it is a documented
  decision missing only its register entry (the card-grid recipe got the same treatment on
  2026-10-15). → Add a `.agents/design-overrides.md` entry (sidebar + player-bar surface-step)
  or move both to `bg-bg-primary`. The mobile drawer (`Sidebar.tsx:356`, `role="dialog"`) may
  keep `bg-surface` as an overlay under the modal exception.
- [ ] `web/src/components/Sidebar.tsx` nav rows + `web/src/components/SidebarPlaylistItem.tsx:102`
  — rows are `px-3 py-2 text-sm` ≈ 36px with no `[@media(pointer:coarse)]:min-h-11`, while the
  same file already coarse-bumps the header icon buttons (`Sidebar.tsx:228,241`). → Add the
  coarse min-height to `SidebarNavLink` and the playlist item link.
- [ ] `web/src/components/SidebarPlaylistItem.tsx:100` — `aria-label="Add dragged songs to
  ${playlist.name}"` on the playlist nav `Link` **replaces** its accessible name: screen-reader
  users hear a drag hint instead of the playlist name, permanently, on every non-smart playlist.
  → Drop the `aria-label`; expose the drop affordance via visually-hidden text or
  `aria-describedby` that complements the name.
- [ ] `web/src/features/settings/components/Settings.tsx:64` — the settings-rail active item
  paints its accent bar as an arbitrary inset box-shadow
  (`shadow-[inset_2px_0_0_0_hsl(var(--accent))]`) instead of the real-element idiom used
  everywhere else (`absolute left-0 h-5 w-0.5 rounded-full bg-accent`). → Replace with the
  `SidebarNavLink` span idiom.

**Lists / views / content structure**

- [ ] `web/src/components/LibraryView.tsx:347,356,365,608` (+ `features/settings/components/Settings.tsx:47`, `features/statistics/components/StatisticsView.tsx:748`, `components/ui/EmptyState.tsx:32`) — page-level titles render as `<h2>` and several pages have no `<h1>` at all (the TopBar brand is a link, not a heading). Headings start at level 2 — a level skip that propagates into EmptyState. → Render page titles as `<h1>`; keep h2 for in-page sections. Sibling: `features/artists/pages/Artist.tsx:290`, `features/years/pages/Year.tsx:75,83`, `features/genres/pages/Genre.tsx:210,218`, `features/composers/pages/Composer.tsx:68`, `features/labels/pages/Label.tsx:79,87` — subsection titles are `h3` directly under the entity `h1`, skipping h2 (and diverging from `ScrollRow.tsx:37`, which uses h2 for the same "Albums" title when albums exist).
- [ ] `web/src/features/statistics/components/StatisticsView.tsx:146,212,238` — accent on static
  chrome/text: every SectionCard icon is `text-accent` (:146), the "Listening time" eyebrow label
  is `text-accent` (:212), and top-3 rank badges are `text-accent` (:238). None of these are in
  the accent-allowed list (interactive/selected/progress). → Section icons + eyebrow →
  `text-fg-secondary`; rank badges quiet or registered as a deliberate top-3 highlight.
- [ ] Systemic — **the loading-choreography rule is unimplemented**: no `useDelayedVisible(loading,
  300)`-style hook exists anywhere in `web/src` (grep-verified; only `useDebounce`, unrelated).
  `PageState` renders its inline spinner instantly (flash on every sub-300ms load) and the
  `Skeletons.tsx` primitives fire undelayed as lazy-route fallbacks. → Introduce a shared
  `useDelayedVisible` hook: nothing <300ms, inline spinner 300ms–2s, skeletons >2s; gate route
  fallbacks the same way. (`AddToPlaylistModal.tsx:95`, `FetchMetadataModal`, `FetchLyricsModal`,
  `AutocompleteInput`, `SharePlaylistModal` user search all show instant spinners today.)

## Notes (consider)

- [ ] `web/src/index.css:169-171` — `.btn-pill` (Login sign-in full pill) is a deliberate brand
  moment per its code comment, but it has no `.agents/design-overrides.md` entry → register it
  (same treatment the card recipe got).
- [ ] `rounded-full` appears 88× across 41 files (icon buttons, avatars, pills, play buttons)
  while the DS shape table tops out at 16px — established app convention, but undocumented → add
  a `rounded-pill` token entry or a register note.
- [ ] `web/src/components/AddToPlaylistModal.tsx:100-103` — the "No playlists yet" empty state is
  a single muted sentence: no 40-48px muted icon / heading / single accent CTA as the empty-state
  recipe requires (the natural "Create playlist" CTA exists via `useCreatePlaylistModal`, used by
  the sidebar). → Adopt the standard composition.
- [ ] `web/src/components/FetchMetadataModal.tsx:353-357,392` / `FetchLyricsModal.tsx:233-237,258`
  — "No matches found" boxes are text-only empty states; transferred rows get
  `border-accent/50 bg-accent/5` (accent row background as a pending-change highlight, not in the
  accent-allowed list) → consider the shared empty-state layout and the check/text pattern.
- [ ] `web/src/features/playlists/components/SharePlaylistModal.tsx:366,471` — `handleRevokeLink`
  and per-row `handleRemoveShare` execute destructive actions with no ConfirmModal (the rest of
  the app confirms before destructive execution). → At least gate link revocation behind
  `ConfirmModal`.
- [ ] `web/src/hooks/useSongContextMenu.ts:43` — "Add to playlist" is not gated on
  `getShareToken() === undefined`, unlike `useSongsContextMenu.tsx:84`, `useAlbumContextMenu.ts:111`,
  and `useArtistContextMenu.ts:81`. Latent (no share-guest surface mounts this hook today), not
  user-facing. → Add the same gate for insurance.
- [ ] `web/src/components/ItemContextMenu.tsx` (+ `usePopoverMenu` consumers) — menu keyboard
  wiring is otherwise exemplary (arrows wrap, Home/End, Escape + focus restore, Tab-closes,
  initial focus, long-press with slop) but has no typeahead. → Optional printable-character
  jump-to-item in the shared hook.
- [ ] `web/src/components/TrackActionsMenu.tsx:134` vs `ItemContextMenu.tsx:308` — menu item
  icons are 16px vs 18px across the two menu families → pick one size.
- [ ] `web/src/components/TopBar.tsx:113` — UserMenu trigger hovers with `bg-surface` while every
  neighboring icon trigger uses `bg-surface-hover` → align.
- [ ] `web/src/components/Sidebar.tsx:333` — the desktop `aside` landmark has no `aria-label`
  (the mobile drawer does, "Navigation") → add e.g. `aria-label="Library"`.
- [ ] `web/src/components/ui/Table.tsx:232-233`, `LibraryView.tsx:462-463`, `ListRow.tsx:135-137`
  — rows are draggable with no drag affordance (no handle, no `cursor-grab`); discovery is
  trial-and-error (keyboard users have the context-menu path, so not blocking) → add
  `cursor-grab` or a hover-reveal handle.
- [ ] `web/src/components/Card.tsx:75` — the hover action-reveal scrim is a raw `bg-black/50`
  overlay; the registered card-grid override covers the zoom/fill/metadata but not the scrim, and
  the system bans raw non-token colors → add a `--scrim` token or register it.
- [ ] `web/src/features/statistics/components/StatisticsView.tsx:270` — `TopListRow` paints a
  proportional `bg-accent/[0.07]` data bar behind each row (aria-hidden); reads as data-viz
  (close to the allowed "progress" use) → register as the statistics data-bar idiom or move the
  bar into a dedicated track element.
- [ ] `web/src/features/now-playing/components/NowPlaying.tsx:325` — the queue/lyrics panel is a
  persistent surface with `bg-surface/80 backdrop-blur-xl` over the (sanctioned) ambient wash,
  staying translucent even when no dominant color is set → fall back to solid `bg-surface` when
  `--now-playing-color` is unset.
- [ ] `web/src/components/Sidebar.tsx:176,335`, `TopBar.tsx:307`, `PlayerBar.tsx:267`,
  `QueueModal.tsx:102`, `AutoDjTunePopover.tsx:139` — hairlines rendered at reduced token
  opacity (`border-rule/50`, `/60`) instead of the token's own opacity → standardize on plain
  `border-rule` or bake the intended opacity into the token.
- [ ] `web/src/features/home/pages/HomePage.tsx:443` — the featured slide title is an `h2`
  nested inside the "Featured albums" `h2` section → make slide titles `h3` (composes with the
  page-title h1 fix above).
- [ ] `web/src/components/TopBar.tsx:132-181`, `features/profile/components/UserSection.tsx:57-82`,
  `ItemContextMenu.tsx:288-303` — menu items indicate focus with a `bg-surface-hover` fill only,
  no 2px ring; consistent app-wide but lighter than the focus-ring rule → consider an inset ring
  or document the fill-as-focus convention.
- [ ] Carried from 2026-10-15 (no action then, none required now): `QueueModal.tsx:21` /
  `AutoDjTunePopover.tsx:37` `playBarHeight = 96` duplication; `Sidebar.tsx:338` drawer
  `env(safe-area-inset-top)` gap; `Layout.tsx:135` `p-6` gutters heavy on 360px phones; grid
  column counts derive from viewport not container (user-toggled rail changes content width at
  identical breakpoints); QueueModal stays an anchored popover at all widths rather than a mobile
  bottom sheet (conscious choice); `LibraryView.tsx:594`-style stepped `grid-cols-2…5` passed the
  2026-10-15 §5 sweep — within-breakpoint rigidity and infinite stretch past 1440px remain, best
  solved by container queries in a dedicated pass.

## Repository Hygiene

- [x] `AGENTS.md` defers visual decisions to the DS and names the override register — pass.
- [x] Override register exists; every *registered* deviation matches code — pass. **Gap**: this
  pass found five documented-but-unregistered conventions that need entries if kept: sidebar/
  player-bar surface-step (documented in `docs/design-language.md:33`), `.btn-pill`, the
  `rounded-full` pill convention, the statistics data-bar tint, and (if kept) in-modal icon
  shadows. The unregistered items are Warnings/Notes above, not Criticals.
- [x] Token-drift gate in CI (`ci.yml:39-41`) + under `pnpm test`; passes locally — pass.
- [x] About page with `© {year} Miquel Rosell Tarragó` (`SettingsAbout.tsx:39`) — pass.
- [x] `dist/` gitignored; no paywalls/subscription gating; no embedded privacy-policy screens —
  pass.
- [x] Single appearance seam (runtime writer + matching pre-paint bootstrap) — pass.
- [x] No `window.confirm/alert/prompt`; destructive flows route through `ConfirmModal` (the four
  context-menu hooks, `SidebarPlaylistItem` delete, `EditEntityModal`) — pass, except the
  SharePlaylistModal revoke/remove Note above.

## Verification highlights (what passed, sampled by reading code)

- `ItemContextMenu`/`usePopoverMenu`: APG menu semantics, roving focus, Escape-with-restore,
  Tab-closes, long-press with slop, ResizeObserver re-clamp — the model implementation.
- Destructive context-menu items are `text-danger` and every delete path opens a `ConfirmModal`
  before executing (`useSongsContextMenu.tsx:145-155`).
- `AddToPlaylistModal`: primary button disabled when selection empty, `loading` blocks duplicate
  submits, per-playlist failure toasts + query invalidation in `useAddSongsToPlaylist`.
- Drag-and-drop: custom MIME contract with parse guards (`lib/dragSongs.ts`), copy semantics,
  drag-ghost elevation only while dragging (`ListRow.tsx:128`).
- `Modal`: focus trap, initial focus, focus restore, Escape + backdrop dismiss,
  `aria-labelledby` with visible title, per-instance title ids — structurally sound (animation/
  scroll-lock gaps above).
- `ListRow` recipe verified end-to-end (48px rows, 600 title, hover fill, 2.5px accent bar,
  hover-reveal actions); TopBar 44px no shadow/tint; skip link + landmarks in `Layout`;
  `EmptyState` matches the register (44px muted icon, heading, one accent CTA); settings sections
  use the icon + muted-label grouped pattern with theme and accent selectors present; accent
  picker is exactly the DS-curated five.
