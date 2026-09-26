# Deploying Sonarly

Sonarly runs as a single Docker container: the Go server, the built web UI, SQLite, ffmpeg, and the tag writer all ship in one image. This document covers production operation — installing, updating, backing up, rolling back, permissions, and health checks. For the first-install walkthrough see [installation.md](installation.md); for the full variable reference see [configuration.md](configuration.md).

## Requirements

- Docker Engine 20.10+ with the Compose plugin
- A host folder for the music library and one for server data
- Host port `4533` free (or set `SONARLY_PORT`)

## Install

```bash
git clone https://github.com/miquelrosell99/sonarly.git   # or copy the two files below
cd sonarly
cp .env.example .env          # set SESSION_SECRET and LIBRARY_MUSIC
cp docker/compose.yaml.example compose.yaml
docker compose up -d
```

The compose file runs the published image `ghcr.io/miquelrosell99/sonarly:latest` and applies database migrations automatically on boot — upgrades need no export/import step. First visit to `http://localhost:4533` runs the setup wizard.

### Volumes

| Host path | Container path | Purpose |
|-----------|----------------|---------|
| `./config/sonarly/data` | `/data/db` | SQLite database and server-owned state (avatars, artist images, upload staging) |
| `${SONARLY_INGEST_PATH:-./config/sonarly/ingest}` | `/data/ingest` | Drop folder for ingest (per-library subfolders inside) |
| `${LIBRARY_MUSIC:-./config/sonarly/library}` | `/media/music` | The music library. Read-only is sufficient for scanning/streaming; tag editing and organize need write access. |

Create the data directories first and make sure they are writable by the container user (see Permissions):

```bash
mkdir -p ./config/sonarly/data ./config/sonarly/ingest
```

### Building from source

The image is a multi-stage build (web client → Go binary → alpine runtime). The build context must be the repo root:

```bash
docker build -f docker/Dockerfile \
  --build-arg SONARLY_VERSION=$(git describe --tags --always) \
  -t sonarly:local .
```

then point `compose.yaml` at `sonarly:local`.

## Permissions (PUID/PGID)

The container never runs as root: the entrypoint creates a `sonarly` user adjusted to the `PUID`/`PGID` environment variables (default `1000:1000`) and drops privileges with `su-exec`. The data directories are created and chowned on every start; the library mount keeps its existing ownership, so it only needs to be readable by that UID (and writable if you use tag editing or organize).

Match the variables to the owner of your bind mounts:

```bash
# host folders owned by uid/gid 1002
PUID=1002 PGID=1002 docker compose up -d
```

Symptoms of a mismatch: "permission denied" writing the database or uploading files. Fix by aligning `PUID`/`PGID` with `chown -R <uid>:<gid> ./config/sonarly` on the host.

## Health check

The image declares a container `HEALTHCHECK` against `GET /healthz`; liveness probes are also available at `/health` and `/ready`. From the host:

```bash
curl -f http://localhost:4533/healthz
```

Compose/orchestrator status (`docker ps` showing `healthy`) follows the same check. If the check fails on first boot, give migrations a minute before investigating — the check has a 15 s start period and retries.

## Upgrade

Migrations are forward-only, embedded in the binary, and idempotent — pulling a newer image and recreating the container is the whole procedure. **Back up first** (next section), then:

```bash
docker compose pull          # pre-built image
docker compose up -d         # recreates with the new image, migrates in place
```

If you build from source, rebuild the image and `up -d` (note: tagging your local build with an existing registry tag shadows the registry image until the next `pull`).

## Backup and rollback

**Backup** — copy the data folder while the database is consistent:

```bash
docker compose stop
cp -a ./config/sonarly/data ./backups/data-$(date +%F)
docker compose start
```

or take a live consistent snapshot with the SQLite online backup (checkpoints the WAL): `sqlite3 ./config/sonarly/data/sonarly.db ".backup './backups/sonarly-$(date +%F).db'"`. Your music folder is mounted as-is — back it up with your normal file backup. The catalog itself is rebuildable from the files by a scan.

**Rollback** — migrations are forward-only, so rolling back means restoring the pre-upgrade backup:

1. `docker compose down`.
2. Restore the database backup into `./config/sonarly/data` (the SQLite file must match the older binary's schema).
3. Pull or build the previous image tag and `docker compose up -d`.

## Operational notes

- **One instance per database file.** SQLite with a single writer; run exactly one container against a given `sonarly.db`.
- **Local disk for the database.** Put `/data/db` on local storage; SQLite on network shares is the most common performance and locking problem.
- **Library on network shares is fine.** The watcher uses filesystem polling (`SONARLY_WATCH_POLL_INTERVAL`, default every 5 s), which works on NFS/SMB where inotify does not; raise the interval on slow shares.
- **Do not rotate `SESSION_SECRET` casually.** It seals stored Subsonic passwords and signs sessions; changing it logs everyone out and breaks Subsonic client passwords until they re-authenticate.
- The 2026-09-26 production cutover runbook (including the pre-cutover backup location) is preserved in git history under `.audits/` at the 2.0.0 tag.

## Troubleshooting

See [troubleshooting.md](troubleshooting.md) for the problem → cause → fix catalog (container won't start, empty library, Subsonic clients, SQLite locks, artwork, review folder, duplicates, performance).
