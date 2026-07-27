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
docker compose -f compose.yaml up -d --build

# Dev Docker deployment with hot reload
docker compose -f compose.dev.yaml up -d --build
```

Local dev runs the server with `tsx watch` and the web UI with Vite. The production Docker image builds the web UI, copies it into the server image, and serves it from `/`. The dev compose runs `pnpm -r --parallel dev` inside the container and bind-mounts the package directories so TypeScript/React changes are reflected immediately.

### Dev ports

`compose.dev.yaml` exposes:

- `SONARLY_DEV_WEB_PORT` (default `4534`) → Vite dev server (`http://localhost:4534`)
- `SONARLY_DEV_API_PORT` (default `3001`) → backend API directly (`http://localhost:3001`)

The Vite dev server proxies `/api` and `/rest` to the backend, so the web UI only needs port `4534` for normal use.

## Dev workflow: restart vs rebuild vs hot reload

Use the dev compose (`compose.dev.yaml`) for active development. Source folders are bind-mounted, so most code changes do not require a rebuild. The three operations below are **not** interchangeable:

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

Production (`compose.yaml`) always requires `--build` when code changes because it serves the built web UI from the image.
