# Sonarly

> Keep this file updated when changing project conventions, structure, or the reusable UI component inventory below.

## Agent Quick Reference

- **Technology:** TypeScript monorepo — Fastify backend, React + Vite frontend, SQLite database
- **Key directories:**
  - `packages/server/` — Fastify API server, database, scanner, ingest pipeline
  - `packages/web/` — React SPA management UI
  - `packages/shared/` — Shared TypeScript types and contracts
  - `docker/` — Dockerfile and entrypoint
  - `docs/` — Deployment and project documentation
- **Test command:** `pnpm test`
- **Lint command:** `pnpm lint` (currently a no-op; linting is not configured)
- **Database:** SQLite via `better-sqlite3`, migrations in `packages/server/src/db/migrations/`

## Technology Stack

- **Runtime:** Node.js 20
- **Package manager:** pnpm 9 (workspace monorepo)
- **Language:** TypeScript 5.5
- **Backend:** Fastify 4, `better-sqlite3`, `zod`, `music-metadata`, `chokidar`, `bcrypt`
- **Frontend:** React 18, Vite 5, Tailwind CSS 3, wouter, Zustand
- **Deployment:** Docker + Docker Compose, single container serves both API and built web UI
- **Testing:** Vitest 2

## Project Structure

```
.
├── docker/                 # Dockerfile.server, Dockerfile.dev, entrypoint.sh
├── docs/                   # deployment.md
├── packages/
│   ├── server/             # Fastify backend
│   │   ├── src/
│   │   │   ├── features/   # domain-first modules (auth, users, songs, albums, playlists, library, libraries, ingest, tags, settings, opensubsonic, ...)
│   │   │   ├── db/         # connection, migrations (cross-feature schema history)
│   │   │   ├── app.ts      # Fastify app wiring
│   │   │   ├── config.ts   # validated environment config
│   │   │   └── index.ts    # entry point
│   │   └── tests/          # unit and integration tests (mirrors src/)
│   ├── shared/             # shared TypeScript types and contracts
│   └── web/                # React management UI
│       └── src/
│           ├── features/   # domain-first pages and components
│           ├── components/ # shared UI primitives (Layout, ui/*)
│           ├── lib/        # utilities
│           └── contexts/   # shared React contexts
├── compose.yaml            # production deployment
├── compose.dev.yaml        # dev deployment with hot reload
├── .env.example            # required env vars
└── AGENTS.md               # this file
```

## Architecture

Sonarly is a self-hosted music server. A single Fastify process serves:

1. **OpenSubsonic API** (`/rest/`) — compatible with Subsonic clients.
2. **Management REST API** (`/api/`) — used by the React web UI for library management.
3. **Static web UI** (`/*`) — the built React app, served in production via `@fastify/static`.

The server runs a background worker thread for scanning and organizing audio files. File system watchers detect changes in configured libraries and the ingest folder and queue scan/ingest jobs.

### Libraries

Libraries are admin-managed folders stored in the `libraries` table (`packages/server/src/features/libraries/`). On first start, a default library is seeded from `LIBRARY_PATH` so existing single-folder deployments keep working. Admins can add, edit, and remove libraries from `/admin/libraries`; the scanner, watcher, scheduler, and OpenSubsonic `getMusicFolders` all read from this table.

In Docker, configure library bind mounts with env vars like `LIBRARY_MUSIC`. The dev/prod compose files mount `LIBRARY_MUSIC` at `/media/music` and set `LIBRARY_PATH=/media/music`, so the seeded default library points to the right place. Additional libraries can be mounted at other `/media/<name>` paths by editing the compose file and then creating them in the admin panel.

### OpenSubsonic compatibility

The `/rest/` endpoints must always return a `subsonic-response` envelope, even on errors. Many Subsonic clients (including Symphonium) abort sync when they receive a plain HTTP 4xx/5xx body instead of a formatted Subsonic error.

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

## Development Conventions

> Generic React patterns — see `react-ui-patterns`.
> Generic security practices — see `security-hardening`.
> Generic self-hosting/deployment patterns — see `selfhost-release`.

