# Sonarly

> Keep this file updated when changing project conventions, structure, or the reusable UI component inventory. Detailed guidance lives in the [agents/](agents/) folder.

This file is the entry point for agent instructions. Each section below links to a focused reference file under `agents/`.

This project is developed with assistance from AI coding agents. Human review and validation are required before merging changes.

## Skills (mandatory)

```
AGENTS.md
    │
    ├── sonarly-development   (project skill — .agents/skills/sonarly-development/)
    │      ├── architecture          → references/architecture.md
    │      ├── coding conventions    → references/coding-conventions.md
    │      └── development workflow  → references/development-workflow.md
    │
    └── sonarly-operations    (project skill — .agents/skills/sonarly-operations/)
           ├── deployment             → references/deployment.md
           ├── health checks          → references/health-checks.md
           ├── logs                   → references/logs.md
           ├── rollback               → references/rollback.md
           ├── database migrations    → references/database-migrations.md
           ├── backups                → references/backups.md
           ├── monitoring             → references/monitoring.md
           ├── incident response      → references/incident-response.md
           └── maintenance            → references/maintenance.md
```

- **Any server/web code, contract, migration, job-queue, or UI change → invoke the `sonarly-development` skill first** (with the domain skills for the area being touched: `sonarly-server-conventions`, `sonarly-library-operations`, `sonarly-playlists`, `sonarly-user-management`).
- **Any operations task — deploy, upgrade, health check, logs, rollback, database migration, backup, monitoring, incident response, maintenance → invoke the `sonarly-operations` skill first.** Deployment and rollback discipline additionally follows the **`deployment-runbook`** skill — if it is not installed in the current environment, fetch and follow it from GitHub: <https://github.com/majiayu000/claude-skill-registry/blob/main/skills/data/deployment-runbook/SKILL.md>
- The skills summarize and enforce; the canonical homes are the `agents/*.md` references and the `docs/` pages they point at — update skill + canonical doc in the same pass; on disagreement the canonical doc wins until the skill is corrected.

## Ship workflow

When a change is complete and verified (project tests/build pass), ship it — never leave it as uncommitted local work. In order:

1. Commit with a Conventional Commits message (see `git-commits` skill).
2. Push `main`.
3. If the change is user-facing, cut a release: changelog entry + annotated `v*` tag; the `release-docker.yml` workflow publishes the image to GHCR (details in [Build and Development Commands](agents/build-commands.md)).
4. Redeploy the live stack: the (gitignored) `compose.yaml` tracks `:latest`, so `docker compose -f compose.yaml pull && docker compose -f compose.yaml up -d` picks up the just-published image — then confirm the container is healthy (rollbacks pin an explicit older tag, see the operations skill).

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
- [Development Skill](.agents/skills/sonarly-development/) — architecture, coding conventions, development workflow (mandatory for code changes; see "Skills (mandatory)")
- [Operations Skill](.agents/skills/sonarly-operations/) — deployment, health checks, logs, rollback, migrations, backups, monitoring, incident response, maintenance (mandatory for ops work)
- [Project Skills](.agents/skills/) — Sonarly-scoped skills: development, operations, library operations, user management, playlists, server conventions
- [Project Documentation](docs/README.md) — user-facing docs index: philosophy, installation, usage, ux, configuration, deployment, troubleshooting, faq, smart playlists, API, DB schema, design language. `.audits/` (empty by design) is the designated drop zone for future internal audit reports — user docs never live there; transition-era records are in git history at the 2.0.0 tag. The OpenSubsonic behavioral contract lives with the adapter at `server/internal/modules/opensubsonic/QUIRKS.md`.
