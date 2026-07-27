## Design Language

The Sonarly web UI follows a Tidal-inspired premium music interface documented in `docs/design-language.md`. Key conventions:

- Near-black canvas in dark/OLED modes so album art is the hero.
- Mode-aware default accent: blue in light mode, cyan in dark/OLED mode.
- Typefaces: Space Grotesk (display), Inter (body), JetBrains Mono (data).
- Shared semantic tokens in `packages/web/src/index.css`: `--bg-primary`, `--surface`, `--fg-primary`, `--fg-secondary`, `--rule`, `--accent`.
- Signature element: adaptive chrome that tints the player bar from the currently playing album's cover art via `useDominantColor`.

Update `docs/design-language.md` when changing tokens, typefaces, modes, or the signature element.
