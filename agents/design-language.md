## Design Language

The Sonarly web UI implements the Signal Archive brand identity (guidelines and assets in `brand-identity/sonarly/kit/B/`, canonical reference `docs/design-language.md`). Key conventions:

- Warm archival paper light theme and Archive Ink dark/OLED modes so album art is the hero.
- Default accent: Echo Copper (light `#9B541C`, dark/OLED `#DB8342`) — the brand's single signal; nine other palette accents (incl. monochrome) are user-configurable in Settings → Appearance.
- Typefaces: Bricolage Grotesque (display + body), IBM Plex Mono (data, tabular figures).
- Shared semantic tokens in `web/src/index.css`: `--bg-primary`, `--surface`, `--surface-hover`, `--rule`, `--fg-primary`, `--fg-secondary`, `--muted`, `--accent`, plus the semantic (`--danger`, `--success`, `--warning`, `--info`), chart (`--chart-1`–`--chart-10`), and accent palette tokens documented in `docs/design-language.md`.
- Signature element: adaptive chrome that tints the player bar from the currently playing album's cover art via `useDominantColor`.
- Brand mark (open ring + copper echo dot) ships as `web/public/favicon.svg`, `favicon.ico`, and `app-icon.png`; never close the ring's gap or move the echo dot.

Update `docs/design-language.md` when changing tokens, typefaces, modes, or the signature element.
