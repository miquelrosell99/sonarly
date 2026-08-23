# Sonarly Design Language

A premium music interface for a self-hosted collection. The visual direction is deliberately Tidal-inspired: a near-black canvas that lets album art become the hero, with a single bright accent and refined typography.

## Subject and audience

- **Product:** Sonarly — self-hosted music server and player.
- **Audience:** People who curate their own digital music libraries and want them to feel like a paid streaming service.
- **Single job of the UI:** Present the user's collection as an immersive, personal catalog where playback feels immediate.

## Aesthetic recipe

| Reference | Share | Why |
|---|---|---|
| `luxury-industrial-minimalism` | 50% | Dark, refined surfaces, precise spacing, premium finishes. |
| `editorial-software` | 30% | Content as interface; large cover art, clear hierarchy, calm reading. |
| `futuristic-operating-system` | 20% | Dark panel workspace, real-time playback state, subtle ambient color. |

This is not a generic "dark mode + bright accent" choice. The dark canvas is specific to music apps: the user's album artwork is the actual content, and a dark stage makes that artwork pop.

## Color tokens

Semantic CSS custom properties in HSL. All components should use these tokens, not raw hex values.

| Token | Light | Dark | OLED | Usage |
|---|---|---|---|---|
| `--bg-primary` | `#F7F7F7` | `#0A0A0A` | `#000000` | App background |
| `--surface` | `#FFFFFF` | `#121212` | `#0A0A0A` | Cards, sidebar, panels |
| `--surface-hover` | `#F0F0F0` | `#1A1A1A` | `#141414` | Hover states |
| `--rule` | `#E5E5E5` | `#272727` | `#1F1F1F` | Borders, dividers |
| `--fg-primary` | `#0A0A0A` | `#FFFFFF` | `#FFFFFF` | Primary text |
| `--fg-secondary` | `#6A6A6A` | `#A7A7A7` | `#B3B3B3` | Muted/caption text |
| `--accent` | `#0066FF` | `#00D4FF` | `#00D4FF` | Active links, play buttons, focus rings |

### Configurable accent

The default accent is mode-aware: blue in light mode, cyan in dark/OLED mode. Users can override `--accent` through Settings → Appearance. Always test a custom accent against all three modes; bright accents may need different opacity or glow treatment in OLED mode.

## Typography

Loaded from Google Fonts (`packages/web/index.html`):

| Role | Typeface | Weights | Usage |
|---|---|---|---|
| Display / headings | **Space Grotesk** | 500, 700 | Page titles, section headers, player track title, logo wordmark |
| Body / UI | **Inter** | 400, 500, 600 | Labels, buttons, lists, captions |
| Data / times | **JetBrains Mono** | 400 | Durations, counters, timestamps |

Tailwind classes: `font-display`, `font-sans`, `font-mono`.

## Signature element

**Adaptive chrome from album art.** The player bar and home hero subtly tint using a muted dominant color sampled from the currently playing or featured album's cover art. A thin gradient line above the player bar and a soft background wash shift to match the artwork.

Why:
- Specific to a music player (not a generic dashboard).
- Makes the interface feel alive and personal.
- Differentiates Sonarly from a plain Tidal clone while staying in the same premium family.

Implementation: `packages/web/src/hooks/useDominantColor.ts` samples cover art via an offscreen canvas, mutes saturation, and returns an `hsl()` color that is applied through CSS custom properties (`--now-playing-color`).

## Layout principles

- **Full-height dark shell.** Top bar, sidebar, and player bar frame a scrollable main area.
- **Navigation recedes.** Sidebar uses muted text and a thin accent indicator for the active item.
- **Content breathes.** Generous padding, rounded corners (`rounded-xl` / `rounded-2xl`), and soft shadows on cover art.
- **Player bar is persistent.** Full-width progress scrubber, album thumbnail, centered transport controls, volume on the right.

## Components

### Buttons

- **Primary:** `.btn` — rounded-full, accent background, dark/light contrasting text.
- **Secondary:** `.btn-ghost` — rounded-full, rule border, surface background.

### Cards

- Rounded-xl cover art with a hover zoom and overlay.
- Play button appears on hover; favorite and rating in the top corners.
- Title in semibold primary; artist/year in secondary.

### Inputs

- `.input` — rounded-lg, surface background, rule border, accent focus ring.

### Interaction conventions

- Hover-only overlays (card actions, row play buttons) must also carry `group-focus-within/...:opacity-100` and the `.hover-reveal` utility, which forces visibility on touch devices (`@media (hover: none)`).
- A global `prefers-reduced-motion` dampener in `index.css` zeroes transition/animation durations; JS-driven animations (WAAPI, rAF count-ups, intervals) must check the media query themselves.
- Durations, counters, and timestamps use `font-mono` (JetBrains Mono); page titles and section headers use `font-display` (Space Grotesk).

## Modes

Light, dark, and OLED modes are supported via `theme-light`, `theme-dark`, and `theme-oled` classes on `<html>`. OLED uses pure black (`#000000`) for the background and slightly lighter surfaces to maximize contrast and battery life.

## Rejected alternatives

- **Warm cream + serif display:** A common AI default; felt wrong for a technical, music-first product.
- **Broadsheet hairline rules:** Too editorial and not tactile enough for a player.
- **Pure black dark mode:** Tried `#000000` for dark mode, but it made cover art feel harsh; `#0A0A0A` keeps depth while staying cinematic.
