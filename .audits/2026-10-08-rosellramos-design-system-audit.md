# UI Audit: Sonarly web frontend vs RosellRamos design system

Date: 2026-10-08 · Scope: `web/src` (colors/tokens, shape/elevation/typography,
interaction/components/responsive/a11y) · Checklist: `rosellramos-design-system/references/audit-checklist.md`

Overall: the token architecture is exemplary — single source in `web/src/index.css`,
zero hardcoded hexes in components, zero raw Tailwind palette classes, contrast
test-enforced (`theme-contrast.test.ts`), and the theme system (Light/Dark/OLED/Auto,
pre-hydration bootstrap, server-synced) is the reference implementation. The violations
below are mostly radius/elevation drift and a handful of hard-rule breaks, plus two
deliberate deviations to record in the DS (multi-hue accent picker, ambient
dominant-color washes).

## Critical (must fix)

- [ ] `web/src/hooks/useSongsContextMenu.ts:94` — `window.confirm` for bulk song delete (hard rule: never native dialogs). A `ConfirmModal` exists and is used elsewhere; this hook bypasses it → route the delete through `ConfirmModal`.
- [ ] `web/src/index.css:159,162,168` — every `.btn`/`.btn-ghost`/`.btn-danger` is `rounded-full`. Token: buttons 16px (lg) / 12px (sm); full-pill is allowed only for the Login "Sign in" brand moment (`tokens.md`) → `.btn` to 16px, add a `btn-sm` at 12px, keep full-pill only on `Login.tsx:82` if the brand moment is intended.
- [ ] `web/src/components/ui/Modal.tsx:92`, `web/src/features/songs/components/SyncedLyricsEditor.tsx:533` — dialogs at `rounded-2xl` (16px) vs sheet/dialog token 28px → `rounded-[28px]` or a config token.
- [ ] `web/src/index.css:171` (`.input`), `web/src/components/edit-entity/Field.tsx:24`, `MonthlyActivityChart.tsx:210` — inputs at 8px vs 12px input token → `rounded-xl`.
- [ ] Static surfaces carrying drop shadows (hard rule: `box-shadow: none` on static surfaces):
  - `web/src/components/EntityHeader.tsx:38` — `shadow-lg` on entity cover
  - `web/src/components/Card.tsx:67` — `shadow-md` on album-card cover
  - `web/src/components/PlayerBar.tsx:82` — `shadow-md` on mini cover
  - `web/src/features/home/pages/HomePage.tsx:434` — `shadow-2xl shadow-black/30` on hero cover
  - `web/src/features/now-playing/components/NowPlayingCover.tsx:33` — `shadow-2xl shadow-black/40`
  - `web/src/features/admin/components/IngestStatusCard.tsx:102` — `shadow-sm`
  → remove; depth comes from surface-step + hairline.
- [ ] `web/src/features/statistics/components/StatisticsView.tsx:211-219` — blurred accent/chart radial blobs (`bg-accent/15 blur-3xl` + inline radial-gradient) as tinted overlays on a static hero card → remove blobs, keep hairline + surface-step.
- [ ] `web/src/features/statistics/components/StatisticsView.tsx:222` — gradient-filled hero number (`bg-gradient-to-r … bg-clip-text`) → solid `text-fg-primary`.
- [ ] Accent in gradients (accent must not appear in gradients):
  - `web/src/features/statistics/components/StatisticsView.tsx:420,453` — genre/year bar gradients
  - `web/src/features/statistics/components/MonthlyActivityChart.tsx:65,146` — chart area gradient
  → solid `hsl(var(--accent))` fill, or move data-viz to the existing `--chart-*` palette (`index.css:21-30`).
- [ ] `web/src/components/ListRow.tsx:117` — playing/active row uses a full `bg-accent/10` tint across the row. Spec: active row = small accent indicator ≤3px, never a full accent fill → drop tint or use a left accent bar like `Sidebar.tsx:65`.

## Sanctioned deviations (record in DS, not fix)

- [ ] `web/src/index.css:129-155` + `themeStore.ts:34-45` + `SettingsAppearance.tsx:17-28` — nine user-selectable accent hues + monochrome vs the DS one-accent rule. Owner decision 2026-10-07 (commit c7a7f2e), token-based so accent-usage rules hold for any hue → record Sonarly as a sanctioned exception in the DS.
- [ ] `web/src/features/now-playing/components/NowPlaying.tsx:36` + `hooks/useDominantColor.ts:90`, `PlayerBar.tsx:268-274`, `HomePage.tsx:563` — ambient dominant-color washes/glows on page backgrounds and the player bar. Deliberate immersive feature → record as intentional exception (if kept, consider a cap on saturation/opacity).

