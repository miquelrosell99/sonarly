# Sonarly Documentation

This folder contains the project documentation. Start here.

## Guides

| Document | What it covers |
|---|---|
| [deployment.md](deployment.md) | Docker deployment: production and development compose files, environment variables, volumes, permissions, updates, troubleshooting |
| [development.md](development.md) | Local and Docker-based development: setup, scripts, testing, database migrations, code conventions |
| [architecture.md](architecture.md) | Application structure: monorepo layout, server request pipeline, background workers, data flow, web app structure |
| [plan.md](plan.md) | Completed engineering plan (2026-09-26): Go rewrite track — preserved as project history |

## Feature deep dives

| Document | What it covers |
|---|---|
| [smart-playlists.md](smart-playlists.md) | Smart playlists ("smart filters"): rule model, fields, operators, resolve modes, compiler internals, API and UI |

## Reference

| Document | What it covers |
|---|---|
| [api.md](api.md) | Management REST API (`/api`, contract: `server/api/openapi.yaml`) and OpenSubsonic API (`/rest`) reference |
| [db-schema.md](db-schema.md) | SQLite database schema, tables, and conventions |
| [design-language.md](design-language.md) | UI design tokens, typography, and visual principles |
| [opensubsonic-quirks.md](opensubsonic-quirks.md) | The OpenSubsonic compatibility contract: envelope, auth, error codes, per-endpoint quirks |
| [cutover-readiness.md](cutover-readiness.md) | Production cutover runbook, go/no-go checklist, and rollback (completed 2026-09-26) |
| [audits/2026-09-24-backend-architecture-audit.md](audits/2026-09-24-backend-architecture-audit.md) | Full backend architecture audit: findings, target architecture, migration roadmap, implementation backlog |
| [audits/2026-09-25-frontend-architecture-audit.md](audits/2026-09-25-frontend-architecture-audit.md) | Full frontend architecture audit (Track 3): state model, player deep-dive, contract alignment, FF1–FF12 |

Related files in the repository root: [README.md](../README.md) (overview and quick start), [CHANGELOG.md](../CHANGELOG.md) (release notes), [CONTRIBUTING.md](../CONTRIBUTING.md) (contribution process), [SECURITY.md](../SECURITY.md) (vulnerability reporting).

Agent-oriented guidance (conventions, build commands, UI component inventory) lives in the [agents/](../agents/) folder, entry point [AGENTS.md](../AGENTS.md).
