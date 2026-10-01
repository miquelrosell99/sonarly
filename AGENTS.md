# Sonarly

> Keep this file updated when changing project conventions, structure, or the reusable UI component inventory. Detailed guidance lives in the [agents/](agents/) folder.

This file is the entry point for agent instructions. Each section below links to a focused reference file under `agents/`.

This project is developed with assistance from AI coding agents. Human review and validation are required before merging changes.

## Ship workflow

When a change is complete and verified (project tests/build pass), ship it — never leave it as uncommitted local work. In order:

1. Commit with a Conventional Commits message (see `git-commits` skill).
2. Push `main`.
3. If the change is user-facing, cut a release: changelog entry + annotated `v*` tag; the `release-docker.yml` workflow publishes the image to GHCR (details in [Build and Development Commands](agents/build-commands.md)).
4. Redeploy the live stack: bump the pinned image in the (gitignored) `compose.yaml` and run `docker compose -f compose.yaml pull && docker compose -f compose.yaml up -d`, then confirm the container is healthy.

Do this by default whenever it makes sense (completed features and fixes, including small ones) — it is standing authorization, not something to ask about each time. Only hold back when the user has said not to ship or the action would be hard to undo.

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
