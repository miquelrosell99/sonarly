# Sonarly

A self-hosted music server for your own collection: it indexes the music folder you already have, serves it through the OpenSubsonic API so any Subsonic client works, and ships a dark, art-first web player for browsing and playback.

Your files stay on your disk in your folder structure — Sonarly indexes, never appropriates, and scans are read-only toward your files.

[![Go](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![OpenSubsonic](https://img.shields.io/badge/OpenSubsonic-1.16.1-FF6B6B)]()
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

<!-- Screenshot placeholder: add a representative UI screenshot here when available. -->

## Features

- **Filesystem-authoritative library** — point it at your existing music folder; there is no import step and no proprietary store. Scans are read-only; tag writes are explicit actions only.
- **OpenSubsonic-compatible API** at `/rest` — Feishin, Symphonium, Ultrasonic, DSub, and other Subsonic clients work out of the box.
- **Web player** — gapless playback, queue with Auto DJ, sleep timer, synced lyrics, Media Session/OS media keys, and a player chrome tinted from the current album art.
- **Library management** — automatic scanning (watcher + periodic), ingest drop folder with a review quarantine for unparseable files, chunked uploads, auto-organization into a configurable path pattern, duplicate strategies, and tag editing (Mutagen-backed).
- **Smart playlists** — rule-based playlists that re-resolve as the library changes, with per-user sharing, public sharing, and tokenized share links that open a guest player.
- **Multi-user with real boundaries** — per-user library assignment enforced on every browse, search, and stream; per-user favorites, ratings, history, and statistics.
- **Boring tech, one container** — a single Go binary with embedded SQLite, served as one Docker image with the web client baked in.

## Quick start

```bash
git clone https://github.com/miquelrosell99/sonarly.git
cd sonarly

cp .env.example .env
# Edit .env: SESSION_SECRET=$(openssl rand -hex 32) and LIBRARY_MUSIC=/path/to/music
cp docker/compose.yaml.example compose.yaml

docker compose up -d
```

Open `http://localhost:4533` — the first visit runs the setup wizard to create the admin account, and the first scan starts automatically. See [docs/installation.md](docs/installation.md) for the `docker run` variant and where data lives.

## Status

**2.0.0** — the server is a Go rewrite (cut over from the original TypeScript server on 2026-09-26) and is the production server. Always back up the database and your music before updates ([docs/deployment.md](docs/deployment.md#backup-and-rollback)).

## Documentation

| Document | What it covers |
|---|---|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/philosophy.md](docs/philosophy.md) | What Sonarly is for and the principles behind it |
| [docs/installation.md](docs/installation.md) | Quick start, first-boot setup, where data lives |
| [docs/usage.md](docs/usage.md) | User guide: adding music, scanning, browsing, player, playlists, admin, clients |
| [docs/ux.md](docs/ux.md) | Interface guide: layout, design language, keyboard access, states |
| [docs/configuration.md](docs/configuration.md) | Every environment variable |
| [docs/deployment.md](docs/deployment.md) | Docker deployment: install, upgrade, backup, rollback, permissions |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Problem → cause → fix |
| [docs/faq.md](docs/faq.md) | Frequently asked questions |
| [docs/smart-playlists.md](docs/smart-playlists.md) | Smart playlist rules and resolve modes |
| [docs/api.md](docs/api.md) | Native REST API and OpenSubsonic API reference |
| [docs/development.md](docs/development.md) | Development setup, scripts, tests |
| [docs/architecture.md](docs/architecture.md) | Module map, request pipeline, job queue |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution process |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

## Tech stack

- **Server**: Go 1.23, `net/http` + chi v5, SQLite via `modernc.org/sqlite` (pure Go, WAL), ffmpeg for transcoding, python3 + Mutagen for tag writes.
- **Web client**: React 18 + Vite 6 + Tailwind CSS 3, wouter, TanStack Query, Zustand, route-level code splitting.
- **Deployment**: single all-in-one image ([docker/Dockerfile](docker/Dockerfile)) built from the repo root.

## License

[GNU Affero General Public License v3.0](LICENSE).

Developed with assistance from AI coding agents; human review and validation are required before merging changes.
