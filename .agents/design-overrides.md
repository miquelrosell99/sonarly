# Design Overrides Register — Sonarly

Documented deviations from the [RosellRamos design system](/root/.agents/skills/rosellramos-design-system/SKILL.md). Contract: `rosellramos-design-system/references/overrides.md` — an undocumented deviation is drift; a documented one is a decision. Newest first; write the entry in the same pass as the deviation it records.

## Identity (adoption decisions)

Recorded per `rosellramos-design-system/identity/procedure.md` — the palette's hue direction, default theme, brand accent, and type stack are decided once at adoption. They are decisions, not deviations: the audit treats a registered identity as PASS-with-note. Full documentation lives in `docs/design-language.md` (the Signal Archive identity, adopted 2026-10-07; kit at `brand-identity/sonarly/kit/B/`).

### Identity — palette: warm

- **Rule**: `rosellramos-design-system/law/constitution.md` default 2 "Monochrome surfaces on a deliberate ground" — surfaces and text derive from ONE hue direction (warm / cold / neutral), chosen per app at adoption and recorded here.
- **Decision**: **Warm.** Ground `--md-sys-color-background` (legacy `--bg-primary`) `#EEECE6` (light, archival paper) / `#171513` (dark, Archive Ink) / `#000000` (OLED); text `--md-sys-color-on-surface` `#231A11` / `#F4F3F1`; surfaces `--md-sys-color-surface` `#FFFFFF` / `#322920` near-neutral-warm; hover `--md-sys-color-surface-container-high` `#E4E2DC` / `#493F35`; hairline `--md-sys-color-outline(-variant)` `#CFCBC1` / `#5D534A` (exact values in `web/src/index.css` theme blocks and `docs/design-language.md` "Color tokens").
- **Rationale**: The Signal Archive identity — a warm archival paper stage by day, a warm ink dark room by night, so album artwork (the actual content) stays the hero. Canonical doc: `docs/design-language.md` (aesthetic recipe + color-token table).
- **Scope**: global — all three theme modes.
- **Ruled**: 2026-10-19 agent session, registering the adoption decision made with the brand identity on 2026-10-07.
- **Review trigger**: brand refresh; a palette rework; a constitution change to default 2.

### Identity — default theme: Auto (follow system)

- **Rule**: `rosellramos-design-system/law/constitution.md` default 1 "Themes ship complete" — "Which theme is the default is a per-app identity decision — dark-first is common in the fleet, not law."
- **Decision**: **Auto.** `web/src/stores/themeStore.ts` boots with `themeMode: 'auto'` and resolves against `prefers-color-scheme` (light/dark), persisting the resolved value; OLED is opt-in only. The `index.html` pre-paint bootstrap mirrors the same defaults.
- **Rationale**: A music library is used around the clock; matching the system respects the user's environment without a first-run forced choice. Owner never ruled dark-first for sonarly.
- **Scope**: global — the appearance seam default (Settings → Appearance can still pin light/dark/OLED per user).
- **Ruled**: 2026-10-19 agent session, registering the behavior shipped since pre-2.0.
- **Review trigger**: a ruling for dark-first; onboarding/first-run redesign; a constitution change to default 1.

### Identity — brand accent: Echo Copper

- **Rule**: `rosellramos-design-system/law/constitution.md` default 4 "One functional accent active at a time, from a small curated picker" — the brand accent is a per-app identity decision made at adoption; there is no fleet default hue.
- **Decision**: **Echo Copper**, the brand's single signal: seed pair `#9B541C` (light, `--accent-copper: 26 69% 36%` → `[data-accent='copper']`) / `#DB8342` (dark + OLED, `25 68% 56%`). Picker ships the curated five(commit `65b154d`): Copper (default), Monochrome (the seed follows `--md-sys-color-on-surface`), Green, Purple, Blue. Saturated hues lighten on dark/OLED grounds so the ground-colored `--md-sys-color-on-primary` label keeps WCAG AA.
- **Rationale**: "One stamp of colour" on the archival paper — Echo Copper is the signal nobody on the streaming shelf owns (rejected alternative: blue-family category code; `docs/design-language.md` "Rejected alternatives"). Superseding the launch-day monochrome default.
- **Scope**: global — the accent seam (`[data-accent]` blocks + the `--accent-*` picker ramp vars, `web/src/index.css`).
- **Ruled**: 2026-10-19 agent session.
- **Review trigger**: brand refresh; accent-picker rework; a constitution change to default 4.

