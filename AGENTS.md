# Sonarly

> Keep this file updated when changing project conventions, structure, or the reusable UI component inventory. Detailed guidance lives in the [agents/](agents/) folder.

This file is the entry point for agent instructions. Each section below links to a focused reference file under `agents/`.

This project is developed with assistance from AI coding agents. Human review and validation are required before merging changes.

## Reference

- [Agent Quick Reference](agents/quick-reference.md)
- [Technology Stack](agents/technology-stack.md)
- [Project Structure](agents/project-structure.md)
- [Architecture](agents/architecture.md)
- [Development Conventions](agents/development-conventions.md)
- [Reusable UI Components](agents/ui-components.md)
- [Design Language](agents/design-language.md)
- [Build and Development Commands](agents/build-commands.md)
- [User Settings & Preferences Storage](agents/user-settings.md)
- [Security Considerations](agents/security.md)
- [Skill References](agents/skills.md)
- [Project Skills](.agents/skills/) — Sonarly-scoped skills: library operations, user management, playlists, server conventions
- [Project Documentation](docs/README.md) — user-facing docs index: philosophy, installation, usage, ux, configuration, deployment, troubleshooting, faq, smart playlists, API, DB schema, design language. `.audits/` (empty by design) is the designated drop zone for future internal audit reports — user docs never live there; transition-era records are in git history at the 2.0.0 tag. The OpenSubsonic behavioral contract lives with the adapter at `server/internal/modules/opensubsonic/QUIRKS.md`.
