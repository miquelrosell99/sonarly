# UI Audit: Sonarly web frontend vs RosellRamos design system

Date: 2026-10-15 · Scope: `web/src` re-audit building on
[2026-10-08 audit](./2026-10-08-rosellramos-design-system-audit.md) ·
Checklist: `rosellramos-design-system/references/audit-checklist.md`

Overall: the 2026-10-08 Criticals are all resolved — the `d581c5d` "curated 5-swatch
accent picker and RosellRamos DS alignment" commit fixed every one of them with
centralized radius tokens (`web/tailwind.config.js:24-32`), and `65b154d` trimmed the
accent contract to the DS-curated five. This pass verified all prior findings against
current code, fixed one leftover violation, brought the docs in line with the shipped
UI, and created the missing design-overrides register (`.agents/design-overrides.md`,
named in `AGENTS.md`).

## §0 Evidence sweep (all clean)

- `--color-*` legacy namespace: zero hits in `web/src`.
- Bare color aliases (`var(--primary)`, `var(--surface)`, …): zero hits.
- Hardcoded hex outside the token file: zero in component CSS.
- Canvas paint: only `SyncedLyricsEditor.tsx:318-336`; colors come from
  `getComputedStyle(document.documentElement).getPropertyValue('--fg-primary')` with a
  test-env fallback — allowed. `useDominantColor.ts` canvas only samples cover-art
  pixels (writes no token colors).

## Prior findings — resolution

**Criticals (2026-10-08): all 9 FIXED.**

- `window.confirm` bulk delete → routed through `ConfirmModal` (`useSongsContextMenu.tsx:130-140`).
- `.btn*` full-pill → `rounded-button` 16px; full-pill survives only as `.btn-pill` for the Login brand moment (`index.css:169-193`).
- Dialogs 16px → `rounded-sheet` 28px (`Modal.tsx:92`, `SyncedLyricsEditor.tsx:533`).
- Inputs 8px → `rounded-input` 12px (`index.css:201`, `Field.tsx:24`, `MonthlyActivityChart.tsx:209`).
- ListRow `bg-accent/10` tint → accent title text + `PlayingIndicator` bars (`ListRow.tsx:107-123`) — small-indicator rule satisfied.
- Static-surface shadows (6 sites) → all removed; repo-wide `shadow-*` now only on floating/transient layers.
- Statistics hero blobs + gradient number → plain `rounded-card` section, solid text (`StatisticsView.tsx:206-229`).
- Accent-in-gradient bars/chart → solid `hsl(var(--accent))` fills; repo-wide gradient-with-accent grep is zero.

**Warnings: fixed except the four carried below.** Press states (`:active` scale 0.97 +
darken, hover darkens), `--fg-secondary` at spec ~65%, semantic hues aligned to spec
with AA lightness retune, card radii all `rounded-card` 20px, chips at `rounded-input`,
TopBar 44px opaque 20/600, sidebar drawer Tab-cycles (focus trap), EmptyState unified
with 44px icon + `<h2>` + accent CTA, `env(safe-area-inset-bottom)` on PlayerBar and
NowPlaying, spec breakpoint grid in config, `font-bold` down to one documented
exception, popover radii all `rounded-popover` 8px, row hover `rounded-item`, 44px
close buttons, persistent-button shadows removed, settings section header idiom
matches spec, Checkbox `rounded-input`.

**Notes: theme-color meta repainted for OLED (`themeStore.ts:119-124`), font preload
added, toast `rounded-input`, ListRow title 600, unlayered accent block now a
documented decision → register entry.**

**Sanctioned deviation resolved:** the 9-accent picker is trimmed to exactly five
(`SettingsAppearance.tsx:17-23`, `themeStore.ts:30-36`, `index.html:46`: copper,
green, purple, blue, monochrome) — matches SKILL.md default 4; DS `tokens.md` already
names Sonarly's curated three.

## Critical (must fix)

None open. The one undocumented deviation carried from 2026-10-08 — ambient
dominant-color washes breaking "never put color on chrome" — is now documented in
`.agents/design-overrides.md` (register entry "Ambient dominant-color washes"), which
converts it to PASS-with-note per the overrides contract.

## Warnings (should fix)

- [ ] `TopBar.tsx:305`, `StatisticsView.tsx:222` — ad-hoc `min-[420px]` breakpoints outside the spec grid (480/768/1024/1440); the legacy `min-[640px]`/`min-[1280px]` usages are registered, these two are not → align to `sm:`/`md:` or register.
- [ ] `.github/workflows/ci.yml` — no token-drift gate (§9): the §0 greps pass by hand today but nothing enforces them → add the css-token-drift CI recipe (`rosellramos-design-system/references/web-patterns.md`).
- [ ] No About screen anywhere in `web/src` — §9 expects `© {year} Miquel Rosell Tarragó` in About; only `SponsorButton.tsx` exists → add a small About (settings footer or modal) with the copyright line.
- [ ] `MonthlyActivityChart.tsx:332` — breakdown panel at raw `rounded-xl` (16px), not a token → put it on the radius scale (`rounded-card` or `rounded-popover`).
- [ ] `ColumnConfigMenu.tsx:129,138` — trigger `rounded-md` (6px) + panel raw `rounded-lg`; `PlayerBar.tsx:82,163` — residual `rounded-md` → converge on `rounded-item`/`rounded-popover` tokens.
- [ ] `QueueModal.tsx:46-117` — non-modal queue popover still does no initial-focus move into the dialog (carried from 2026-10-08; acceptable for non-modal but focus-first-item would match `usePopoverMenu`) → add initial focus or document the exception.

## Notes (consider)

- [ ] `ExplicitTitle.tsx:18` (`text-[0.65em]`), `AutoDjTunePopover.tsx:199,252` (`text-[11px]`) — last three arbitrary font sizes; a full type scale in `tailwind.config.js` would retire them.
- [ ] Dominant-color washes (NowPlaying, HomePage hero, PlayerBar) — PASS-with-note per register; if saturation ever reads too loud on light mode, cap it in `useDominantColor`.
- [ ] Statistics hero `font-bold` — the app's one deliberate 700 tier; registered.
- [ ] `index.css:126-129` accent override block unlayered — deliberate (Tailwind 3.4 layer-dropping); registered. Revisit on Tailwind upgrade.
- [ ] Docs sweep this pass: `docs/design-language.md` + `agents/design-language.md` still described the nine-accent palette, `rounded-full` buttons, and cover-art shadows — all updated to the shipped state (5 accents, 16px buttons, no static shadows).

## Repository Hygiene

- [x] AGENTS.md exists, defers visual decisions to the DS, and now names the override register — pass (fixed this pass).
- [x] Override register exists at `.agents/design-overrides.md` with entries for every live deviation — pass (created this pass; skill registry at `rosellramos-design-system/references/overrides.md` updated with the Sonarly row).
- [ ] Token-drift CI gate — missing (see Warnings).
- [x] `dist/` gitignored (root `.gitignore:5`) — pass (verified this pass).
- [ ] About page with `© {year} Miquel Rosell Tarragó` — missing (see Warnings).
- [x] No paywalls / subscription gating / embedded privacy-policy screens — pass.
- [x] Single appearance seam: one post-hydration writer (`themeStore.ts:97-113`, class-based `theme-*`/`accent-*`) + the matching pre-hydration bootstrap in `index.html` — pass.
