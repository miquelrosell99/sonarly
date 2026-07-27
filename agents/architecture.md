## Architecture

Sonarly is a self-hosted music server. A single Fastify process serves:

1. **OpenSubsonic API** (`/rest/`) — compatible with Subsonic clients.
2. **Management REST API** (`/api/`) — used by the React web UI for library management.
3. **Static web UI** (`/*`) — the built React app, served in production via `@fastify/static`.

The server runs a background worker thread for scanning and organizing audio files. File system watchers detect changes in configured libraries and the ingest folder and queue scan/ingest jobs.

### Libraries

Libraries are admin-managed folders stored in the `libraries` table (`packages/server/src/features/libraries/`). On first start, a default library is seeded from `LIBRARY_PATH` so existing single-folder deployments keep working. Admins can add, edit, and remove libraries from `/admin/libraries`; the scanner, watcher, scheduler, and OpenSubsonic `getMusicFolders` all read from this table.

> **Local development uses `compose.dev.yaml`.** The dev container bind-mounts source code and runs `pnpm -r --parallel dev`, so TypeScript/React changes are hot-reloaded. Do not use the production `compose.yaml` for active development.

In Docker, configure library bind mounts with env vars like `LIBRARY_MUSIC`. The dev/prod compose files mount `LIBRARY_MUSIC` at `/media/music` and set `LIBRARY_PATH=/media/music`, so the seeded default library points to the right place. Additional libraries can be mounted at other `/media/<name>` paths by editing the compose file and then creating them in the admin panel.

- `LIBRARY_MUSIC` (`.env.example` default: `/path/to/music`) → mounted at `/media/music`.
- The legacy single `LIBRARY_PATH` env var is still used inside the container, but day-to-day configuration happens through the admin panel's library definitions, not by editing `LIBRARY_PATH` directly.

### OpenSubsonic compatibility

The `/rest/` endpoints must always return a `subsonic-response` envelope, even on errors. Many Subsonic clients (including Symphonium) abort sync when they receive a plain HTTP 4xx/5xx body instead of a formatted Subsonic error.

Symphonium syncs by calling `search3.view` with an empty query and paginating through artists, albums, and songs. `albumCount` on artist objects and `songCount`/`duration` on album objects must reflect the real database counts; returning `0` for entities that do contain tracks causes the client to skip them or report an empty library.

Use the standard Subsonic error codes and keep the HTTP status 200 unless the client explicitly needs something else:

| Code | Meaning | Use when |
|---|---|---|
| 10 | Required parameter is missing. | A required query/body parameter is absent. |
| 20 | Incompatible protocol version. | Client or server protocol negotiation fails. |
| 30 | Incorrect username or password. | Credentials are invalid (login still returns HTTP 200). |
| 40 | User is not authorized. | Authentication is missing or expired. |
| 50 | User is not authorized for the requested operation. | The authenticated user lacks permission. |
| 60 | Trial period expired. | Not currently used. |
| 70 | Data not found. | The requested entity (artist, album, song, cover art, etc.) does not exist. |

For example, `/rest/getCoverArt.view` returns a Subsonic `status: failed` response with `error.code: 70` when the requested cover art ID does not exist, rather than a plain HTTP 404.

### Data flow

- Audio files are read with `music-metadata`.
- Metadata is written with a Python Mutagen subprocess (via `features/tags/mutagen-writer.ts`).
- Library organization renames files into a configurable pattern (default: `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`). The file extension is always appended.
- SQLite stores songs, albums, artists, playlists, users, sessions, libraries, and scan state.
