# Sonarly API Reference

Sonarly exposes two HTTP APIs from a single Go process:

1. **Native management REST API** at `/api/*` — used by the React web UI. The
   machine-readable contract is [`server/api/openapi.yaml`](../server/api/openapi.yaml)
   (OpenAPI 3.1, ~80 paths).
2. **OpenSubsonic API** at `/rest/*` — compatible with Subsonic clients.

The server also serves the built React SPA at `/*` in production.

## Native REST API (`/api`)

**Source of truth: [`server/api/openapi.yaml`](../server/api/openapi.yaml).** Every
native endpoint, its request/response schemas, and its error shapes are
documented there. The Go router is coverage-tested against the spec in both
directions (a chi.Walk test fails the build if a route is missing from the
spec or vice versa), so the spec cannot drift from the implementation.

Validate or browse the spec with [Redocly](https://redocly.com/):

```bash
cd server/api
npx @redocly/cli lint openapi.yaml     # lint (config: redocly.yaml)
npx @redocly/cli build-docs openapi.yaml   # render reference docs
```

### Surface overview

| Area | Endpoints (selection) |
|---|---|
| Health | `GET /health`, `GET /healthz`, `GET /ready` |
| Auth & profile | `POST /api/login`, `POST /api/logout`, `POST /api/setup`, `GET/PATCH /api/me`, `GET/PATCH /api/me/preferences`, `POST /api/me/avatar`, `GET /api/avatars/{id}` |
| Catalog | `/api/songs`, `/api/albums`, `/api/artists`, `/api/genres` (+ tree), `/api/years`, `/api/search` (FTS5), `/api/cover-art/{id}`, `/api/home`, `/api/suggestions` |
| Playback | `GET /api/stream/{id}`, `POST /api/songs/{id}/scrobble`, `POST /api/playback/auto-dj`, `/api/players`, bookmarks |
| Playlists | `/api/playlists` (static + smart), share members, share links, share-token guest access |
| User data | `/api/favorites`, `/api/ratings`, listening statistics |
| Library ops | `POST /api/scans`, `GET /api/scans/status`, `/api/ingest` (+ trigger), `/api/conflicts`, `/api/upload/sessions`, `/api/libraries` |
| Admin | users CRUD, user↔library assignment, libraries CRUD, genres, media settings, system-tasks (+ history, run), status, missing-files management |
| Metadata | song/album tag editing, cover-art upload, MusicBrainz/LRCLIB proxies, artist images, artist refetch |
| Realtime | `GET /api/events` (SSE job-event feed, session cookie only) |

### Authentication (`/api/*`)

- Login via `POST /api/login` sets a signed session cookie.
- All `/api/*` routes require the session cookie, except: `POST /api/login`,
  `POST /api/logout`, `GET/POST /api/setup`, `GET /api/me`, and
  `GET /api/playlists/{id}` with a valid `shareToken`.
- User API keys are an alternative credential on ordinary routes: `X-API-Key`
  header (or the scheme documented per-endpoint in the spec). `/api/events`
  accepts the session cookie only.
- Admin routes additionally require `is_admin`; most content routes are
  scoped by library assignment (`user_libraries`).

### Error contract

Native API errors are JSON `{"error": "..."}` with an appropriate status
code. The OpenSubsonic adapter is different by design — see below.

## OpenSubsonic API (`/rest`)

Subsonic clients talk to `/rest/*`. The compatibility contract — envelope
shape, auth precedence, error codes, XML mapping, per-endpoint quirks — is
documented in [`opensubsonic-quirks.md`](opensubsonic-quirks.md). That
document is the authoritative reference; implement against its decisions.

Key properties:

- Auth precedence: `apiKey` query parameter → `X-API-Key` header →
  `u`/`t`/`s` token+salt → session cookie. Invalid API keys short-circuit
  with code 40; an invalid token falls through to the cookie.
- Response format is selected by the `f` query parameter (`json` default,
  `xml` supported). Successful and failed responses are wrapped in a
  `subsonic-response` envelope; **errors are enveloped with HTTP 200** —
  many Subsonic clients abort sync on HTTP 4xx/5xx bodies.
- Implemented endpoints cover browsing/retrieval (`ping`, `getMusicFolders`,
  `getIndexes`, `getMusicDirectory`, `getAlbumList`/`2`, `getAlbum`,
  `getArtist`, `getSong`, `search2`/`search3`, `getGenres`, `getCoverArt`,
  `stream`, `download`, `getLyrics`, `getAlbumInfo`/`2`, …), starring/rating
  (`star`, `unstar`, `setRating`, `scrobble`), activity (`getNowPlaying`),
  and playlists (`getPlaylists`, `getPlaylist`, `createPlaylist`,
  `updatePlaylist`, `deletePlaylist`). Podcast/radio endpoints return valid
  empty collections; `getBookmarks` returns an empty list.

## Contract code generation (web client)

The web client generates its TypeScript types from the spec:

```bash
pnpm --filter @sonarly/web contract:gen   # server/api/openapi.yaml → src/contract/schema.ts
```

`src/contract/wrapper.ts` + `capabilities.ts` layer typed access and feature
detection over the generated schema. Regenerate after changing the spec.
