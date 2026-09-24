# Sonarly Documentation

This folder contains the project documentation. Start here.

## Guides

| Document | What it covers |
|---|---|
| [deployment.md](deployment.md) | Docker deployment: production and development compose files, environment variables, volumes, permissions, updates, troubleshooting |
| [development.md](development.md) | Local and Docker-based development: setup, scripts, testing, database migrations, code conventions |
| [architecture.md](architecture.md) | Application structure: monorepo layout, server request pipeline, background workers, data flow, web app structure |
| [plan.md](plan.md) | Living engineering plan: v2 Go rewrite track, v1 hardening track, frontend audit trigger + prompt |

## Feature deep dives

| Document | What it covers |
|---|---|
| [smart-playlists.md](smart-playlists.md) | Smart playlists ("smart filters"): rule model, fields, operators, resolve modes, compiler internals, API and UI |

## Reference

| Document | What it covers |
|---|---|
| [api.md](api.md) | Management REST API (`/api/`) and OpenSubsonic API (`/rest/`) reference |
| [db-schema.md](db-schema.md) | SQLite database schema, tables, and conventions |
| [design-language.md](design-language.md) | UI design tokens, typography, and visual principles |
| [audits/2026-09-24-backend-architecture-audit.md](audits/2026-09-24-backend-architecture-audit.md) | Full backend architecture audit: findings, target architecture, migration roadmap, implementation backlog |

Related files in the repository root: [README.md](../README.md) (overview and quick start), [CHANGELOG.md](../CHANGELOG.md) (release notes), [CONTRIBUTING.md](../CONTRIBUTING.md) (contribution process), [SECURITY.md](../SECURITY.md) (vulnerability reporting).

Agent-oriented guidance (conventions, build commands, UI component inventory) lives in the [agents/](../agents/) folder, entry point [AGENTS.md](../AGENTS.md).
