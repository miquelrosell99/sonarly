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
│           ├── lib/        # utilities and the API client (api.ts)
│           └── contexts/   # shared React contexts
├── compose.yaml            # production deployment
├── docker/                 # Dockerfiles, entrypoint, and compose examples
│   ├── compose.yaml.example    # production deployment example
│   └── compose.dev.yaml.example # dev deployment with hot reload example
├── .env.example            # required env vars
└── AGENTS.md               # this file
```
