# Sonarly Documentation

This folder contains the user-facing project documentation. Start here.

## Getting started

| Document | What it covers |
|---|---|
| [philosophy.md](philosophy.md) | What Sonarly is for: filesystem-authoritative library, read-only scans, library-first browsing, OpenSubsonic compatibility, boring tech |
| [installation.md](installation.md) | Quick start with Docker, first-boot setup, where data lives |
| [usage.md](usage.md) | The user guide: adding music, scanning, browsing, the player, playlists, favorites, statistics, admin, Subsonic clients |
| [ux.md](ux.md) | The interface guide: layout, design language, keyboard access, states, performance behaviors |

## Configuration and operation

| Document | What it covers |
|---|---|
| [configuration.md](configuration.md) | Every environment variable: name, default, what it does, when to change it |
| [deployment.md](deployment.md) | Docker deployment in depth: install, upgrade, backup, rollback, permissions, health checks |
| [troubleshooting.md](troubleshooting.md) | Problem → cause → fix for common situations |
| [faq.md](faq.md) | Frequently asked questions |

## Feature deep dives

| Document | What it covers |
|---|---|
| [smart-playlists.md](smart-playlists.md) | Smart playlists ("smart filters"): rule model, fields, operators, resolve modes, sharing |

## Reference

| Document | What it covers |
|---|---|
| [api.md](api.md) | Management REST API (`/api`, contract: `server/api/openapi.yaml`) and OpenSubsonic API (`/rest`) reference |
| [db-schema.md](db-schema.md) | SQLite database schema, tables, and conventions |
| [design-language.md](design-language.md) | UI design tokens, typography, and visual principles |

Related files in the repository root: [README.md](../README.md) (overview and quick start), [CHANGELOG.md](../CHANGELOG.md) (release notes), [CONTRIBUTING.md](../CONTRIBUTING.md) (contribution process), [SECURITY.md](../SECURITY.md) (vulnerability reporting).

Development guides: [development.md](development.md) (setup, scripts, tests) and [architecture.md](architecture.md) (module map, request pipeline, job queue) — these are maintainer-oriented but kept with the user docs.

Agent-oriented guidance (conventions, build commands, UI component inventory) lives in the [agents/](../agents/) folder, entry point [AGENTS.md](../AGENTS.md).
