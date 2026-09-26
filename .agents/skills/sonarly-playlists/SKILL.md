---
name: sonarly-playlists
description: Create and modify Sonarly playlists — static playlists, smart playlist rules, the SQL compiler, sharing, and share tokens
type: prompt
whenToUse: When working on playlist CRUD, smart playlist rules or compilation, playlist sharing/share links, or playlist OpenSubsonic endpoints
---

# Sonarly Playlists

## Map of the subsystem

- `server/internal/modules/playlists/` — `repository.go` (CRUD + `playlist_songs` with `position`), `policy.go` (**ONE** `Resolve` for every surface), `service.go` (orchestration), `routes.go` (native `/api/playlists`), `subsonic.go` (`/rest` playlist endpoints delegating to the same service), `rules.go` (rule validation).
- `server/internal/modules/playlists/compiler.go` — compiles the rule AST to parameterized SQL. Whitelisting: unknown fields are a **400** (the old silent `s.title` fallback was fixed); LIKE-escaping (`ESCAPE '\'`) and the join/WHERE bind-order handling are load-bearing.
- Rule model: types in `packages/web/src/types/smart-playlist.ts` (`SMART_PLAYLIST_FIELDS`, `isSmartPlaylistRuleGroup`). Single-level groups: `all` AND'd with `any`; no nesting by design.
- Deep dive doc: `docs/smart-playlists.md`.

## Sharing model (read before changing)

- ONE access policy (`policy.Resolve`): levels `none < view < edit < owner`. Owner = delete/share/manage-link; edit = owner or `can_edit` share; view = visibility (public/shared) or membership.
- Visibility: `private` / `shared` (per-user `playlist_shares`) / `public` (all users) / `link`.
- `share_token` is crypto/rand, minted iff visibility=`link`, and grants anonymous access to the linked playlist's *content* via SQL EXISTS scoping (song streams, cover art, smart-rule resolution).
- The smart-playlist grant cache is **bounded** and keyed by playlist id + `rules_json` (rule edits invalidate immediately).
- `GET /api/playlists/:id` exposes `shareToken` to the owner only (it used to leak to any viewer — fixed).

## Smart playlist facts

- Compilation + execution runs **per HTTP request**; the playlist list view compiles once per smart row. Keep rules cheap.
- `limitPercent` triggers an extra `COUNT(DISTINCT …)` query per compile.
- The `genre` rule matches via the `song_genres` junction (secondary genres included — the old primary-genre-only gap is fixed); `inPlaylist` verifies the referenced playlist is accessible to the requesting user (the old UUID-guessability hole is fixed).
- Auto-dj uses its own scoring, not the compiler.

## Invariants to preserve

- Playlist writes are transactional (member rewrites, type conversion, share changes) — don't open non-transactional write paths.
- Authorization is the single `policy.Resolve`; the native routes and the Subsonic endpoints both go through it. Any policy change applies everywhere at once — that is the point.
- Smart rules are data, never SQL strings — preserve the compiler's parameterization, LIKE-escaping, and join/WHERE bind order.
- `resolve_mode` = `tracks` resolves user-scoped rules against the **owner's** data (shared curated list, default); `query` re-resolves per viewer.
- Tests: `compiler_test.go`, `policy_test.go`, `repository_test.go`, `routes_test.go`, `subsonic_test.go`, `rules_test.go`, `cache_test.go` in the module — run `go test ./... -count=1` from `server/`.
