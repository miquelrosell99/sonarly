# Sonarly API Reference

Sonarly exposes two HTTP APIs from a single Go process:

1. **Native management REST API** at `/api/*` — used by the React web UI.
2. **OpenSubsonic API** at `/rest/*` — compatible with Subsonic/OpenSubsonic clients.

The server also serves the built React SPA at `/*` in production.

## Native REST API (`/api`)

**Source of truth: [`server/api/openapi.yaml`](../server/api/openapi.yaml)** (OpenAPI 3.1, ~80 paths). Every native endpoint, its request/response schemas, and its error shapes are documented there. The Go router is coverage-tested against the spec in both directions (a chi.Walk test fails the build if a route is missing from the spec or vice versa), so the spec cannot drift from the implementation silently.

Preview or validate the spec with [Redocly](https://redocly.com/):

```bash
npx @redocly/cli lint server/api/openapi.yaml        # lint (config: server/api/redocly.yaml)
npx @redocly/cli build-docs server/api/openapi.yaml  # render standalone reference docs
npx @redocly/cli preview-docs server/api/openapi.yaml  # local preview server
```

### Surface overview

| Area | Endpoints (selection) |
|---|---|
| Health | `GET /health`, `GET /healthz`, `GET /ready` |
| Auth & profile | `POST /api/login`, `POST /api/logout`, `POST /api/setup`, `GET/PATCH /api/me`, `GET/PATCH /api/me/preferences`, `POST /api/me/avatar`, `GET /api/avatars/{id}` |
| Catalog | `/api/songs`, `/api/albums`, `/api/artists`, `/api/genres` (+ tree), `/api/years`, `/api/search` (full-text), `/api/cover-art/{id}`, `/api/home`, `/api/suggestions` |
| Playback | `GET /api/stream/{id}`, `POST /api/songs/{id}/scrobble`, `/api/playback/auto-dj`, `/api/players`, bookmarks |
| Playlists | `/api/playlists` (static + smart), share members, share links, share-token guest access |
| User data | `/api/favorites`, `/api/ratings` (0–5, half steps), listening statistics |
| Library ops | `POST /api/scans`, `GET /api/scans/status`, `/api/ingest` (+ trigger), `/api/conflicts`, `/api/upload/sessions`, `/api/libraries` |
| Admin | users CRUD, user↔library assignment, libraries CRUD, genres, media settings, system tasks (+ history, run), status, missing-files management, ingest runs |
| Metadata | song/album tag editing, cover-art upload, MusicBrainz/LRCLIB proxies, artist images, artist refetch |
| Realtime | `GET /api/events` (SSE job-event feed, session cookie only) |

### Authentication (`/api/*`)

- Login via `POST /api/login` sets a signed session cookie (`HttpOnly`, `SameSite=Strict`, 7-day lifetime).
- All `/api/*` routes require the session cookie, except: `POST /api/login`, `POST /api/logout`, `GET/POST /api/setup`, `GET /api/me`, and `GET /api/playlists/{id}` with a valid `shareToken`.
- User API keys are an alternative credential on ordinary routes (`X-API-Key` header). `/api/events` accepts the session cookie only (EventSource cannot set headers).
- Admin routes additionally require `is_admin`; content routes are scoped by library assignment (`user_libraries`).

### Error contract

Native API errors are JSON `{"error": "..."}` with an appropriate status code. The OpenSubsonic adapter is different by design — see below.

## OpenSubsonic API (`/rest`)

Subsonic clients talk to `/rest/*`. Key properties:

- **Auth precedence**: `apiKey` query parameter → `X-API-Key` header → `u`/`t`/`s` token+salt → session cookie. Plaintext `p=` password auth is deliberately not implemented; token auth is what mainstream clients use when you enter a username and password. Invalid API keys short-circuit with code 40; an invalid token falls through to the cookie.
- **Envelope**: responses (including errors) are wrapped in a `subsonic-response` envelope. **Errors are returned with HTTP 200** (`status: "failed"` + `error{code,message}`) — many Subsonic clients abort sync on HTTP 4xx/5xx bodies. Standard error codes: 10 missing auth/param, 40 bad credentials, 70 data not found / out of scope.
- **Format negotiation** via the `f` parameter (`json` default, `xml` supported).
- **Coverage**: browsing/retrieval (`ping`, `getMusicFolders`, `getIndexes`, `getMusicDirectory`, `getAlbumList`/`2`, `getAlbum`, `getArtist`, `getSong`, `search2`/`search3`, `getGenres`, `getCoverArt`, `stream`, `download`, `getLyrics`, `getAlbumInfo`/`2`, …), starring/rating (`star`, `unstar`, `setRating`, `scrobble`), activity (`getNowPlaying`), and playlists (`getPlaylists`, `getPlaylist`, `createPlaylist`, `updatePlaylist`, `deletePlaylist`). Podcast/internet-radio endpoints return valid empty collections; `getBookmarks` returns an empty list.

The full behavioral contract — auth edge cases, format negotiation, XML mapping, and 62 per-endpoint quirks pinned from production observation — is recorded in [`.audits/opensubsonic-quirks.md`](../.audits/opensubsonic-quirks.md) (an internal engineering record, kept for the curious and for future implementers; user docs never depend on it).

## Contract code generation (web client)

The web client generates its TypeScript types from the spec:

```bash
pnpm --filter @sonarly/web contract:gen   # server/api/openapi.yaml → web/src/contract/schema.ts
```

`web/src/contract/wrapper.ts` layers typed access over the generated schema. Regenerate after changing the spec.
