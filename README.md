# Sonarly

A self-hosted music server that speaks the OpenSubsonic API and provides a premium, dark-themed web player for your personal music library.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Vitest](https://img.shields.io/badge/Vitest-3-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Tests](https://img.shields.io/badge/tests-703%20passing-6E9F18?logo=vitest&logoColor=white)]()
[![OpenSubsonic](https://img.shields.io/badge/OpenSubsonic-1.16.1-FF6B6B?logo=audioboom&logoColor=white)]()
[![Self-hosted](https://img.shields.io/badge/Self--hosted-✓-2EA043?logo=linux&logoColor=white)]()

> **Alpha software.** Sonarly is in early development and is not stable. Do not use it for music libraries you cannot afford to lose or re-import. Data loss, database resets, or incorrect file organization can happen due to bugs or incomplete features. Always keep separate backups of your audio files and database before importing, organizing, or updating.

<!-- Screenshot placeholder: add a representative UI screenshot here when available. -->

## What is Sonarly?

Sonarly organizes your music library, serves it through the **OpenSubsonic API** (so your favorite Subsonic clients just work), and provides a web management UI inspired by TIDAL's dark, art-first aesthetic.

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

### Building locally

If you prefer to build the image yourself, pass `--build`:

```bash
docker compose -f compose.yaml up -d --build
```

The web UI is available at `http://localhost:4533` (change with `SONARLY_PORT`). On first visit you will be redirected to `/setup` to create the admin account.

## Features

- **OpenSubsonic compatible** — works with Feishin, Symphonium, DSub, Ultrasonic, and any other Subsonic/OpenSubsonic client.
- **Modern web UI** — React + Vite + Tailwind CSS, with adaptive player chrome tinted from the current album art.
- **Auto-organization** — drop files into the ingest folder and let Sonarly rename them into a clean library pattern.
- **Cover and artist art** — reads embedded artwork, caches album covers, and fetches artist images.
- **Smart playlists** — create dynamic playlists from rules that update automatically.
- **Auto DJ** — let Sonarly keep the music going based on your library.
- **Self-hosted and containerized** — single Docker image with everything included.
- **Well tested** — 429+ backend and 274+ frontend tests run on every change.
- **Tag editing** — write metadata back to files with Python Mutagen.
- **Users and permissions** — admin and regular user roles.
- **Multi-library support** — manage several media folders from the admin panel.

## Development

Requirements:

- Node.js 20
- pnpm 9
- Python 3 + Mutagen (`pip3 install mutagen`)

```bash
pnpm install
pnpm dev
```

For Docker-based development with hot reload:

```bash
cp .env.example .env
cp docker/compose.dev.yaml.example compose.dev.yaml
# edit .env and set SESSION_SECRET
docker compose -f compose.dev.yaml up -d --build
```

- Web UI: http://localhost:4534
- Backend directly: http://localhost:3001

Run the test suite:

```bash
pnpm test
```

Trigger a library scan from the host without opening the UI:

```bash
docker exec sonarly-dev sh -c "cd /app/packages/server && pnpm trigger-scan"
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/deployment.md](docs/deployment.md) | Docker production/development deployment, environment variables, volumes, troubleshooting |
| [docs/api.md](docs/api.md) | Management REST API and OpenSubsonic API reference |
| [docs/db-schema.md](docs/db-schema.md) | SQLite database schema and conventions |
| [docs/design-language.md](docs/design-language.md) | UI design tokens, typography, and visual principles |
| [CHANGELOG.md](CHANGELOG.md) | Release notes and notable changes |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, testing, commit conventions, pull request process |
| [SECURITY.md](SECURITY.md) | Supported versions, vulnerability reporting, security practices |

## Project structure

```
.
├── docker/                 # Dockerfiles and entrypoint
├── docs/                   # Public documentation
├── packages/
│   ├── server/             # Fastify backend, SQLite, OpenSubsonic API
│   ├── shared/             # Shared TypeScript types
│   └── web/                # React management UI
├── compose.yaml            # Production deployment
├── docker/
│   ├── compose.yaml.example # Production deployment example
│   └── compose.dev.yaml.example # Dev deployment with hot reload example
└── .env.example            # Required environment variables
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                Sonarly container                │
│                                                 │
│  ┌──────────────┐   ┌─────────────────────┐     │
│  │ React + Vite │   │   Fastify backend   │     │
│  │ (dev: 5173)  │   │    (port 3000)      │     │
│  └──────┬───────┘   └──────────┬──────────┘     │
│         │                      │                │
│         └───────────┬──────────┘                │
│                     │                           │
│            OpenSubsonic /api                    │
│            /rest/ /api/ /*                      │
└─────────────────────────────────────────────────┘
```

- **Frontend**: React 18 + Vite 6 + Tailwind CSS + wouter + Zustand.
- **Backend**: Fastify 5 + better-sqlite3 + Zod.
- **Scanner**: background worker thread with chokidar watchers.
- **Storage**: SQLite for metadata, filesystem for audio/cover art.

## Compatible clients

Sonarly implements the OpenSubsonic REST API at `/rest/` and has been tested with:

| Client | Status | Notes |
|---|---|---|
| Feishin | Working | Desktop/web player. |
| Symphonium | Working | Android player; full library sync and playback confirmed. |
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
