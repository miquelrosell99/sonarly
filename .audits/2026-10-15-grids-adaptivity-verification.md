# UI Audit: Sonarly web frontend — verification pass + §5/§8 sweep

Date: 2026-10-15 · Mode: re-audit per `rosellramos-design-system/references/audit-checklist.md` §0 —
verify the open findings of [2026-10-15 audit](./2026-10-15-rosellramos-design-system-audit.md)
against current code, then walk the checklist sections that report did not cover
(§5 Layout & grids, §8 Responsive & adaptivity). Builds on
[2026-10-08 audit](./2026-10-08-rosellramos-design-system-audit.md).

## §0 Verification — all six open warnings RESOLVED

| Finding (2026-10-15 report) | State | Evidence |
|---|---|---|
| `min-[420px]` off-grid (TopBar:305, StatisticsView:222) | PASS-with-note | Registered in `.agents/design-overrides.md` ("Off-grid breakpoint usages", large-phone floor rationale) |
| No token-drift CI gate | FIXED | `e87e510` — `node scripts/token-drift.mjs` runs in `.github/workflows/ci.yml:41` and under `pnpm test` |
| No About screen / copyright | FIXED | `fd4b26e` — `web/src/features/settings/pages/SettingsAbout.tsx:39`: `© {year} Miquel Rosell Tarragó` |
| MonthlyActivityChart raw `rounded-xl` | FIXED | `198e7a1` — no `rounded-xl` outside tokens remains in `web/src` |
| ColumnConfigMenu/PlayerBar `rounded-md` | FIXED | `198e7a1` — zero `rounded-md` in `web/src` |
| QueueModal no initial focus | FIXED | `8741d40` (commit message: queue popover radius token and initial focus) |

Arbitrary font sizes also zero (`198e7a1`). All other prior findings verified still-fixed by content grep.

## New findings this pass (§5 grids + §8 adaptivity sweep)

### Critical — fixed in this pass

- `web/src/components/ui/VirtualGrid.tsx:11` — `defaultGridColumns` stepped 3 columns at `width >= 640`, but `sm` is 480 since the 3.1.0 breakpoint move and the non-virtualized grids (`LibraryView.tsx`, `Skeletons.tsx`) go 3-col at `sm:` — the same surface rendered 2 columns below and 3 columns above the 150-item virtualization threshold at 480–640px. → `640` → `480` (done).
- `web/src/features/home/pages/HomePage.tsx:589` — featured-album pager dots were 8×8px interactive buttons, the primary swipe alternative on mobile. → 44×44px hit area with the dot as an inner span (done).

### Warnings — fixed in this pass

- `PlayButton.tsx:140` — inline row-hover play button 24×24px with no coarse-pointer adaptation → added `[@media(pointer:coarse)]:h-11 w-11` (FavoriteButton idiom).
- `QueueList.tsx:339,349` — Auto-DJ refresh/tune buttons 24×24px → same coarse bump.
- `index.css:231` — `.slider` 24px hit area on seek/volume sliders → coarse-pointer override to 44px.
- `AutoDjTunePopover.tsx:169,218` — segmented buttons `min-h-[36px]` → coarse bump to 44px.
- `Card.tsx:106` — card title `font-medium` contradicted `docs/design-language.md` ("Title in semibold") → `font-semibold`.
- `Sidebar.tsx:215,228` — "All playlists"/"Create playlist" ~30px buttons in the expanded sidebar (the 768–1024 touch-tablet nav) → coarse bump to 44px.
- Card grid-item recipe deviations (20px covers + scale-105 hover zoom + fill hover + 14px metadata) were documented in `docs/design-language.md` but unregistered → registered in `.agents/design-overrides.md` (undocumented deviation = Critical per §10 contract; now PASS-with-note).

### Notes (carried, no action)

- `QueueModal.tsx:21` / `AutoDjTunePopover.tsx:37` — `playBarHeight = 96` duplicates PlayerBar's `h-24`; extract a shared constant if the bar height ever changes.
- `Sidebar.tsx:338` — mobile drawer has no `env(safe-area-inset-top)` padding; close button can collide with notches in landscape.
- `Layout.tsx:135` — main content `p-6` at all widths; 24px gutters are heavy on a 360px phone (consider `px-4` below `sm`).
- Column counts derive from viewport breakpoints, not the container — the user-toggled sidebar rail changes content width at identical breakpoints (container queries would tighten this).
- QueueModal is an anchored popover at every width rather than a mobile bottom sheet — works (clamped above the player bar), kept as a conscious choice.
- `FetchMetadataModal.tsx` / `FetchLyricsModal.tsx` icon buttons keep `shadow-sm` inside modals — minor; shadows there read as part of the modal's transient layer.

## §5/§8 passes (from the surface-by-surface sweep)

- Card grids, list rows, tables, home rows, statistics grids, admin grids, settings grids, search results — gaps on the spacing scale, adaptive column derivation, list-row hover fill, table density, no masonry, no lazy-render jump. Surfaces swept by name are listed in the sweep notes.
- One nav per size class (Sidebar morphs full ↔ rail ↔ drawer, mutually exclusive); drawer focus trap + Escape; no content forks between size classes; NowPlaying/EntityHeader/featured hero morph correctly.
- Touch targets 44px verified on all swept chrome controls; safe-area insets on PlayerBar/NowPlaying.
- Breakpoints on the spec grid; the three off-grid literals registered with credible rationale.

## Repository Hygiene

- [x] AGENTS.md defers visuals to the DS and names the override register — pass.
- [x] Override register exists; entries cover every live deviation incl. the card recipe added this pass — pass.
- [x] Token-drift gate in CI + under `pnpm test` (`e87e510`) — pass.
- [x] About page with copyright (`fd4b26e`) — pass.
- [x] `dist/` gitignored; no paywalls; single appearance seam (runtime writer + matching pre-hydration bootstrap) — pass (verified 2026-10-15 report).
