# Contributing to Sonarly

Thanks for your interest in improving Sonarly. This guide covers how to set up a development environment, run tests, and submit changes.

Sonarly has been developed with assistance from AI coding agents. Human review, testing, and judgment are essential, and contributions from the community are welcome.

## Development setup

### Requirements

- Go 1.23
- Node.js 22 + pnpm 9
- Python 3 + Mutagen (`pip3 install mutagen`) — used by the tag writer
- `ffmpeg` — used by transcoding
- Docker and Docker Compose (optional, for image work)

### Local install

```bash
pnpm install   # web client dependencies
```

The Go server has no install step beyond the toolchain (`go build ./...` in `server/` downloads modules).

### Run in development mode

```bash
# Terminal 1 — Go server (from the repo root)
cd server
SESSION_SECRET=$(openssl rand -hex 32) SONARLY_LIBRARY_PATH=/path/to/music go run ./cmd/sonarly

# Terminal 2 — web client
pnpm dev
```

The web UI is at http://localhost:5173 (the Vite dev server proxies `/api` and `/rest` to the Go server on port 3000). See [docs/development.md](docs/development.md) for the full workflow, including Docker builds.

## Project structure

- `server/` — Go server (the only server): modules, SQLite migrations, OpenSubsonic adapter, native REST API.
- `packages/web/` — React + Vite management UI.
- `docker/` — all-in-one image (Dockerfile), entrypoint, compose example.
- `docs/` — Public documentation.

## Testing

Run the full test suite (web client + Go server):

```bash
pnpm test            # web client (Vitest)
cd server && go test ./... -count=1   # Go server
```

The server test suite covers the OpenSubsonic adapter against the documented wire contract.

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
5. Ensure `pnpm test` and `go test ./...` pass.
6. Open a pull request with a concise description and the motivation for the change.

## Code style

- Go: standard `gofmt`/`go vet`; follow the module layout in `server/internal/modules/`.
- TypeScript strict mode; prefer explicit types over `any`.
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