### Identity — type stack: Bricolage Grotesque + IBM Plex Mono

- **Rule**: `rosellramos-design-system/law/constitution.md` default 5 "Typography: sans for chrome" — UI chrome in a grotesque sans (Instrument Sans or Bricolage Grotesque); monospace only for code/data.
- **Decision**: **Bricolage Grotesque** (variable, opsz `10..96`) for display + body/UI — 600 display/headings/wordmark, 400/500 labels/lists/captions; **IBM Plex Mono** (400/500) for data — durations, counters, timestamps, catalogue metadata. Tailwind: `font-display` / `font-sans` / `font-mono` (`web/tailwind.config.js`).
- **Rationale**: A catalogue's typographic discipline is half the Signal Archive identity; Bricolage's optical-size axis gives headings and the wordmark the same voice. Canonical doc: `docs/design-language.md` "Typography".
- **Scope**: global.
- **Ruled**: 2026-10-19 agent session, registering the adoption decision made with the brand identity on 2026-10-07.
- **Review trigger**: brand refresh; formal type-scale work; a constitution change to default 5.

## Deviations

### shadcn catalog adoption — button radius (SUPERSEDED 2026-10-19: fleet corner-full ruling applied)

- **Rule**: `rosellramos-design-system/law/spec.md` shape scale (M3 values refresh): **buttons are corner-full (9999px)** across the fleet.
- **Original decision** (2026-10-19 catalog migration): the normalized shadcn catalog (commit `b01253a`) kept sonarly's **registered 16px button shape** (`rounded-button` in `web/tailwind.config.js`; the `.btn` register in `web/src/index.css`) instead of the fleet's corner-full ruling, flagging it for the owner rather than applying it silently.
- **Supersession** (same day, owner order "full alignment, no shortcuts"): the owner ordered the ruling applied — sonarly's buttons flipped to corner-full in one token change (`rounded-button` 16px → 9999px, commit `30e8ba8`); the `.btn-pill` Login exception was absorbed (its pill is now the fleet default, class removed). Login surface and bridge-fixture captures at 1440/390 verified: every catalog button computes 9999px, no component assumed 16px, no scoped exception was needed. The bridge spec (`web/e2e/bridge-fixture.spec.ts`) now asserts the corner-full radius computed-behaviorally. The `rounded-full` circular-controls convention entry below is unchanged (it already was 9999px).
- **Ruled**: 2026-10-19 catalog migration (original entry); superseded by the fleet ruling the same day on the owner's order.
- **Review trigger**: a ruling against corner-full buttons; a DS shape-scale revision.

### Overlay authority — the app Modal stack owns dialogs; Radix catalog overlays for new surfaces

