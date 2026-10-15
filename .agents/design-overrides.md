# Design Overrides Register — Sonarly

Documented deviations from the [RosellRamos design system](/root/.agents/skills/rosellramos-design-system/SKILL.md). Contract: `rosellramos-design-system/references/overrides.md` — an undocumented deviation is drift; a documented one is a decision. Newest first; write the entry in the same pass as the deviation it records.

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

### Legacy `min-[640px]` / `min-[1280px]` breakpoints

- **Rule**: `rosellramos-design-system/references/tokens.md` breakpoints — 480 / 768 / 1024 / 1440.
- **Decision**: `web/tailwind.config.js` ships the spec grid (`sm 480 / md 768 / lg 1024 / xl 1440`); the few usages that must keep their old boundary (`TopBar.tsx`, `StatisticsView.tsx`) use explicit `min-[640px]` / `min-[1280px]` (documented in the config comment).
- **Rationale**: Migrating those boundaries changes layout at 640–1024px / 1280–1440px widths and needs visual verification, not a blind find-replace.
- **Scope**: global, finite list — grep `min-\[640px\]|min-\[1280px\]` before closing this entry.
- **Ruled**: 2026-10-15 audit.
- **Review trigger**: any redesign touching TopBar or Statistics; a dedicated responsive pass.

## Resolved entries (kept for history)

### Multi-hue accent picker (nine accents)

- **Rule**: SKILL.md default 4 — one accent active at a time from a curated ~5-swatch picker.
- **Decision**: shipped nine accent hues at launch(commit `c7a7f2e`).
- **Resolution**: trimmed to the DS-curated five (Copper, Green, Purple, Blue, Monochrome) on 2026-10-15 (commit `65b154d`). No longer a deviation; recorded here because the 2026-10-08 audit listed it as sanctioned.
