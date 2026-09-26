## Architecture

Sonarly is a self-hosted music server. A single Go process (`v2/cmd/sonarly`) serves:

1. **OpenSubsonic API** (`/rest/`) — compatible with Subsonic clients; an adapter over the same services the native API uses (one policy, one data path).
2. **Management REST API** (`/api/`) — used by the React web UI for library management. Contract: `v2/api/openapi.yaml`.
3. **Static web UI** (`/*`) — the built React app, served by `internal/staticfs` with an index.html fallback.

Background work runs on a DB-backed job queue (`scan_jobs` with typed JSON payloads): a single-goroutine worker executes scans/ingest/organize/artist-image jobs; a pure-Go polling watcher detects library changes and queues coalesced resyncs; interval schedulers trigger periodic work. All of it is context-driven for clean shutdown.

### Module map (`v2/internal/modules/`)

| Module | Responsibility |
|---|---|
| `system` | health probes (`/health`, `/healthz`, `/ready`) |
| `auth` | sessions (SQLite store), login throttle, API keys, Subsonic secret box |
| `users` | user CRUD, admin gates, profiles, preferences, avatars |
| `libraries` | admin-managed library folders, user↔library assignment |
| `catalog` | songs/albums/artists/genres/years read APIs, scoped by `user_libraries` |
| `library` | scanner, job queue, worker, polling watcher, schedulers |
| `ingest` | drop-folder import, validation, organize, duplicates, review quarantine |
| `uploads` | chunked upload sessions, streaming reassembly, stale-session GC |
| `tags` | metadata read (pure Go) / write (python3+mutagen) |
| `playlists` | static + smart playlists, ONE access policy, shares/share tokens, SQL compiler |
| `search` | FTS5 prefix search, synced inside write transactions |
| `statistics` / `home` / `autodj` | listening stats, home aggregation, auto-dj scoring |
| `playback` | streaming (direct + ffmpeg transcode), scrobble, bookmarks |
| `players` / `events` | now-playing tracking, SSE job-event feed |
| `interactions` | favorites/ratings (same junction rows the adapter writes) |
| `opensubsonic` | the full `/rest` adapter |
| `admin` | system-tasks, status, missing files, ingest runs |
| `suggestions` / `providers` / `artistimages` | autocomplete, MusicBrainz/LRCLIB proxies, artist image sync |

### Libraries

Libraries are admin-managed folders stored in the `libraries` table (`internal/modules/libraries`). On first start, a default library is seeded from `SONARLY_LIBRARY_PATH` so single-folder deployments keep working. Admins manage libraries at `/admin/libraries`; the scanner, watcher, schedulers, and OpenSubsonic `getMusicFolders` all read from this table.

User↔library assignment is a security boundary: `user_libraries` is enforced on every content query and stream/download path (admins bypass; share-token grants stay scoped to playlist content).

In Docker, configure library bind mounts with env vars like `LIBRARY_MUSIC` (mounted at `/media/music`). Additional libraries can be mounted at other `/media/<name>` paths by editing the compose file and then creating them in the admin panel.

### OpenSubsonic compatibility

The `/rest/` endpoints must always return a `subsonic-response` envelope, even on errors. Many Subsonic clients (including Symphonium) abort sync when they receive a plain HTTP 4xx/5xx body instead of a formatted Subsonic error — errors are therefore enveloped with HTTP 200.

Symphonium syncs by calling `search3.view` with an empty query and paginating through artists, albums, and songs. `albumCount` on artist objects and `songCount`/`duration` on album objects must reflect the real database counts; returning `0` for entities that do contain tracks causes the client to skip them or report an empty library.

Error codes with v1 semantics:

| Code | Meaning | Use when |
|---|---|---|
| 10 | Missing authentication / parameter. | Required credentials or params absent. |
| 40 | Bad credentials. | Authentication invalid (still HTTP 200). |
| 70 | Data not found. | The requested entity does not exist or is out of scope. |

For example, `/rest/getCoverArt.view` returns a Subsonic `status: failed` response with `error.code: 70` when the requested cover art ID does not exist, rather than a plain HTTP 404.

The full behavioral contract is `docs/v2-opensubsonic-quirks.md` (62 v1-observed quirks) — implement against its decisions, not the spec text alone.

### Data flow

- Audio metadata is read in pure Go (`internal/audio`: vendored `dhowden/tag` fork + own properties reader) — no CGO.
- Metadata is written with a Python Mutagen subprocess (`tags` module).
- Library organization renames files into a configurable pattern (default: `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`). The extension is always appended.
- SQLite (WAL, single writer connection) stores songs, albums, artists, playlists, users, sessions, libraries, and job state; audio files, cover art, and avatars live on the filesystem.