## Warnings (should fix)

- [ ] No active-press state anywhere — zero `active:scale|active:brightness|active:bg-` matches in `web/src`; `.btn*` (`index.css:158-169`) hover uses `brightness-110` (lightens; spec says darken) and has no `:active` → add `active:scale-[0.97] active:brightness-95` to `.btn*` and shared icon-button classes.
- [ ] `web/src/index.css:47,51,79,83` — `--fg-secondary`/`--muted` at 78% lightness (#c9c6c2) vs spec #a6a09a (~65%) — secondary hierarchy weaker than intended → darken to ~`30 6% 65%`, re-run `theme-contrast.test.ts`.
- [ ] `web/src/index.css:67-70,99-102` — semantic hues diverge from spec (danger salmon vs #ef5550; warning gold vs orange #f28b3f; success aqua vs #29b672). Lightness tuning for WCAG AA is legitimate; the hue drift (esp. warning) is brand-level → align hues with spec or record the alternate palette in the DS.
- [ ] Card radii never hit the 20px token and are inconsistent: `Card.tsx:55,67`, `SettingsCard.tsx:17`, `StatCard.tsx:11` at 12px; `StatisticsView.tsx:142,189,208`, `NowPlaying.tsx:325` at 16px; `HomePage.tsx:559` at 24px → standardize on 20px.
- [ ] Chips and segmented controls full-pill: `edit-entity/chipBits.tsx:5,8`, `CreatePlaylistModal.tsx:187,196,215,224`, `StatisticsView.tsx:165,174,190` → 12–16px per token scale.
- [ ] `web/src/components/TopBar.tsx:288` — 64px tall (spec 44px), translucent `bg-bg-primary/80 backdrop-blur` (no-tint rule), wordmark 20/700 (spec 20/600) → decide: amend spec for a 64px media-app top bar or trim.
- [ ] `web/src/components/Sidebar.tsx:299-329` — mobile drawer declares `aria-modal="true"` without a focus trap (Tab escapes to background) → add Tab cycle (pattern at `Modal.tsx:44-74`) or drop `aria-modal`.
- [ ] Empty states: `EmptyState.tsx:30` icon 24px (spec 40–48px), title is a `<p>` not a heading, CTA is ghost (spec: one accent CTA); same in `PageState.tsx:64-78` → bump icon, real heading, primary CTA. Also unify the two duplicate implementations.
- [ ] No `env(safe-area-inset-*)` anywhere — 96px PlayerBar and NowPlaying overlay sit under the home indicator on notched phones (`PlayerBar.tsx:266`, `NowPlaying.tsx:218`) → add `pb-[env(safe-area-inset-bottom)]`.
- [ ] Breakpoints: Tailwind defaults (640/768/1024/1280) + ad-hoc `min-[420px]` (`TopBar.tsx:304`) vs spec grid 480/768/1024/1440 → formalize if spec values are canonical.
- [ ] Titles/labels almost universally `font-bold` (700) vs token role 600 → standardize on `font-semibold`; keep 700 at most for one deliberate tier.
- [ ] No type scale: `tailwind.config.js` has no `fontSize` extension; arbitrary sizes in use (`text-[10px]` ×5, `text-[0.65em]`, `text-5xl/6xl`) → define the scale in config, replace arbitrary values.
- [ ] `web/src/features/organize/pages/Organize.tsx:51` — `<code>` with surface bg but no `font-mono` → add `font-mono`.
- [ ] `web/src/components/Avatar.tsx:31-32` — solid accent-filled avatar disc; not in the approved accent-usage list → default to surface variant, accent as ring/border only.
- [ ] Popover radii diverge: menus `rounded-md` 6px (`TrackActionsMenu.tsx:113`, `ItemContextMenu.tsx:281`, `EntityActionsMenu.tsx:38`, `SleepTimerButton.tsx:77`, `SearchBox.tsx:230`) vs dropdown panels `rounded-xl` 12px (`TopBar.tsx:81,129`, `LibrarySelector.tsx:62`, `AutocompleteInput.tsx:162`, `SharePlaylistModal.tsx:173`) → converge on the 8px popover token.
- [ ] List-row hover highlight `rounded-md` 6px vs 8px token (`TrackList.tsx:61,68`, `AlbumList.tsx:31`); small icon-only buttons at `rounded` 4px (`UploadModal.tsx`, `ColumnConfigMenu.tsx`, `SmartPlaylistBlockEditor.tsx`, `SettingsSidebar.tsx:82-100`) → 8px.
- [ ] `TopBar.tsx:62-75` — PlayersDropdown trigger icon-only button has `title` but no `aria-label` (every other icon button uses aria-label) → add for consistency.
- [ ] `QueueModal.tsx:107`, `AutoDjTunePopover.tsx:150` — 28px icon-only close buttons under the 44px floor → bump or add coarse-pointer hit area.
- [ ] `TransportControls.tsx:48` — `shadow-lg shadow-accent/30` on the persistent play/pause button; `PlayButton.tsx:118` — `shadow-lg` hover FAB on cards → not transient layers; remove or tokenize a "hero button" elevation explicitly.
- [ ] Settings section header idiom: 40px accent-tinted icon tile + semibold title vs spec "small icon + muted text, control right-aligned" (`SettingsCard.tsx:19-31`) → adjust idiom or amend spec.
- [ ] `Checkbox.tsx:39` — 6px radius while inputs are 8px → 12px input family for coherence.

## Notes (consider)

- [ ] `index.html:6-7` — theme-color meta hardcoded to light/dark grounds; not updated in OLED mode (minor).
- [ ] `ActionButtons.tsx:33,115` — `text-white` star icons on `bg-black/50` cover scrims: fine over imagery, but bypass tokens.
- [ ] `index.html:13-18` — Bricolage Grotesque + IBM Plex Mono load render-blocking without font `preload` → add preload to cut FOIT.
- [ ] `NotificationContext.tsx:120` — toast `rounded-md` (6px) on a notification card; radius should sit in the 12–20px family.
- [ ] `QueueModal.tsx:90-117` — non-modal popover dialog: no initial-focus move or restore (acceptable for non-modal, but focus-first-item would match `usePopoverMenu`).
- [ ] `ListRow` title 14px/500 vs spec 14px/600 — minor.
- [ ] `index.css:124-128` — accent-override block deliberately unlayered (Tailwind 3.4 layer-dropping bug, documented in comment) — load-order dependent; be aware.
- [ ] Settings SaveBar (draft + save bar) pattern is a nice addition beyond spec — no issue.

## Passes

- Zero hardcoded hex/rgb literals in component code; all color flows through `hsl(var(--token))` / Tailwind token classes.
- Zero default Tailwind palette classes (`bg-slate/gray/zinc/neutral/red/blue-…`).
- Tokens semantic and complete: ground #161412 exact, text #f4f2f1, accent copper #db8242/#9b531c exact; warm hairline rules; `color-scheme` set per theme.
- Accent usage on-token nearly everywhere: primary buttons, focus rings (~80 consistent `focus-visible:ring-accent`), chips/badges, favorite heart, play icon, 2px active nav indicators, links, sliders; no accent on sidebar/topbar/cards/headings.
- Theme system exemplary: Light/Dark/OLED/Auto, localStorage + pre-hydration bootstrap + system listener + server sync, unsaved-preview revert.
- Font stack correct: Bricolage Grotesque (UI/display) + IBM Plex Mono (code/data only); zero serif, zero other families.
- No sharp corners; full-pill correctly limited to avatars/circular buttons/sliders/progress.
- Shadows correct on genuine floating layers (menus, dropdowns, modal, drawer, toasts, tooltips) and drag ghosts (`ListRow.tsx:118`, `SyncedLyricsEditor.tsx:626`).
- Modal: focus trap, Escape, backdrop dismiss, focus restore, scrollable, `aria-labelledby`. Menus APG-grade (`usePopoverMenu`). SearchBox combobox + Ctrl+K.
- Skip link present; single `outline:none` has a real replacement; no clickable divs; all imgs have alt; icon-only buttons labelled; charts keyboard-operable with labels.
- Reduced motion thoroughly respected (global guard + per-animation opt-outs).
- Sidebar: solid surface on ground, hairline separator, active row = hover-fill + 2px accent bar, never accent-filled; rail + drawer modes.
- Settings: full page with rail (justified for nested categories), theme + accent selectors, accent picker is a proper radiogroup.
- Disabled/loading/error states present: `not-allowed` + 50% dim, spinners/skeletons with `role="status"`, inline `text-danger` errors with recovery action.
- Touch targets 44px on top-bar/sidebar-rail/player controls; favorite/star bump on coarse pointers.

## Repository hygiene

- [x] Project AGENTS.md exists and defers visual decisions to the DS skill — pass.
- [x] No hardcoded secrets / no embedded privacy-policy screens spotted in web/src — pass (not exhaustively verified).
- [ ] `dist/` gitignored — not verified this pass.
- [ ] App name Title Case + `© {year} Miquel Rosell Tarragó` in About — not verified this pass.