- Prefer **workspace-relative imports** between packages (`@sonarly/shared`).
- Code is organized **feature-first**: each domain lives under `src/features/<name>/` and exposes a small public API through `index.ts`.
- Server routes, repositories, and domain logic are co-located by feature under `packages/server/src/features/`.
- Web pages and domain components are co-located by feature under `packages/web/src/features/`.
- Shared UI primitives live in `packages/web/src/components/ui/`; the app shell is `components/Layout.tsx`.
- Cross-feature imports go through a feature's `index.ts` barrel, never its internal files.
- Configuration is validated with Zod in `src/config.ts`.
- Migrations are plain SQL files executed in order from `src/db/migrations/`.
- Tests live next to source in `tests/` (mirrors `src/` structure).

## Reusable UI Components

Shared components live in `packages/web/src/components/`. Use them for consistent layout, interactions, and styling across features. Grid views of library content should use the `Card` component so hover actions (favorite, rating, play) and link behavior are uniform.

| Component | Path | Purpose |
|-----------|------|---------|
| `Layout` | `components/Layout.tsx` | App shell with sidebar and main content area. |
| `Card` | `components/Card.tsx` | Content card with link, optional cover art, favorite, rating, and play actions. Use for grid views. |
| `CoverArt` | `components/CoverArt.tsx` | Cover art image with placeholder fallback. |
| `ArtistImage` | `components/ArtistImage.tsx` | Artist image from local disk with placeholder fallback. |
| `LibraryView` | `components/LibraryView.tsx` | Toggleable list/grid view for library entities (artists, albums, etc.). |
| `ListRow` | `components/ListRow.tsx` | Clickable table row with play, favorite, and rating actions. |
| `ItemContextMenu` | `components/ItemContextMenu.tsx` | Right-click/long-press context menu wrapper. |
| `FilterPanel` | `components/FilterPanel.tsx` | Filter controls for library pages. |
| `SearchBox` | `components/SearchBox.tsx` | Global search input. |
| `TopBar` | `components/TopBar.tsx` | Header with search and user menu. |
| `Sidebar` | `components/Sidebar.tsx` | Navigation sidebar. |
| `PlayerBar` | `components/PlayerBar.tsx` | Persistent playback controls. |
| `AudioController` | `components/AudioController.tsx` | Audio element and playback state bridge. |
| `ActionButtons` | `components/ActionButtons.tsx` | `FavoriteButton` and `StarRating` primitives. |
| `FavoriteRatingGroup` | `components/FavoriteRatingGroup.tsx` | Inline favorite + rating combo used in headers and cards. |
| `EntityHeader` | `components/EntityHeader.tsx` | Reusable header with cover, title, metadata chips, and actions. |
| `MetadataBreadcrumb` | `components/MetadataBreadcrumb.tsx` | Horizontal metadata chips with optional links. |
| `ExplicitTitle` | `components/ExplicitTitle.tsx` | Title text with explicit-content badge and blur toggle. |
| `PageState` | `components/PageState.tsx` | Loading, empty, and error states for pages. |
| `Avatar` | `components/Avatar.tsx` | User avatar with placeholder fallback. |
| `Button` | `components/ui/Button.tsx` | Button primitive. |
| `Input` | `components/ui/Input.tsx` | Text input primitive. |
| `Icon` | `components/ui/Icon.tsx` | Icon renderer. |
| `Table` | `components/ui/Table.tsx` | Generic table component. |
| `AutocompleteInput` | `components/ui/AutocompleteInput.tsx` | Autocomplete input primitive. |
| `ProgressBar` | `components/ui/ProgressBar.tsx` | Progress indicator. |
| `SongTable` | `features/songs/components/SongTable.tsx` | Opinionated song table; accepts `SongListItem` rows. |
| `TrackList` | `features/songs/components/TrackList.tsx` | Simple vertical list of tracks. |
| `AlbumList` | `features/albums/components/AlbumList.tsx` | Simple vertical list of albums. |

When adding, removing, or significantly changing a shared component, update this table.

## Design Language

The Sonarly web UI follows a Tidal-inspired premium music interface documented in `docs/design-language.md`. Key conventions:

