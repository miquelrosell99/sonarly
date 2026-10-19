## Design Language

The Sonarly web UI implements the Signal Archive brand identity (guidelines and assets in `brand-identity/sonarly/kit/B/`, canonical reference `docs/design-language.md`). Key conventions:

- Warm archival paper light theme and Archive Ink dark/OLED modes so album art is the hero.
- Default accent: Echo Copper (light `#9B541C`, dark/OLED `#DB8342`) — the brand's single signal; Settings → Appearance ships the RosellRamos-curated five: Copper, Green, Purple, Blue, Monochrome.
- Typefaces: Bricolage Grotesque (display + body), IBM Plex Mono (data, tabular figures).
- Shared semantic tokens in `web/src/index.css`, named as canonical Material You roles (`--md-sys-color-*`, single-track migration owner ruling 2026-10-19): `background`, `surface`, `surface-container-high`, `outline(-variant)`, `on-surface`, `on-surface-variant`, `primary`/`on-primary`, `error`, the semantic trio (`success`, `warning`, `info`), the registered chart extension (`--chart-1`–`--chart-10`), and the curated accent ramp (`--accent-copper`…), all documented in `docs/design-language.md`.
- Signature element: adaptive chrome that tints the player bar from the currently playing album's cover art via `useDominantColor`.
- Brand mark (open ring + copper echo dot) ships as `web/public/favicon.svg`, `favicon.ico`, and `app-icon.png`; never close the ring's gap or move the echo dot.

Update `docs/design-language.md` when changing tokens, typefaces, modes, or the signature element.
