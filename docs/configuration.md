# Configuration

Sonarly is configured entirely through environment variables, validated at boot — the server refuses to start with an invalid configuration and says why. The values below are the ones the server itself understands (from `server/internal/config/config.go`); the compose-level variables follow.

All `SONARLY_*` durations that accept `0` disable that trigger entirely.

## Server variables

| Variable | Default | What it does | When to change |
|---|---|---|---|
| `SESSION_SECRET` | *(required)* | Secret used to seal stored Subsonic passwords (AES-256-GCM) and to sign session cookies. Must be at least 32 characters; the server refuses to start without it. | Set once at install (`openssl rand -hex 32`). **Do not rotate casually**: it logs everyone out and breaks stored Subsonic client passwords — clients must re-authenticate. |
| `SONARLY_LIBRARY_PATH` | *(required)* | Root folder of the music library. On first boot a default library is seeded from this path. | Set to your music folder. Point it at the bind mount (`/media/music` in the container). |
| `SONARLY_ADDR` | `:8080` | Listen address and port. The image sets `:3000`. | Only if you run the binary directly and want a different port. |
| `SONARLY_DB_PATH` | `./data/sonarly.db` | SQLite database file. The image sets `/data/db/sonarly.db`. | Only with a custom layout; keep the DB on the same volume as `SONARLY_DATA_DIR`. |
| `SONARLY_DATA_DIR` | `./data` | Server-owned state: avatars, artist images, upload staging. The image sets `/data/db`. | With a custom volume layout. |
| `SONARLY_INGEST_PATH` | *(empty)* | Drop folder for ingest. Empty disables the ingest drop folder (uploads are unaffected). The image sets `/data/ingest`. | If you want the drop-folder import workflow, set it (see [usage.md](usage.md#adding-music)). |
| `SONARLY_WEB_DIST` | `./web-dist` | Folder with the built web client. If the folder does not exist the server runs API-only. The image sets `/app/web-dist`. | Only to serve a custom web build. |
| `SESSION_COOKIE_SECURE` | `false` | Marks the session cookie `Secure` (HTTPS-only). | Set `true` only when serving Sonarly behind HTTPS. Default `false` keeps plain-HTTP self-hosted setups working. |
| `SONARLY_WATCH_POLL_INTERVAL` | `5` | Seconds between filesystem polls for library change detection. `0` disables the watcher (periodic scans still run). | Raise it on slow disks or network shares; see [troubleshooting.md](troubleshooting.md#library-stays-empty-after-adding-files). |
| `SONARLY_SCAN_INTERVAL_MINUTES` | `60` | Minutes between automatic full-library scans. `0` disables periodic scans. | Raise for huge libraries on slow storage; rely on the watcher instead. |
| `SONARLY_INGEST_INTERVAL_MINUTES` | `60` | Minutes between ingest folder sweeps. `0` disables them. | Lower to import drop-folder files sooner. |
| `SONARLY_ARTIST_IMAGE_INTERVAL_MINUTES` | `1440` | Minutes between artist image/metadata syncs. `0` disables the sync. | Raise if the sync is noisy; it can also be run on demand from System tasks. |
| `SONARLY_REVIEW_CLEANUP_INTERVAL_MINUTES` | `1440` | Minutes between review-folder retention sweeps. `0` disables cleanup. | Rarely changed. |
| `SONARLY_REVIEW_RETENTION_DAYS` | `30` | Default retention (days) for files parked in the ingest review folder. Overridable from Settings (media) per deployment, clamped 1–365. | Shorten if review piles up; lengthen if you need more time to fix files. |
| `SONARLY_TRANSCODE_CONCURRENCY` | `2` | Maximum concurrent ffmpeg transcodes server-wide. | Raise on a fast host with many transcode-hungry clients; see [faq.md](faq.md#how-does-transcoding-work). |
| `SONARLY_FFMPEG_PATH` | `ffmpeg` | ffmpeg binary used for transcoding; resolved via `PATH` unless overridden. | If ffmpeg lives outside `PATH` in a custom runtime. |

## Compose-level variables

Set in `.env` next to `compose.yaml` (see `.env.example` and `docker/compose.yaml.example`):

| Variable | Default | What it does | When to change |
|---|---|---|---|
| `SONARLY_PORT` | `4533` | Host port mapped to container port `3000`. | If 4533 is taken. |
| `LIBRARY_MUSIC` | *(see `.env.example`)* | Host path of the music library, mounted at `/media/music`. | Always — point at your collection. |
| `SONARLY_INGEST_PATH` | `./config/sonarly/ingest` | Host path of the ingest/review folder, mounted at `/data/ingest`. | If you want the drop folder somewhere else. |
| `PUID` / `PGID` | `1000` / `1000` | UID/GID the container process runs as (the entrypoint creates a matching user and drops privileges). | Match the owner of your bind mounts (see [deployment.md](deployment.md#permissions-puidpgid)). |
| `SONARLY_VERSION` | `0.0.0-dev` | Build argument injected into the binary; reported as the OpenSubsonic `serverVersion`. | CI sets it from the git tag; set it when building release images from source. |

## Development-only variable

| Variable | Default | What it does |
|---|---|---|
| `SONARLY_DEV_ALLOWED_HOSTS` | *(unset — localhost only)* | Comma-separated hostnames the Vite dev server is allowed to respond to (`.env.example`). Use `true` to allow all hosts (not recommended outside trusted networks). Only relevant to `pnpm dev`, never the container. |
