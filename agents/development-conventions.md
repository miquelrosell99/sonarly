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
