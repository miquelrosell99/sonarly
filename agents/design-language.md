## Design Language

The Sonarly web UI follows a Tidal-inspired premium music interface documented in `docs/design-language.md`. Key conventions:

- Near-black canvas in dark/OLED modes so album art is the hero.
- Default accent: monochrome (`--accent` follows `--fg-primary`); nine palette accents are user-configurable in Settings → Appearance.
- Typefaces: Space Grotesk (display), Inter (body), JetBrains Mono (data).
- Shared semantic tokens in `web/src/index.css`: `--bg-primary`, `--surface`, `--surface-hover`, `--rule`, `--fg-primary`, `--fg-secondary`, `--muted`, `--accent`, plus the semantic (`--danger`, `--success`, `--warning`, `--info`), chart (`--chart-1`–`--chart-10`), and accent palette tokens documented in `docs/design-language.md`.
- Signature element: adaptive chrome that tints the player bar from the currently playing album's cover art via `useDominantColor`.

Update `docs/design-language.md` when changing tokens, typefaces, modes, or the signature element.
