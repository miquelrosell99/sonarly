## Build and Development Commands

```bash
# Install dependencies
pnpm install

# Run server and web UI in parallel for local development
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Production Docker deployment
cp .env.example .env
# edit .env, then:
docker compose -f compose.yaml up -d

# Production image build (deploy current checkout without a release tag)
docker build -f docker/Dockerfile.server -t ghcr.io/miquelrosell99/sonarly:latest .
docker compose -f compose.yaml up -d

# Dev Docker deployment with hot reload
cp docker/compose.dev.yaml.example compose.dev.yaml
docker compose -f compose.dev.yaml up -d --build
```

Local dev runs the server with `tsx watch` and the web UI with Vite. The production Docker image builds the web UI, copies it into the server image, and serves it from `/`. The dev compose runs `pnpm -r --parallel dev` inside the container and bind-mounts the package directories so TypeScript/React changes are reflected immediately.

## Determining the current deployment type

Before choosing a command after code changes, check what is currently running:

```bash
# List running Sonarly containers
docker compose -f compose.yaml ps
docker compose -f compose.dev.yaml ps   # only if you copied the dev example

# Or check all running containers
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Use the result to pick the right action:

| Running container(s) | Deployment type | Code change action |
|---|---|---|
| `compose.yaml` service(s) up | Production Docker | Rebuild the image locally, then `docker compose -f compose.yaml up -d` (see "Production redeploys and releases" below) |
| `compose.dev.yaml` service(s) up (copied from `docker/compose.dev.yaml.example`) | Dev Docker | Usually nothing (hot reload); use `--build` only for dependency/config/Docker changes |
| Neither | Local dev | `pnpm dev` (or ask the user how they run it) |

For production Docker, ensure `.env` exists and contains `SESSION_SECRET`. Compose reads it automatically; no inline env vars are needed. Always confirm before rebuilding or recreating a production container, since it restarts the live service.

### Dev ports

`docker/compose.dev.yaml.example` (copy to `compose.dev.yaml` to use) exposes:

- `SONARLY_DEV_WEB_PORT` (default `4534`) → Vite dev server (`http://localhost:4534`)
- `SONARLY_DEV_API_PORT` (default `3001`) → backend API directly (`http://localhost:3001`)

The Vite dev server proxies `/api` and `/rest` to the backend, so the web UI only needs port `4534` for normal use.

## Dev workflow: restart vs rebuild vs hot reload

Use the dev compose (`compose.dev.yaml`, copied from `docker/compose.dev.yaml.example`) for active development. Source folders are bind-mounted, so most code changes do not require a rebuild. The three operations below are **not** interchangeable:

- **`restart`** — keeps the same container and image. Use it when only the running process needs a fresh start (e.g. after a crash, or to reload something read at startup). It does **not** pick up new environment variables or rebuilt image layers.
- **`up -d`** — recreates the container if the compose service definition or `.env` changed. Use it for new env vars, port mappings, volume mounts, or compose edits. It still uses the existing image, so it does **not** install new dependencies.
- **`up -d --build`** — rebuilds the image and then recreates the container. Use it when anything that becomes part of the image changes: dependencies, package scripts, Dockerfiles, entrypoint, or root-level config files (`package.json`, `vite.config.ts`, `tsconfig.json`, etc.).

| Change | Action needed | Why |
|---|---|---|
| TypeScript/React source in `packages/*/src/` | Nothing (hot reload) | `tsx watch` and Vite HMR pick up changes automatically. |
| Environment variables in `.env` | `docker compose -f compose.dev.yaml up -d` | The container must be recreated to read new env vars. |
| `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, or new dependencies | `docker compose -f compose.dev.yaml up -d --build` | The image must be rebuilt to install/update dependencies or copy new config. |
| `docker/Dockerfile.dev`, `docker/entrypoint.sh`, or runtime tooling | `docker compose -f compose.dev.yaml up -d --build` | The image layer changes. |
| New/changed package script (e.g. `trigger-scan`) | `docker compose -f compose.dev.yaml up -d --build` | Scripts are read from `package.json` at image build time. |
| Database reset | `docker compose -f compose.dev.yaml down` then delete `./config/sonarly/data/sonarly.db` | All non-fungible data lives under `./config/sonarly/`. |
| Add/remove a library | Use `/admin/libraries` in the web UI, then trigger a scan from `/admin/system-tasks` | The watcher is restarted automatically; a full scan picks up the new paths. |
| Trigger a scan from the host | `docker exec sonarly-dev sh -c "cd /app/packages/server && pnpm trigger-scan"` | Queues a full library scan without opening the web UI. |

> **Tip:** after adding a dependency with `pnpm add` (or editing `pnpm-lock.yaml`), rebuild with `--build`. Running `pnpm install` manually inside a running container installs packages into the bind-mounted volume for that session, but the change is lost on the next container recreate unless the image itself contains it.

## Production redeploys and releases

The live `compose.yaml` runs the pre-built image `ghcr.io/miquelrosell99/sonarly:latest` and has **no `build:` section**, so `docker compose ... --build` is a no-op there. Two supported ways to deploy new code:

**Deploy the current checkout (no release):** build the image locally (the local tag shadows the registry one) and recreate the container:

```bash
docker build -f docker/Dockerfile.server -t ghcr.io/miquelrosell99/sonarly:latest .
docker compose -f compose.yaml up -d
```

**Cut a release (preferred for the fleet):** releases are published by the `Release Docker image` workflow (`.github/workflows/release-docker.yml`), which triggers on `v*` tags:

1. Update `CHANGELOG.md`: rename `## [Unreleased]` to `## [X.Y.Z] - <date>`, point the `[Unreleased]` compare link at the new tag, and add the release link.
2. Commit (`chore(release): vX.Y.Z`) and push `main`.
3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
4. Watch the workflow (`gh run list --workflow=release-docker.yml`); it publishes `:latest` plus semver tags to GHCR.
5. On the server: `docker compose -f compose.yaml pull && docker compose -f compose.yaml up -d`.

Because local and registry images share the `:latest` tag, run `docker compose pull` after each release so the server tracks the published image.
