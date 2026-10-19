## Project Structure

```
.
├── agents/                 # Agent guidance files (entry point: AGENTS.md)
├── config/                 # Runtime data (database, library, ingest); gitignored, live data
├── docker/                 # Dockerfile (all-in-one image), entrypoint.sh, compose.yaml.example
├── docs/                   # Project documentation (index: docs/README.md)
├── server/                 # Go server (the only server)
│   ├── cmd/sonarly/        # entrypoint: config → db → modules → http server
│   ├── internal/
│   │   ├── config/         # env config (SONARLY_*, SESSION_SECRET); validated at boot
│   │   ├── db/             # connection pragmas + embedded migration runner (ledger)
│   │   ├── httpserver/     # chi router, middleware, error contract
│   │   ├── staticfs/       # SPA static serving with index.html fallback
│   │   └── modules/        # one package per domain (see agents/architecture.md)
│   ├── api/                # openapi.yaml (native REST contract) + redocly config
│   └── spikes/             # archived investigation artifacts
├── packages/               # (historic; the web app moved to web/ — see below)
├── web/                    # React management UI
│   └── src/
│       ├── main.tsx, App.tsx  # entry + route composition (all routes lazy via lazyRoute())
│       ├── features/     # domain-first modules; each carries an index.ts barrel
│       │                  #   with the public surface. Cross-feature imports go
│       │                  #   through the barrel. (full
│       │                  #   alignment): business components live here, clustered:
│       │                  #   entities (card/row/cover/context-menu kit),
│       │                  #   library-view (list/grid + column configurator),
│       │                  #   player (PlayerBar, AudioController, transport bits),
│       │                  #   shell (Layout, Sidebar, TopBar, SearchBox, PageState,
│       │                  #   Skeletons, ErrorBoundary, SponsorButton),
│       │                  #   edit-entity (EditEntityModal + per-type editors +
│       │                  #   fetch/upload modals), plus the 19 domain features
│       │                  #   (albums, artists, admin, playlists, search, …) and
│       │                  #   page monoliths split into co-located modules
│       │                  #   (statistics-view, home-cards, admin-users,
│       │                  #   admin-genres, search-results, smart-playlist-block-editor,
│       │                  #   share-playlist-modal, synced-lyrics-editor)
│       ├── components/   # components/ui/ ONLY — the normalized shadcn catalog
│       │                  #   (catalog + fleet chrome; no business components)
│       ├── contract/     # generated OpenAPI types (schema.ts, types-only)
│       ├── types/        # domain/entity types (migrated from @sonarly/shared)
│       ├── hooks/        # react-query hooks and interaction logic
│       ├── stores/       # Zustand client-state stores (player/ = domain slices
│       │                  #   composed into one persisted store)
│       ├── contexts/     # React context providers (notifications)
│       └── lib/          # utilities and the canonical API client (api.ts)
├── compose.yaml            # production deployment (gitignored; copy from docker/compose.yaml.example)
├── .env.example            # required env vars
└── AGENTS.md               # agent instructions entry point
```

Tree rule (full alignment): `web/src/components/` holds the
catalog (`components/ui/`) and nothing else. New business components go under their
feature folder (or a new `features/<name>/` with a barrel); a component used by many
features joins the `entities`/`shell` kit only when it is genuinely feature-spanning.
