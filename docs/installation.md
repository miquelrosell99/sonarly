# Installing Sonarly

Sonarly ships as a single all-in-one Docker image: the Go server, the built web UI, SQLite, ffmpeg (transcoding), and the tag writer. One container is the whole deployment.

## Requirements

- Docker Engine 20.10+ with the Compose plugin
- A host folder for your music library (existing collection or an empty folder to start)
- ~200 MB free for the image plus a data folder for the database

## Quick start

The fastest path is the compose example:

```bash
# 1. Get the files
git clone https://github.com/miquelrosell99/sonarly.git
cd sonarly

# 2. Configure
cp .env.example .env
# Edit .env: set SESSION_SECRET (openssl rand -hex 32) and LIBRARY_MUSIC
cp docker/compose.yaml.example compose.yaml

# 3. Run
docker compose up -d
```

Then open `http://localhost:4533` (change the host port with `SONARLY_PORT`).

> The compose file references the published image `ghcr.io/miquelrosell99/sonarly:latest`. To build from source instead, run:
>
> ```bash
> docker build -f docker/Dockerfile \
>   --build-arg SONARLY_VERSION=$(git describe --tags --always) \
>   -t ghcr.io/miquelrosell99/sonarly:local .
> ```
>
> and update the image name in `compose.yaml`. The build context must be the repo root.

### docker run (no compose)

If you prefer a plain container:

```bash
docker run -d --name sonarly \
  -p 4533:3000 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e SONARLY_LIBRARY_PATH=/media/music \
  -v ./config/sonarly/data:/data/db \
  -v /path/to/music:/media/music \
  -v ./config/sonarly/ingest:/data/ingest \
  --restart unless-stopped \
  ghcr.io/miquelrosell99/sonarly:latest
```

## First-boot setup wizard

On first visit the app redirects to `/setup`:

1. Choose the admin username and password. This is the first user account; more users are added later from the admin panel.
2. Log in. The server seeds the default library from `SONARLY_LIBRARY_PATH` and enqueues the first scan automatically.
3. Music appearing in the UI means the library path is mounted correctly; if the library is empty, check the mount (see [troubleshooting.md](troubleshooting.md)).

The setup wizard only appears while the server has zero users. After that, `/setup` is closed.

## Where data lives

| Path in container | What lives there |
|---|---|
| `/data/db` (`SONARLY_DATA_DIR`) | The SQLite database (`sonarly.db`) plus server-owned state: avatars, artist images, upload staging |
| `/media/music` (`SONARLY_LIBRARY_PATH`) | Your music library — bind-mounted from the host, never copied |
| `/data/ingest` (`SONARLY_INGEST_PATH`) | Drop folder for ingest (per-library subfolders inside) |

Back up the `/data/db` folder (database + state) and, as always, your music folder itself. Everything Sonarly knows how to rebuild — the catalog, search index, artwork cache — is rebuilt by a scan, so a backup only needs the database file and anything you uploaded (avatars).

Permissions: the container runs as a non-root user whose UID/GID follow the `PUID`/`PGID` variables (default `1000:1000`). The entrypoint creates `/data/db` and `/data/ingest` and makes them writable; the library mount only needs read access unless you use tag editing or organize (then it needs write access for the same UID/GID). See [deployment.md](deployment.md#permissions-puidpgid) for details.

## What to read next

- [configuration.md](configuration.md) — every environment variable
- [usage.md](usage.md) — adding music, browsing, playlists, clients
- [deployment.md](deployment.md) — upgrades, backup and rollback, health checks
