# Sonarly

A self-hosted music server that speaks the OpenSubsonic API and provides a premium, dark-themed web player for your personal music library.

[![Go](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![OpenSubsonic](https://img.shields.io/badge/OpenSubsonic-1.16.1-FF6B6B?logo=audioboom&logoColor=white)]()
[![Self-hosted](https://img.shields.io/badge/Self--hosted-✓-2EA043?logo=linux&logoColor=white)]()

> **Alpha software.** Sonarly is in early development and is not stable. Do not use it for music libraries you cannot afford to lose or re-import. Data loss, database resets, or incorrect file organization can happen due to bugs or incomplete features. Always keep separate backups of your audio files and database before importing, organizing, or updating.

<!-- Screenshot placeholder: add a representative UI screenshot here when available. -->

## What is Sonarly?

Sonarly organizes your music library, serves it through the **OpenSubsonic API** (so your favorite Subsonic clients just work), and provides a web management UI inspired by TIDAL's dark, art-first aesthetic.

The server is a single Go binary — it serves the web client, the SQLite database, the native management API at `/api`, and the OpenSubsonic-compatible API at `/rest`.

## Quick start

The fastest way to run Sonarly is with Docker Compose.

### Using the pre-built image

```bash
# 1. Clone the repository
git clone https://github.com/miquelrosell99/sonarly.git
cd sonarly

# 2. Configure the environment
cp .env.example .env
# Edit .env and set SESSION_SECRET to a random string of at least 32 chars.

# 3. Start Sonarly
docker compose -f compose.yaml up -d
```

### Building from source

The all-in-one image builds the web client and the Go server in one multi-stage build (build context is the repo root):

```bash
docker build -f docker/Dockerfile.v2 \
  --build-arg SONARLY_VERSION=$(git describe --tags --always) \
  -t ghcr.io/miquelrosell99/sonarly:v2.0.0-rc1 .
docker compose -f compose.yaml up -d
```

To run the pieces directly without Docker, see [docs/development.md](docs/development.md).

The web UI is available at `http://localhost:4533` (change with `SONARLY_PORT`). On first visit you will be redirected to `/setup` to create the admin account.

## Features

- **OpenSubsonic compatible** — works with Feishin, Symphonium, DSub, Ultrasonic, and any other Subsonic/OpenSubsonic client.
- **Modern web UI** — React + Vite + Tailwind CSS, with adaptive player chrome tinted from the current album art.
- **Auto-organization** — drop files into the ingest folder and let Sonarly rename them into a clean library pattern.
- **Cover and artist art** — reads embedded artwork, caches album covers, and fetches artist images.
- **Smart playlists** — create dynamic playlists from rules that update automatically.
- **Auto DJ** — let Sonarly keep the music going based on your library.
- **Self-hosted and containerized** — single Docker image with everything included.
- **Well tested** — the Go server and the React client each have extensive test suites that run on every change.
- **Tag editing** — write metadata back to files with Python Mutagen.
- **Users and permissions** — admin and regular user roles, with per-user library assignment enforced on every content path.
- **Multi-library support** — manage several media folders from the admin panel.

## Documentation

| Document | What it covers |
|---|---|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/deployment.md](docs/deployment.md) | Docker deployment, environment variables, volumes, upgrades, rollback, troubleshooting |
| [docs/development.md](docs/development.md) | Development setup, scripts, testing, database migrations |
| [docs/architecture.md](docs/architecture.md) | Server modules, request pipeline, data flow, web app structure |
| [docs/smart-playlists.md](docs/smart-playlists.md) | Smart playlists: rule model, fields, operators, resolve modes |
| [docs/api.md](docs/api.md) | Management REST API (`/api`) and OpenSubsonic API (`/rest`) reference |
| [docs/db-schema.md](docs/db-schema.md) | SQLite database schema and conventions |
| [docs/design-language.md](docs/design-language.md) | UI design tokens, typography, and visual principles |
| [CHANGELOG.md](CHANGELOG.md) | Release notes and notable changes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, testing, commit conventions, pull request process |
| [SECURITY.md](SECURITY.md) | Supported versions, vulnerability reporting, security practices |

## Project structure

```
.
├── v2/                     # Go server (the only server)
│   ├── cmd/sonarly/        # entrypoint
│   ├── internal/           # config, db, httpserver, modules/*, staticfs
│   ├── api/openapi.yaml    # native REST contract (OpenAPI 3.1)
│   └── testparity/         # v1↔v2 parity harness (skips without a v1 checkout)
├── packages/
│   └── web/                # React web client (Vite, Tailwind, react-query)
├── docker/
│   ├── Dockerfile.v2       # all-in-one image (web build → Go build → runtime)
│   ├── entrypoint.sh       # PUID/PGID privilege drop
│   └── compose.v2.yaml.example
├── compose.yaml            # Production deployment (gitignored, copy from example)
└── .env.example            # Required environment variables
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                Sonarly container                │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │          Go server (port 3000)            │  │
│  │                                           │  │
│  │   /rest/*  OpenSubsonic adapter           │  │
│  │   /api/*   native management REST API     │  │
│  │   /*       built React web client (SPA)   │  │
│  │                                           │  │
│  │   worker/queue: scans, ingest, organize   │  │
│  │   SQLite (WAL) ──┐                        │  │
│  └──────────────────┼────────────────────────┘  │
│                     │                           │
└─────────────────────┼───────────────────────────┘
                      │
        ┌─────────────┴──────────────┐
        │ bind mounts: /data/db      │  SQLite DB + server state
        │              /data/ingest  │  drop folder
        │              /media/music  │  the music library
        └────────────────────────────┘
```

- **Server**: Go 1.23, `net/http` + chi v5, SQLite via `modernc.org/sqlite` (pure Go, WAL). Modular monolith under `v2/internal/modules/<domain>`.
- **Web client**: React 18 + Vite 6 + Tailwind CSS, react-query for server state, wouter router, Zustand for client state, code-split by route.
- **Storage**: SQLite for metadata and user data; filesystem for audio, cover art, and avatars.

## Compatible clients

Sonarly implements the OpenSubsonic REST API at `/rest/` and has been tested with:

| Client | Status | Notes |
|---|---|---|
| Feishin | Working | Desktop/web player. |
| Symphonium | Working | Android player; full library sync and playback confirmed. |
| Music Assistant | Working | Library sync verified during the v2 parity run. |
| DSub | Not tested yet | Should work; feedback welcome. |
| Ultrasonic | Not tested yet | Should work; feedback welcome. |

Open an issue if your client does not work.

## Known limitations

- **OpenSubsonic bookmarks**: `getBookmarks.view` currently returns an empty list. Full bookmark support is not implemented yet.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, commit conventions, and pull request process.

Sonarly has been developed with assistance from AI coding agents. Human review, testing, and contributions are essential.

## License

Sonarly is released under the [GNU Affero General Public License v3.0](LICENSE).