- **Rule**: `rosellramos-design-system/components/shadcn-bridge.md` checklist #8 "ONE overlay/Escape authority": reconcile the app's overlay manager with Radix's built-in overlay/focus-trap/Escape — pick one authority.
- **Decision**: The migration attempted porting `web/src/components/ui/Modal.tsx` onto the Radix Dialog primitives; it surfaced an unbridgeable contract conflict and was **reverted with the app implementation kept** (same-day attempt, not committed). The conflict: sonarly legitimately stacks INDEPENDENT sibling modals (a `ConfirmModal` over an edit `Modal` — the FF11 scenario) and its contract keeps the underneath layer fully accessible while the top is open (see `SyncedLyricsEditor.test.tsx` "Not applied before confirming"); Radix modal semantics hide everything outside the topmost dialog from the accessibility tree, and two sibling modal roots each hide the other — no stacking arrangement preserves the contract. Per the notees precedent (app overlay stack owns Escape; Radix's built-in disabled), **the app's Modal remains the dialog authority**; the normalized catalog `dialog`/`alert-dialog` (and the menu/popover/select/tooltip/command overlays, which carry no conflicting contract) are available for new surfaces. Migrating Modal to Radix remains possible only with a nested-dialog conversion of every sibling-stack call site.
- **Scope**: dialog-class overlays only. The catalog's non-dialog overlays (dropdown/popover/select/tooltip/command) are live and canonical. `ConfirmModal` is governed by this entry: every call site can open over another modal (the FF11 sibling stack — e.g. ConfirmModal over an edit Modal in SyncedLyricsEditor), so it composes the app `Modal` for the overlay and the catalog `Button` for the actions; converting any call site to the Radix `alert-dialog` would split the confirm contract into two accessibility behaviors. The catalog `alert-dialog` remains available for new surfaces that never stack as siblings.
- **Ruled**: 2026-10-19 catalog migration (attempt + reversion same session).
- **Review trigger**: a modal redesign; a decision to adopt Radix modal semantics (topmost-only accessibility) as the app contract.

### Single-track canonical token architecture (2026-10-19 migration)

- **Rule**: `rosellramos-design-system/law/spec.md` §1 (three-tier token architecture: one token file owns every value; color system tokens carry `--md-sys-color-*` and the §2 role names), §2 (the complete color-role map), §3 (the seed model: `[data-accent]` presets set only the seed, everything else derives) — FULL alignment, no shortcuts, no legacy-name aliases.
- **Decision**: Sonarly's web token file (`web/src/index.css`) was rebuilt on the canonical architecture in one single-track migration (commits `55e545b` tokens + rename, seam migration same day; the notees 2026-10-14 precedent). Every legacy role was re-expressed as a canonical role carrying the app's exact pre-migration values (byte-identical rendering; a rename, not a reskin): `--bg-primary` → `--md-sys-color-background`; `--fg-primary` → `--md-sys-color-on-surface` (+ `on-background`, same values); `--fg-secondary` and `--muted` → `--md-sys-color-on-surface-variant`; `--surface` → `--md-sys-color-surface`; `--surface-hover` → `--md-sys-color-surface-container-high` (the app's one neutral step-up surface owns the `-high` rung; `surface-container` rides the card surface for popovers/menus); `--rule` → `--md-sys-color-outline` AND `--md-sys-color-outline-variant` (one rule register for hairlines and interactive borders, both roles intentionally share the value); `--accent` (seed) → `--md-sys-color-primary`; `--danger` → `--md-sys-color-error`; `success`/`warning`/`info` keep their names as registered fleet semantic extensions. The 18-key prep alias layer was replaced by the canonical 20-key shadcn alias layer (`rulings.mjs` ALIAS_LAYER) — `--accent` is now the HOVER surface (`hover-overlay`) and `--muted` a container, the old name-collision deviation is resolved below. The derived primary family (`primary-container`/`on-primary-container`/`primary-hover`/`primary-pressed`, `error-container` pair) derives via `color-mix` per §3 and holds full colors (consumed raw, never `hsl()`-wrapped); state-layer overlays (`hover/focus/pressed-overlay`), `scrim`/`shadow`/`surface-tint` ship per §2/§4. The chart palette (`--chart-1…10`) stays a registered `--md-sys`-adjacent data extension consumed directly by canvas paints.
- **Identity decisions recorded alongside the architecture** (values unchanged by the migration): the ground-colored-label contract — `--md-sys-color-on-primary` and `--md-sys-color-on-error` are bound to the `background` role via a `var()` chain, so accent/destructive fills carry ground-colored labels in every theme and accent; and the single-hue identity has no second accent family, so `secondary` rides the neutral ramp (`secondary-container` shares the `-high` step). The appearance seam is the canonical `data-theme` / `data-oled` / `data-accent` attribute trio (constitution default 1, ONE writer): `useTheme.apply()` in `web/src/stores/themeStore.ts` resolves through the one pure resolver `web/src/lib/appearance.ts::resolveAppearanceAttributes`, and the pre-paint inline bootstrap in `web/index.html` mirrors it verbatim — `web/src/appearance-bootstrap-parity.test.ts` executes both against a scenario matrix and fails the gate on drift (constitution ruling 2026-10-15 closure). The `.theme-*` / `.accent-*` class seam was removed entirely.
- **Rationale**: the skill is the single structural source of truth; one architecture across the fleet, per-app identity only in values. Byte-identical output was the acceptance criterion: the warm ground (`#EEECE6`/`#171513`/`#000000`), Echo Copper accent, radii, elevation, and type stack are unchanged in computed values.
- **Scope**: global — the whole web token file, tailwind color mapping (`web/tailwind.config.js`), every component reference (136 files), the appearance seam, and the drift gate (`web/scripts/token-drift.mjs` now enforces the canonical `--md-sys-color-*` definition family and bans the legacy names).
- **Ruled**: 2026-10-19 agent session.
- **Review trigger**: a law revision to §1–§4; a palette rework; the shadcn catalog migration landing derived-role consumers (tailwind keys for the color-mix full-color roles).

### shadcn alias layer — `--accent` / `--muted` name collisions (RESOLVED 2026-10-19)

- **Rule**: `rosellramos-design-system/components/shadcn-bridge.md` "The alias mapping (what the generator emits)" — the alias layer defines all 20 shadcn theme keys as `var()` aliases of the role tokens, including `--accent` → hover overlay and `--muted` → surface container.
- **Original decision** (2026-10-19 prep pass): the app predated the md-sys role names, so the prep layer emitted 18 of 20 keys and deliberately did NOT redefine `--accent` (the brand seed app-wide) or `--muted` (the muted TEXT color); catalog refs were to be rewritten during per-component normalization.
- **Resolution**: the single-track canonical migration (entry above) renamed every seed use to `--md-sys-color-primary` and every muted-text use to `--md-sys-color-on-surface-variant`, freeing both names. The canonical 20-key alias layer is now emitted verbatim: `--accent` = `--md-sys-color-hover-overlay` (shadcn's hover surface), `--muted` = `--md-sys-color-surface-container`, `--muted-foreground` = `--md-sys-color-on-surface-variant`. No catalog rewrites needed for these two keys.
- **Review trigger**: a catalog component that cannot be normalized without a live reference to the old meanings (none expected).

### Now-playing panel translucency and hairlines (exception)

- **Rule**: SKILL.md default 6 "Zero visual noise" — no tinted overlays or translucency on persistent chrome; hairlines render at the `--md-sys-color-outline` token's own opacity.
- **Decision**: The NowPlaying queue/lyrics panel (`web/src/features/now-playing/components/NowPlaying.tsx:325-328`) stays on `bg-surface/80 backdrop-blur-xl` over the page — including when no dominant color is set — and keeps its hairlines at `border-rule/50`. The now-playing background is an exception; the solid-fallback idea is not applied here.
- **Rationale**: The panel floats over the (registered) ambient dominant-color wash; a fixed translucent scrim + backdrop blur is what keeps the queue/lyrics readable over a *changing* artwork-driven background, which a solid fill cannot do once the wash appears. The wash and the scrim are one immersive treatment. All other app chrome standardizes on solid surfaces and full-opacity `--md-sys-color-outline` hairlines (done 2026-10-18).
- **Scope**: surface — the NowPlaying queue/lyrics panel only. No other panel may use translucency over chrome.
- **Ruled**: 2026-10-18 audit; owner exception same day.
- **Review trigger**: now-playing redesign; removal of the ambient wash; a ruling against translucent chrome.

### Full-pill Login button (`.btn-pill`) (SUPERSEDED 2026-10-19: absorbed by the fleet corner-full ruling)

- **Rule**: Checklist §4 shape scale — buttons 16px (`rounded-button`); the DS shape table tops out at 16px.
- **Original decision**: The Login page sign-in button kept a full pill (`border-radius: 9999px`) via the `.btn-pill` class (`web/src/index.css`), over the app-wide 16px `.btn` radius — a deliberate brand moment documented by its in-code comment; the rest of the app was uniformly 16px.
- **Supersession**: Made corner-full the fleet-wide button shape, so the pill stopped being an exception. `.btn-pill` and its unlayered override block were removed (commit `30e8ba8`); the Login button now renders corner-full through the shared `rounded-button` token like every other button.
- **Ruled**: code comment pre-2026-10-08; registered 2026-10-18; superseded 2026-10-19.
- **Review trigger**: none — the exception is gone; auth-page redesign follows the standard button register.

### `rounded-full` pill convention (icon buttons, avatars, chips) (CONFIRMED 2026-10-26: circles, the notees precedent)

- **Rule**: `rosellramos-design-system/references/tokens.md` shape scale — `corner-full` (9999px) owns "avatars, circular icon buttons, toggle thumbs, sliders"; the DS table has no square icon-button step.
- **Decision**: `rounded-full` (9999px) is the app's convention for circular controls and containers: icon buttons, avatars, the play button, chips, pager dots, and toggle pills. Every icon-only button across the app rides it — top bar, sidebar (the playlists-section collapse/all/create trio included), catalog `size="icon"`, player-transport ghosts, queue and row actions, card hover actions and star ratings, modal chrome buttons, the search-box filter toggle, settings-rail and view-mode toggles, rule-block actions.
- **Ruling trail**: 2026-10-18 audit registered the convention; a same-day 2026-10-26 sweep squared every icon-only button to `rounded-item` on a misread of the owner's ask — the owner corrected it within the hour (hamburger screenshot vs the notees top bar): icon-only buttons are CIRCLES, "the correct pattern, skill should drink from it". The square detour was fully reverted and the remaining square icon-only buttons (sidebar, modal closes, view-mode toggles, etc.) converted to circles. The notees `Button` (shadcn catalog, `rounded-button` at every size including `icon`) is the reference implementation; the skill's law now states the register explicitly.
- **Scope**: global convention — icon-only controls, avatars, and chips are circular; icon CHIPS that are emblems inside tinted squares (statistics rank/avatar chips, stat-card leading icons) are containers, not buttons, and stay `rounded-item`.
- **Ruled**: 2026-10-18 audit; confirmed by (second pass).
- **Review trigger**: DS adds a square icon-button step; a shape-token sweep.

### Statistics proportional data-bar tint

- **Rule**: SKILL.md accent usage table — accent MUST NOT appear on card/list-item backgrounds.
- **Decision**: `StatisticsView.tsx:270` (`TopListRow`) paints a proportional `bg-accent/[0.07]` fill behind each statistics row as a data bar (aria-hidden).
- **Rationale**: It is a data-viz proportion indicator (the "progress" family of accent uses), not a selection or hover state; at 7% alpha it reads as a bar chart, not a row fill.
- **Scope**: component — the statistics top-list rows only.
- **Ruled**: 2026-10-18 audit.
- **Review trigger**: statistics page redesign; any second use of proportional row tints.

### Card hover action-reveal scrim (`bg-black/50`)

- **Rule**: Checklist §2 — zero hardcoded paint outside the token file; SKILL.md default 6 "no tinted overlays" on surfaces.
- **Decision**: `Card.tsx:75` renders a `bg-black/50` scrim over the cover on hover to legibility-mask the revealed action buttons.
- **Rationale**: A scrim is a legibility tool over photographic cover art (the art itself is untokenizable); black at 50% is the neutral choice that works across all themes and accents. The registered card-grid recipe covers the zoom/fill/metadata anatomy; this registers the scrim that rides with it.
- **Scope**: component — the Card hover action-reveal only.
- **Ruled**: 2026-10-18 audit.
- **Review trigger**: card redesign; introduction of a `--scrim` token (then convert).

### Card grid-item recipe (cover radius, hover zoom, hover fill, metadata size)

- **Rule**: `rosellramos-design-system/references/audit-checklist.md` §5 grid-item anatomy — cover radius 12px, hover raises the item border hairline→outline (no shadow, no scale above 1.02), metadata 12px muted.
- **Decision**: Sonarly cards (`web/src/components/Card.tsx`) use `rounded-card` (20px) covers with a `scale-105` hover zoom on the cover, a `bg-surface` full-item hover fill instead of a border raise, and 14px (`text-sm`) metadata.
- **Rationale**: Canonical project doc `docs/design-language.md` documents exactly this anatomy ("Rounded-card (20px) cover art with a hover zoom"); the Signal Archive identity treats the cover as the card's visual anchor. The scale applies to the cover only, never the card frame, and no shadow is involved.
- **Scope**: component — `Card.tsx` and surfaces rendered through it (all card grids).
- **Ruled**: 2026-10-15 audit; canonical doc predates the register.
- **Review trigger**: card redesign; grid-density work.

### Ambient dominant-color washes

- **Rule**: SKILL.md hard rule "Never put color on chrome" + default 6 "Zero visual noise" (no tinted overlays).
- **Decision**: The Now Playing page background, the HomePage hero, and the player bar tint from the currently playing / featured album's cover art via `useDominantColor` (`web/src/hooks/useDominantColor.ts`, applied through `--now-playing-color`).
- **Rationale**: Brand signature element of the Signal Archive identity (canonical: `docs/design-language.md` "Signature element"; `agents/design-language.md`). Deliberate immersive feature, confirmed in the 2026-10-08 DS audit as "record, not fix".
- **Scope**: surface — now-playing page, home hero, player bar only. No other chrome may pick up the wash.
- **Ruled**: 2026-10-15, registering the 2026-10-08 audit finding.
- **Review trigger**: player chrome or home page redesign; brand refresh; a ruling against chrome tinting.

### Statistics hero 700 weight tier

- **Rule**: `rosellramos-design-system/references/tokens.md` typography roles — 600 for titles/labels, one deliberate 700 tier at most.
- **Decision**: The statistics hero number (`web/src/features/statistics/components/StatisticsView.tsx`, `text-5xl font-bold`) is the app's single 700 use, marked with an in-code comment.
- **Rationale**: One high-impact data moment; the rest of the app is uniformly 600.
- **Scope**: component — that one hero stat only.
- **Ruled**: 2026-10-15 audit (documented in code by commit `d581c5d`).
- **Review trigger**: formal type-scale work; any second 700 request.

### Unlayered accent-override block in index.css

- **Rule**: `rosellramos-design-system/law/spec.md` §1 token architecture (layered cascade).
- **Decision**: The `[data-accent]` accent-override rules in `web/src/index.css` are deliberately outside `@layer base` (comment in the file explains).
- **Rationale**: Tailwind 3.4 intermittently drops small hand-written rule runs inside layers; unlayered CSS passes through untouched and beats `@layer base` in the cascade — exactly what an override wants.
- **Scope**: global token file.
- **Ruled**: code comment at `web/src/index.css` (pre-2026-10-08, class-based `.accent-*` at the time); selectors migrated to `[data-accent]` with the 2026-10-19 seam migration; registered 2026-10-15.
- **Review trigger**: Tailwind upgrade past 3.4; move to CSS-first theming.

### Off-grid breakpoint usages (`min-[640px]` / `min-[1280px]` / `min-[420px]`)

- **Rule**: `rosellramos-design-system/references/tokens.md` breakpoints — 480 / 768 / 1024 / 1440.
- **Decision**: `web/tailwind.config.js` ships the spec grid (`sm 480 / md 768 / lg 1024 / xl 1440`). A finite set of usages keeps an explicit off-grid boundary instead: `min-[640px]`/`min-[1280px]` in `TopBar.tsx` and `StatisticsView.tsx` (documented in the config comment), and `min-[420px]` in `web/src/features/shell/TopBar.tsx:305` (wordmark) + `web/src/features/statistics/components/statistics-view/HeroStats.tsx` (hero-stat grid; was StatisticsView.tsx before the 2026-10-19 monolith split) — 420px exists so large phones (~430px CSS width) get the wordmark and a two-stat row that `sm:` (480px) would deny them.
- **Rationale**: migrating the 640/1280 boundaries changes layout at 640–1024px / 1280–1440px widths and needs visual verification, not a blind find-replace; the 420px boundary is a deliberate large-phone floor below the spec's smallest step.
- **Scope**: global, finite list — grep `min-\[640px\]|min-\[1280px\]|min-\[420px\]` before closing this entry.
- **Ruled**: 2026-10-15 audit (640/1280); min-[420px] registered 2026-10-15 in the audit-fix pass.
- **Review trigger**: any redesign touching TopBar or Statistics; a dedicated responsive pass.

## Fleet-alignment pass — rulings v2.0.4–v2.0.9 (applied 2026-10-26)

A batch of rulings landed in the skill on 2026-10-26 (plus the 2026-10-21 action-row criterion and two docs annotations). Sonarly's catalog had drifted into the retired registers; the owner's decision (this session) was full alignment, not new deviations. None of the items below is a deviation — this section records the alignment and the fleet/app split the rulings themselves draw.

### Button register — the borderless weight ladder (rulings v2.0.4–v2.0.6)

- **What changed**: every visible border retired from `web/src/components/ui/button.tsx` (accent fill > neutral fills > ghost > soft-danger wash); `danger` moved off the naked outline-to-fill style (retired same-day by the owner as "read broken") onto the soft register — translucent `error-soft` wash + error text at rest, solid error fill on hover; an invisible 48px `::after` hit-area overlay now rides EVERY button (the old coarse-pointer `h-11` visible-box override went with it — the visible box rides the size token, the floor lives in the overlay). New tokens: the `--md-sys-color-{error,success,warning,info}-soft` family (12% color-mix washes, generated per theme — drift-gate role set updated to admit them).
- **App-side registers kept** (the ruling's explicit fleet/app split): the solid `destructive` variant (confirmed destructive), the app's hover register on the neutral variants — the solid `surface-container-high` step the bridge fixture pins, not the starter's overlay ink — the brightness hover/press tactile register, the loading register (spinner + `aria-busy`), the `link` variant, and the `default` = accent-fill naming (the fleet's neutral `default`-on-`surface-container` rest is a no-op here: sonarly's `surface-container` == `surface`).
- **Ruled**: 2026-10-26 agent session.
- **Review trigger**: a DS revision to the button register; a danger-variant redesign.

### Selected chrome — the container register (ruling v2.0.7)

- **What changed**: solid-accent selected states converted to `primary-container` + `on-primary-container` ("never a solid accent box" stands; container != solid): statistics `RangeSelector`, the share-playlist `TabButton`, and the appearance page theme tiles (which also lose the accent border — `border-transparent` keeps box-size parity with the unselected tiles). New tailwind keys `primary-container` / `on-primary-container` (full-color color-mix roles, consumed raw, no alpha modifiers).
- **Ruled**: 2026-10-26 agent session.
- **Review trigger**: a DS revision to the selected-chrome register.

### Dialog radius — 16px centered dialogs (ruling v2.0.8)

- **What changed**: new `rounded-dialog` tailwind token (16px); `Modal`, the catalog `dialog`/`alert-dialog`, and the desktop `SyncedLyricsEditor` dialog moved off `rounded-sheet` (28px). `rounded-sheet` keeps 28px for edge-anchored bottom sheets only — the mobile full-screen lyrics surface included.
- **Ruled**: 2026-10-26 agent session.
- **Review trigger**: a DS shape-scale revision.

### Tab indicator — the short centered sliding bar (ruling v2.0.9)

- **What changed**: `TabNav` retired the full-width 2px accent underline (the old recipe) for the fleet idiom — ink text (weight 500) + a 16px centered accent bar. Text was already ink; only the indicator changed. The sidebar's active item (accent text + left accent bar) is nav chrome, not a tab strip, and is untouched.
- **Ruled**: 2026-10-26 agent session.
- **Review trigger**: a tab-strip redesign.

### Text fields — the underline register (law/spec.md

- **What changed**: the `Input` primitive's default became the underline register (transparent, no box, straight bottom hairline; focus paints the 2px accent underline and the field opts out of the app-global focus ring — the underline IS the focus indicator). Labeled form fields across login/signup/setup, profile, admin user/library modals, playlist create/rename, settings, and smart-playlist editors ride it with no call-site change. `variant="boxed"` retains the old register (12px radius, surface fill, accent focus border + ring) for the ruling's own reservation — dense toolbar rows and compact in-row edits: TopBar `SearchBox`, `AutocompleteInput`/comboboxes, the library `FilterPanel`, inline genre rename/add, the share-link copy row, playlist-filter and user-share searches, the lyrics line editor, and `TagInput`.
- **Noted gap**: the ruling's "accent-colored label on focus" presumes coupled floating labels; sonarly's forms use static labels, so only the underline carries the accent. Recorded so a future floating-label pass knows the label half is unimplemented.
- **Ruled**: 2026-10-26 agent session.
- **Review trigger**: a form-design pass; floating labels.

## Resolved entries (kept for history)

### Chrome surface-step (sidebar, player bar on `--surface`) (RESOLVED 2026-10-26: deviation retired, all chrome on the ground)

- **Rule**: SKILL.md default 3 — solid sidebar on the ground color; checklist §7 "Sidebar — solid ground color, hairline separator, never its own card".
- **Original decision** (2026-10-18 audit): the desktop sidebar and the player bar sat on `--md-sys-color-surface`, one step up from the `--md-sys-color-background` ground, while the top bar stayed on the ground — the "two warm tonal steps" framing of the Signal Archive identity (canonical doc: `docs/design-language.md` token table).
- **Resolution**: the split two-tone chrome read wrong in practice (paper top bar against white sidebar/player bar). All persistent chrome — sidebar, player bar, top bar — now sits on the ground: one continuous paper chrome frame, the fleet default, and the deviation retires. The mobile drawer keeps `bg-surface` as a `role="dialog"` overlay (the app dialog register, not persistent chrome). The v2.0.9 SidebarNav "chrome-on-canvas" exception class never applied (sonarly's shell is solid).
- **Ruled**: 2026-10-18 audit; resolved.

### Multi-hue accent picker (nine accents)

- **Rule**: SKILL.md default 4 — one accent active at a time from a curated ~5-swatch picker.
- **Decision**: shipped nine accent hues at launch(commit `c7a7f2e`).
- **Resolution**: trimmed to the DS-curated five (Copper, Green, Purple, Blue, Monochrome) on 2026-10-15 (commit `65b154d`). No longer a deviation; recorded here because the 2026-10-08 audit listed it as sanctioned.
