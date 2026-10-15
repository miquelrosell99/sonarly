# Design Overrides Register — Sonarly

Documented deviations from the [RosellRamos design system](/root/.agents/skills/rosellramos-design-system/SKILL.md). Contract: `rosellramos-design-system/references/overrides.md` — an undocumented deviation is drift; a documented one is a decision. Newest first; write the entry in the same pass as the deviation it records.

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

- **Rule**: `rosellramos-design-system/references/foundations.md` token architecture (layered cascade).
- **Decision**: The `[class*="accent-"]` override rules in `web/src/index.css` are deliberately outside `@layer base` (comment in the file explains).
- **Rationale**: Tailwind 3.4 intermittently drops small hand-written rule runs inside layers; unlayered CSS passes through untouched and beats `@layer base` in the cascade — exactly what an override wants.
- **Scope**: global token file.
- **Ruled**: code comment at `web/src/index.css` (pre-2026-10-08); registered 2026-10-15.
- **Review trigger**: Tailwind upgrade past 3.4; move to CSS-first theming.

### Off-grid breakpoint usages (`min-[640px]` / `min-[1280px]` / `min-[420px]`)

- **Rule**: `rosellramos-design-system/references/tokens.md` breakpoints — 480 / 768 / 1024 / 1440.
- **Decision**: `web/tailwind.config.js` ships the spec grid (`sm 480 / md 768 / lg 1024 / xl 1440`). A finite set of usages keeps an explicit off-grid boundary instead: `min-[640px]`/`min-[1280px]` in `TopBar.tsx` and `StatisticsView.tsx` (documented in the config comment), and `min-[420px]` in `TopBar.tsx:305` (wordmark) + `StatisticsView.tsx:222` (hero-stat grid) — 420px exists so large phones (~430px CSS width) get the wordmark and a two-stat row that `sm:` (480px) would deny them.
- **Rationale**: migrating the 640/1280 boundaries changes layout at 640–1024px / 1280–1440px widths and needs visual verification, not a blind find-replace; the 420px boundary is a deliberate large-phone floor below the spec's smallest step.
- **Scope**: global, finite list — grep `min-\[640px\]|min-\[1280px\]|min-\[420px\]` before closing this entry.
- **Ruled**: 2026-10-15 audit (640/1280); min-[420px] registered 2026-10-15 in the audit-fix pass.
- **Review trigger**: any redesign touching TopBar or Statistics; a dedicated responsive pass.

## Resolved entries (kept for history)

### Multi-hue accent picker (nine accents)

- **Rule**: SKILL.md default 4 — one accent active at a time from a curated ~5-swatch picker.
- **Decision**: shipped nine accent hues at launch(commit `c7a7f2e`).
- **Resolution**: trimmed to the DS-curated five (Copper, Green, Purple, Blue, Monochrome) on 2026-10-15 (commit `65b154d`). No longer a deviation; recorded here because the 2026-10-08 audit listed it as sanctioned.
