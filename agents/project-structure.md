## Project Structure

```
.
├── agents/                 # Agent guidance files (entry point: AGENTS.md)
├── config/                 # Runtime data (database, library, ingest); gitignored
├── docker/                 # Dockerfile.server, Dockerfile.dev, entrypoint.sh, compose examples
├── docs/                   # Project documentation (index: docs/README.md)
├── packages/
│   ├── server/             # Fastify backend
│   │   ├── src/
│   │   │   ├── features/   # domain-first modules (auth, users, songs, albums, artists, genres, playlists, smart-playlists, library, libraries, ingest, tags, cover-art, settings, opensubsonic, ...)
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
│           ├── lib/        # utilities and the API client (api.ts)
│           ├── stores/     # Zustand stores (player, library, …)
│           └── contexts/   # shared React contexts
├── compose.yaml            # production deployment
├── docker/
│   ├── compose.yaml.example    # production deployment example
│   └── compose.dev.yaml.example # dev deployment with hot reload example
├── .env.example            # required env vars
└── AGENTS.md               # agent instructions entry point
```
