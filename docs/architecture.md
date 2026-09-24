# Architecture

Sonarly is a self-hosted music server. A single Fastify process serves three things:

1. **OpenSubsonic API** (`/rest/`) — compatible with Subsonic/OpenSubsonic clients (Feishin, Symphonium, DSub, Ultrasonic, …).
2. **Management REST API** (`/api/`) — used by the React web UI for library management.
3. **Static web UI** (`/*`) — the built React app, served in production via `@fastify/static`.

The server runs a background worker thread for scanning and organizing audio files. Filesystem watchers detect changes in configured libraries and the ingest folder and queue scan/ingest jobs.

## Monorepo layout

The repository is a pnpm workspace with three packages:

```
packages/
├── server/     # Fastify backend (TypeScript, ESM)
│   ├── src/
│   │   ├── features/   # domain-first modules (see below)
│   │   ├── db/         # connection.ts, migrate.ts, migrations/
│   │   ├── app.ts      # Fastify app wiring (plugins, routes, static serving)
│   │   ├── config.ts   # validated environment config (Zod)
│   │   └── index.ts    # entry point
│   └── tests/          # Vitest tests, mirrors src/
├── shared/     # Shared TypeScript types and contracts (@sonarly/shared)
│   └── src/            # album.ts, song.ts, playlist.ts, smart-playlist.ts, …
└── web/        # React management UI (Vite, Tailwind, wouter, Zustand)
    └── src/
        ├── features/   # domain-first pages and components
        ├── components/ # shared UI primitives (Layout, ui/*)
        ├── lib/        # utilities and the API client (api.ts)
        ├── stores/     # Zustand stores (player, library, …)
        └── contexts/   # shared React contexts
```

`@sonarly/shared` holds every cross-package contract: entity types (`Album`, `Song`, `Playlist`, …), smart-playlist rule types, and shared constants such as `SMART_PLAYLIST_FIELDS`. Both server and web import from it, so API shapes stay in sync at compile time.

## Server

### Feature modules

Server code is organized feature-first: each domain lives under `packages/server/src/features/<name>/` and exposes a small public API through `index.ts`. Cross-feature imports go through the barrel, never internal files.

Current features:

- **Library pipeline**: `library` (scanner), `libraries` (admin-managed folders), `ingest` (drop-folder import + review), `tags` (metadata read/write), `cover-art`, `duplicates`, `conflicts`, `uploads`, `transcode`
- **Catalog**: `songs`, `albums`, `artists`, `genres`, `years`, `search`, `home`, `statistics`, `suggestions`
- **Playback/user data**: `playlists`, `smart-playlists` (rule compiler), `favorites`, `bookmarks`, `listening-stats`, `players`, `auto-dj`, `lrclib`, `musicbrainz`
- **Platform**: `auth`, `users`, `user-preferences`, `settings`, `events`, `opensubsonic`

### Request pipeline

- `app.ts` builds the Fastify instance: session/auth hook, feature route registration, error handling, and (in production) static serving of the built web UI.
- Management routes live in each feature's `routes.ts` (or `management-routes.ts`); data access lives in `repository.ts` files using parameterized `better-sqlite3` statements.
- Session cookies are signed with `SESSION_SECRET`; `requireAdmin` guards admin routes.

### Database

- SQLite via `better-sqlite3`, file located under `DATA_DIR`.
- Migrations are plain `.sql` files (plus occasional `.js`/`.cjs`) in `src/db/migrations/`, executed in filename order by `src/db/migrate.ts`; applied filenames are tracked in the `migrations` table. `scripts/copy-migrations.js` copies them into the build output.
- See [db-schema.md](db-schema.md) for the full schema.

### Background work

- A worker thread runs the scan/ingest pipeline; chokidar watchers on libraries and the ingest folder queue jobs.
- Scheduled jobs: periodic rescans (`SCAN_INTERVAL_MINUTES`), ingest processing (`INGEST_INTERVAL_MINUTES`), artist image sync (`ARTIST_IMAGE_INTERVAL_MINUTES`), review-folder cleanup (`REVIEW_RETENTION_DAYS`).

### Data flow

- Audio files are read with `music-metadata` (`features/tags/reader.ts`).
- Metadata is written with a Python Mutagen subprocess (`features/tags/mutagen-writer.ts`).
- Library organization renames files into a configurable pattern (default: `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`); the extension is always appended.
- Scanning ensures artists/albums/genres exist (`ensureArtist`, `ensureAlbum`, …), fills album-level metadata (release type, MusicBrainz ids, labels, …), and upserts songs. Album-level fields are only filled when empty, so user edits made in the UI survive rescans.
- SQLite stores songs, albums, artists, playlists, users, sessions, libraries, and scan state; audio files and cover art live on the filesystem.

## Web app

- React 18 + Vite 6 + Tailwind CSS 3, routed with wouter, state in Zustand stores (`stores/player.ts`, `stores/libraryStore.ts`, …).
- Feature-first pages under `src/features/<name>/pages/`; shared primitives under `src/components/ui/`.
- All API calls go through `src/lib/api.ts`, which prefixes `/api` and handles auth errors.
- Design tokens and visual principles: [design-language.md](design-language.md).

## Libraries

Libraries are admin-managed folders stored in the `libraries` table (`features/libraries/`). On first start, a default library is seeded from `LIBRARY_PATH` so existing single-folder deployments keep working. Admins manage libraries at `/admin/libraries`; the scanner, watcher, scheduler, and OpenSubsonic `getMusicFolders` all read from this table.

In Docker, library bind mounts are configured with env vars like `LIBRARY_MUSIC` (mounted at `/media/music`); additional libraries can be mounted at other `/media/<name>` paths and created in the admin panel.

## OpenSubsonic compatibility notes

The `/rest/` endpoints must always return a `subsonic-response` envelope, even on errors — many Subsonic clients abort sync on plain HTTP 4xx/5xx bodies. Use standard Subsonic error codes and keep HTTP 200 unless the client explicitly needs something else. Symphonium syncs via `search3.view` with an empty query and paginates; `albumCount` on artist objects and `songCount`/`duration` on album objects must reflect real database counts.