- Near-black canvas in dark/OLED modes so album art is the hero.
- Mode-aware default accent: blue in light mode, cyan in dark/OLED mode.
- Typefaces: Space Grotesk (display), Inter (body), JetBrains Mono (data).
- Shared semantic tokens in `packages/web/src/index.css`: `--bg-primary`, `--surface`, `--fg-primary`, `--fg-secondary`, `--rule`, `--accent`.
- Signature element: adaptive chrome that tints the player bar from the currently playing album's cover art via `useDominantColor`.

Update `docs/design-language.md` when changing tokens, typefaces, modes, or the signature element.

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

Use the dev compose (`compose.dev.yaml`) for active development. Source folders are bind-mounted, so most code changes do not require a rebuild.

| Change | Action needed | Why |
|---|---|---|
| TypeScript/React source in `packages/*/src/` | Nothing (hot reload) | `tsx watch` and Vite HMR pick up changes automatically. |
| Environment variables in `.env` | `docker compose -f compose.dev.yaml up -d` | The container must be recreated to read new env vars. |
| `package.json`, `vite.config.ts`, `tsconfig.json`, or new dependencies | `docker compose -f compose.dev.yaml up -d --build` | The image must be rebuilt to install/update dependencies or copy new config. |
| `docker/Dockerfile.dev`, `docker/entrypoint.sh`, or runtime tooling | `docker compose -f compose.dev.yaml up -d --build` | The image layer changes. |
| Database reset | `docker compose -f compose.dev.yaml down` then delete `./config/sonarly/data/sonarly.db` | All non-fungible data lives under `./config/sonarly/`. |
| Add/remove a library | Use `/admin/libraries` in the web UI, then trigger a scan from `/admin/system-tasks` | The watcher is restarted automatically; a full scan picks up the new paths. |
| Trigger a scan from the host | `docker exec sonarly-dev sh -c "cd /app/packages/server && pnpm trigger-scan"` | Queues a full library scan without opening the web UI. |

Production (`compose.yaml`) always requires `--build` when code changes because it serves the built web UI from the image.

## User Settings & Preferences Storage

Use three separate storage layers so UI config, content interactions, and server config do not mix:

1. **Global / admin settings** — `settings` key-value table (`packages/server/src/features/settings/`).
   - Used for server-wide configuration: organize pattern, review retention days, etc.
   - Writable by admins only.
2. **Per-user UI preferences** — `user_preferences` table, one row per user (`user_id` primary key) with a JSON blob.
   - Stores sidebar order/visibility, theme mode, accent color, default view modes, column visibility, card sizes, etc.
   - Validated on write with Zod, but kept schemaless in SQLite so the UI can evolve without migrations.
3. **Per-user content interactions** — normalized relational tables.
   - `user_songs`, `user_albums`, `user_artists`, `user_playlists`.
   - Columns: `starred` (integer), `rating` (integer), `play_count` (integer), `last_played` (text).
   - These are queried for favorites, ratings, play history, and recommendations.

Front-end UI state (e.g., current modal, scroll position) belongs in Zustand or React state, not in persisted preferences.

## Security Considerations

- `SESSION_SECRET` must be at least 32 characters; the container refuses to start without it.
- Session cookies are `httpOnly`, `sameSite: 'strict'`, and `secure` is controlled by `SESSION_COOKIE_SECURE`.
- `SESSION_COOKIE_SECURE` defaults to `false` so the app works over plain HTTP in self-hosted setups. Set to `true` only behind HTTPS.
- Management API routes require a valid session except for login/logout/setup/me endpoints.
- The container drops privileges at runtime to the `PUID`/`PGID` owner of bind mounts.

## Skill References

- `react-ui-patterns` — React, Vite, Tailwind, and form patterns.
- `security-hardening` — session management, secret handling, and deployment security.
- `selfhost-release` — Docker Compose, env files, and self-hosted deployment.
- `codebase-organizer` — monorepo structure and package boundaries.
- `auto-file-organization` — reusable file-organization primitives for media, documents, ebooks, and photos.
