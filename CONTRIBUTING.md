# Contributing to Sonarly

Thanks for your interest in improving Sonarly. This guide covers how to set up a development environment, run tests, and submit changes.

Sonarly has been developed with assistance from AI coding agents. Human review, testing, and judgment are essential, and contributions from the community are welcome.

## Development setup

### Requirements

- Node.js 20
- pnpm 9
- Python 3 + Mutagen (`pip3 install mutagen`)
- Docker and Docker Compose v2 (optional but recommended)

### Local install

```bash
pnpm install
```

### Run in development mode

Using Docker (recommended):

```bash
cp .env.example .env
# edit .env and set SESSION_SECRET
docker compose -f compose.dev.yaml up -d --build
```

The web UI is at http://localhost:4534 and the backend directly at http://localhost:3001.

Without Docker:

```bash
pnpm dev
```

## Project structure

- `packages/server/` — Fastify backend, SQLite database, OpenSubsonic API, background workers.
- `packages/web/` — React + Vite management UI.
- `packages/shared/` — Shared TypeScript types and utilities.
- `docker/` — Dockerfiles and entrypoint.
- `docs/` — Public documentation.

## Testing

Run the full test suite:

```bash
pnpm test
```

Run backend tests only:

```bash
cd packages/server && pnpm test
```

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

Examples:

- `feat(player): add shuffle queue button`
- `fix(api): handle missing cover art gracefully`
- `docs(readme): update install instructions`

## Pull request process

1. Fork the repository and create a feature branch.
2. Make focused changes with clear commit messages.
3. Add or update tests for behavioral changes.
4. Update relevant documentation (`README.md`, `docs/`, etc.).
5. Ensure `pnpm test` passes.
6. Open a pull request with a concise description and the motivation for the change.

## Code style

- Use TypeScript strict mode.
- Prefer explicit types over `any`.
- Keep components small and focused; co-locate related hooks and helpers.
- Use the project's CSS design tokens and Tailwind utilities rather than ad-hoc values.

## Reporting issues

Open a GitHub issue with:

- A clear description of the problem.
- Steps to reproduce.
- Expected vs. actual behavior.
- Sonarly version or commit hash.
- Relevant logs or screenshots.

## Security

See [SECURITY.md](SECURITY.md) for reporting security issues.
