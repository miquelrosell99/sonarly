# Sonarly Design Language

The Sonarly web UI implements the **Signal Archive** brand identity (adopted 2026-10-07; guidelines and assets in `brand-identity/sonarly/kit/B/`). The visual direction: a warm archival paper surface and an Archive Ink dark room, one Echo Copper signal, and a catalogue's typographic discipline. Dark modes stay near-black so album art remains the hero.

## Subject and audience

- **Product:** Sonarly — self-hosted music server and player.
- **Audience:** People who curate their own digital music libraries and want them to feel like a paid streaming service.
- **Single job of the UI:** Present the user's collection as an immersive, personal catalog where playback feels immediate.

## Aesthetic recipe

| Reference | Share | Why |
|---|---|---|
| `archival-catalogue` | 50% | Warm paper, ruled lines, ink typography, one stamp of colour — the collection as an index. |
| `luxury-industrial-minimalism` | 30% | Refined dark surfaces, precise spacing, premium finishes. |
| `editorial-software` | 20% | Content as interface; large cover art, clear hierarchy, calm reading. |

The warm ground is specific to music apps: the user's album artwork is the actual content, and a quiet stage — paper by day, ink by night — makes that artwork pop without turning the product into a boutique-hifi pastiche.

## Brand assets in the app

- **Mark:** the open sonar sweep ring with the copper echo dot (`brand-identity/sonarly/kit/B/logo/master-symbol.svg`). Shipped as `web/public/favicon.svg` (small mark), `favicon.ico`, and `app-icon.png` (copper tile, 512). Misuse rules (never close the ring's gap, never move the echo dot) are in the kit's page 05.
- **Tokens:** the palette below is the source of truth; `brand-identity/sonarly/kit/B/tokens/tokens.css` holds the same values as design tokens (plus full colour scales).

## Color tokens

Semantic CSS custom properties in HSL, named as canonical Material You roles (`--md-sys-color-*`, RosellRamos design system law/spec.md §2; single-track migration owner ruling 2026-10-19). All components use these tokens (or the Tailwind utilities mapped to them), not raw hex values.

| Token | Light | Dark | OLED | Usage |
|---|---|---|---|---|
| `--md-sys-color-background` | `#EEECE6` | `#171513` | `#000000` | App background (archival paper / archive ink) |
| `--md-sys-color-surface` | `#FFFFFF` | `#322920` | `#17130E`-ish | Cards, sidebar, panels |
| `--md-sys-color-surface-container-high` | `#E4E2DC` | `#493F35` | warmer step | Hover states (the app's one step-up surface) |
| `--md-sys-color-outline` / `-outline-variant` | `#CFCBC1` | `#5D534A` | warmer step | Borders, dividers (one rule register, both roles) |
| `--md-sys-color-on-surface` | `#231A11` | `#F4F3F1` | near-white | Primary text |
| `--md-sys-color-on-surface-variant` | `#5D534A` | `#D7D3CF` | muted step | Muted/caption text |
| `--md-sys-color-primary` | `#9B541C` | `#DB8342` | `#DB8342` | Active links, play buttons, focus rings. Default accent is Echo Copper (see Configurable accent). Labels on primary use `--md-sys-color-on-primary`, bound to the background role (the ground-colored-label contract) |
| `--md-sys-color-on-primary` | = background | = background | = background | Text/icons on accent fills |

Legacy mapping (pre-2026-10-19 names, for git-history archaeology): `--bg-primary` → `--md-sys-color-background`, `--surface` → `--md-sys-color-surface`, `--surface-hover` → `--md-sys-color-surface-container-high`, `--rule` → `--md-sys-color-outline(-variant)`, `--fg-primary` → `--md-sys-color-on-surface`, `--fg-secondary`/`--muted` → `--md-sys-color-on-surface-variant`, `--accent` → `--md-sys-color-primary`, `--danger` → `--md-sys-color-error`.

Semantic palette (lightness set so 14px text meets WCAG AA on surfaces; verified in `web/src/theme-contrast.test.ts`):

| Token | Light | Dark/OLED | Usage |
|---|---|---|---|
| `--md-sys-color-error` | `#B4312B` | `#FE8477` | Errors, destructive actions |
| `--md-sys-color-success` | `#08795E` | `#3FC6A0` | Confirmations |
| `--md-sys-color-warning` | `#895D06` | `#C9AA37` | Cautions |
| `--md-sys-color-info` | `#196AAF` | `#66B2FD` | Informational |

Data (chart) palette, consumed by the statistics pages via `var(--chart-1)`…`var(--chart-10)` (unchanged by the brand — dataviz hues stay distinguishable):

| Token | Light | Dark/OLED |
|---|---|---|
| `--chart-1` | `#257EFF` | `#257EFF` |
| `--chart-2` | `#10B77F` | `#1FC68F` |
| `--chart-3` | `#F59F0A` | `#FFAC17` |
| `--chart-4` | `#8C40D9` | `#A667E4` |
| `--chart-5` | `#1AC9F4` | `#1FCEF9` |
| `--chart-6` | `#EF4343` | `#F05B5B` |
| `--chart-7` | `#F54799` | `#F754A6` |
| `--chart-8` | `#21C45D` | `#2ED16A` |
| `--chart-9` | `#FF7415` | `#FF8122` |
| `--chart-10` | `#4799EB` | `#54F7FF` |

### Configurable accent

The default accent is **Echo Copper** — the brand's single signal (owner decision 2026-10-07, superseding the launch-day monochrome default). Settings → Appearance offers the RosellRamos-curated five (owner trim 2026-10-15, commit `65b154d`): the brand accent plus **Monochrome** (the seed follows `--md-sys-color-on-surface`) and three curated hues.

| Accent | Token | Sample |
|---|---|---|
| Copper | `--accent-copper` → `[data-accent='copper']` | `#9B541C` (light) / `#DB8342` (dark) |
| Green | `--accent-green` → `[data-accent='green']` | `#21C45D` |
| Purple | `--accent-purple` → `[data-accent='purple']` | `#8C40D9` |
| Blue | `--accent-blue` → `[data-accent='blue']` | `#0066FF` |
| Monochrome | follows `--md-sys-color-on-surface` | — |

Users can override the accent through Settings → Appearance. Always test a custom accent against all three modes.

## Typography

Loaded from Google Fonts (`web/index.html`); the brand uses exactly two faces:

| Role | Typeface | Weights | Usage |
|---|---|---|---|
| Display / headings | **Bricolage Grotesque** | 600 (variable opsz) | Page titles, section headers, player track title, logo wordmark |
| Body / UI | **Bricolage Grotesque** | 400, 500 | Labels, buttons, lists, captions |
| Data / times | **IBM Plex Mono** | 400, 500 | Durations, counters, timestamps, catalogue metadata |

Tailwind classes: `font-display`, `font-sans`, `font-mono`. Bricolage's `opsz` axis is requested as a range (`10..96`), so browsers pick the right optical size automatically; headings track slightly tight (`tracking-tight`), echoing the wordmark.

## Signature element

**Adaptive chrome from album art.** The player bar and home hero subtly tint using a muted dominant color sampled from the currently playing or featured album's cover art. A thin gradient line above the player bar and a soft background wash shift to match the artwork.

Why:
- Specific to a music player (not a generic dashboard).
- Makes the interface feel alive and personal.
- Sits naturally on both brand grounds without fighting the copper signal.

Implementation: `web/src/hooks/useDominantColor.ts` samples cover art via an offscreen canvas, mutes saturation, and returns an `hsl()` color that is applied through CSS custom properties (`--now-playing-color`).

## Layout principles

- **Full-height shell.** Top bar, sidebar, and player bar frame a scrollable main area.
- **Navigation recedes.** Sidebar uses muted text and a thin accent indicator for the active item.
- **Content breathes.** Generous padding, tokenized corner radii (`rounded-card` 20px), and hairline rules — no shadows on static surfaces.
- **Player bar is persistent.** Full-width progress scrubber, album thumbnail, centered transport controls, volume on the right.

## Components

### Buttons

- **Primary:** `.btn` — corner-full pill radius (`rounded-button` token, 9999px fleet-wide per the 2026-10-19 owner ruling), accent background, contrasting text.
- **Secondary:** `.btn-ghost` — corner-full pill radius, rule border, surface background.

### Cards

- Rounded-card (20px) cover art with a hover zoom and overlay.
- Play button appears on hover; favorite and rating in the top corners.
- Title in semibold primary; artist/year in secondary.

### Inputs

- `.input` — 12px radius (`rounded-input` token), surface background, rule border, accent focus ring.

### Interaction conventions

- Hover-only overlays (card actions, row play buttons) must also carry `group-focus-within/...:opacity-100` and the `.hover-reveal` utility, which forces visibility on touch devices (`@media (hover: none)`).
- A global `prefers-reduced-motion` dampener in `index.css` zeroes transition/animation durations; JS-driven animations (WAAPI, rAF count-ups, intervals) must check the media query themselves.
- Durations, counters, and timestamps use `font-mono` (IBM Plex Mono); page titles and section headers use `font-display` (Bricolage Grotesque).

## Modes

Light, dark, and OLED modes are supported via the canonical appearance seam — `data-theme` (light/dark), `data-oled="true"`, and `data-accent` attributes on `<html>`, written by the one runtime writer (`useTheme.apply()`) and mirrored by the pre-paint bootstrap in `index.html` (parity-tested). Dark is Archive Ink (`#171513`); OLED keeps a pure-black ground (`#000000`) for battery life, with warm-tinted surfaces so it still belongs to the brand.

## Rejected alternatives

- **Pure-white light mode:** reads clinical next to the warm paper; `#EEECE6` gives the collection a place to sit.
- **Blue-family accents (the category code):** every competitor owns a corporate blue/cyan; Echo Copper is the one signal nobody on the shelf has.
- **Pure black dark mode:** tried `#000000` for dark mode, but it made cover art feel harsh; `#171513` keeps depth while staying cinematic.
