# 🌊 Sonarly

> A self-hosted music server that speaks OpenSubsonic and looks like a premium music app.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Vitest](https://img.shields.io/badge/Vitest-2-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Tests](https://img.shields.io/badge/tests-375%20passing-6E9F18?logo=vitest&logoColor=white)]()
[![OpenSubsonic](https://img.shields.io/badge/OpenSubsonic-1.16.1-FF6B6B?logo=audioboom&logoColor=white)]()
[![Self-hosted](https://img.shields.io/badge/Self--hosted-✓-2EA043?logo=linux&logoColor=white)]()

---

<!-- Screenshots go here when available -->
<!-- ![Sonarly web UI](docs/screenshots/dashboard.png) -->

Sonarly organizes your music library, serves it through the **OpenSubsonic API** (so your favorite Subsonic clients just work), and provides a beautiful web management UI inspired by TIDAL's dark, art-first aesthetic.

## ✨ Features

- 🎵 **OpenSubsonic compatible** — works with Feishin, Symphonium, DSub, Ultrasonic and any other Subsonic/OpenSubsonic client.
- 🖥️ **Modern web UI** — React + Vite + Tailwind, with adaptive player chrome that tints from the current album art.
- 📁 **Auto-organization** — drop files into the ingest folder and let Sonarly rename them into a clean library pattern.
- 🎨 **Cover & artist art** — reads embedded artwork, caches album covers, fetches artist images.
- 🔒 **Self-hosted & containerized** — single Docker image with everything included.
- 🧪 **Well tested** — 375+ backend tests run on every change.
- 🏷️ **Tag editing** — write metadata back to files with Python Mutagen.
- 📱 **Multiple users & permissions** — admin and regular user roles.
- 🗂️ **Multi-library support** — manage several media folders from the admin panel.

## 🚀 Quick start (Docker)

```bash
# 1. Clone the repo
git clone https://github.com/miquelrosell99/sonarly.git
cd sonarly

# 2. Configure environment
cp .env.example .env
# Edit .env and set SESSION_SECRET to a random string of at least 32 chars.

# 3. Start Sonarly
docker compose -f compose.yaml up -d --build
```

The web UI is available at `http://localhost:4533` (change with `SONARLY_PORT`).

On first visit you'll be redirected to `/setup` to create the admin account.

## 🛠️ Development

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
# edit .env and set SESSION_SECRET
docker compose -f compose.dev.yaml up -d --build
```

- Web UI: http://localhost:4534
- Backend directly: http://localhost:3001

Run tests:

```bash
pnpm test
```

Trigger a library scan from the host without opening the UI:

```bash
docker exec sonarly-dev sh -c "cd /app/packages/server && pnpm trigger-scan"
```

## 📂 Project structure

```
.
├── docker/                 # Dockerfiles and entrypoint
├── docs/                   # Deployment and design docs
├── packages/
│   ├── server/             # Fastify backend, SQLite, OpenSubsonic API
│   ├── shared/             # Shared TypeScript types
│   └── web/                # React management UI
├── compose.yaml            # Production deployment
├── compose.dev.yaml        # Dev deployment with hot reload
└── .env.example            # Required environment variables
```

## 🎧 Compatible clients

Sonarly implements the OpenSubsonic REST API at `/rest/` and has been tested with:

| Client | Status | Notes |
|---|---|---|
| Feishin | ✅ Working | Desktop/web player. |
| Symphonium | 🔄 Partial | Connects and syncs; reported cases of 0-track sync are being investigated (see TODO). |
| DSub | 🔄 Not tested yet | Should work; feedback welcome. |
| Ultrasonic | 🔄 Not tested yet | Should work; feedback welcome. |

Open an issue if your client doesn't work.

## 🏗️ Architecture at a glance

```
┌─────────────────────────────────────────────┐
│  Sonarly container                            │
│  ┌─────────────┐  ┌─────────────────────┐   │
│  │ React + Vite │  │ Fastify backend     │   │
│  │  (dev: 5173) │  │  (port 3000)        │   │
│  └──────┬───────┘  └──────────┬──────────┘   │
│         │                      │              │
│         └──────────┬───────────┘              │
│                    │                          │
│              OpenSubsonic /api                │
│              /rest/ /api/ /*                  │
└─────────────────────────────────────────────┘
```

- **Frontend**: React 18 + Vite + Tailwind CSS + wouter + Zustand.
- **Backend**: Fastify 4 + better-sqlite3 + Zod.
- **Scanner**: background worker thread with chokidar watchers.
- **Storage**: SQLite for metadata, filesystem for audio/cover art.

## 📋 TODO / Known limitations

- **OpenSubsonic bookmarks**: `getBookmarks.view` currently returns an empty list. Full bookmark support (save/load playback positions across clients) is not implemented yet.
- **Symphonium sync**: some users report 0 tracks after sync. Investigation is ongoing; progress is tracked in this repo.
- **Smart playlists / recommendations**: not implemented yet.

## 📄 License

License TBD — see repository for updates.

---

<p align="center">
  <sub>Built with 🎧 and a lot of dark mode.</sub>
</p>
