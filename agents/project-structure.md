## Project Structure

```
.
├── agents/                 # Agent guidance files (entry point: AGENTS.md)
├── config/                 # Runtime data (database, library, ingest); gitignored, live data
├── docker/                 # Dockerfile.v2 (all-in-one image), entrypoint.sh, compose.v2.yaml.example
├── docs/                   # Project documentation (index: docs/README.md)
├── v2/                     # Go server (the only server)
│   ├── cmd/sonarly/        # entrypoint: config → db → modules → http server
│   ├── internal/
│   │   ├── config/         # env config (SONARLY_*, SESSION_SECRET); validated at boot
│   │   ├── db/             # connection pragmas + embedded migration runner (ledger)
│   │   ├── httpserver/     # chi router, middleware, error contract
│   │   ├── staticfs/       # SPA static serving with index.html fallback
│   │   └── modules/        # one package per domain (see agents/architecture.md)
│   ├── api/                # openapi.yaml (native REST contract) + redocly config
│   ├── testparity/         # v1↔v2 parity harness (skips without a v1 checkout)
│   └── testdualrun/        # production dual-run harness (boots the v2 binary)
├── packages/
│   └── web/                # React management UI
│       └── src/
│           ├── features/   # domain-first pages and components
│           ├── components/ # shared UI primitives (PlayerBar, Sidebar, ui/*)
│           ├── contract/   # generated OpenAPI types + typed wrapper
│           ├── types/      # domain/entity types (migrated from @sonarly/shared)
│           ├── hooks/      # react-query hooks and interaction logic
│           ├── stores/     # Zustand client-state stores
│           └── lib/        # utilities and the legacy API client (api.ts)
├── compose.yaml            # production deployment (gitignored; copy from docker/compose.v2.yaml.example)
├── .env.example            # required env vars
└── AGENTS.md               # agent instructions entry point
```
