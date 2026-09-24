---
name: sonarly-playlists
description: Create and modify Sonarly playlists — static playlists, smart playlist rules, the SQL compiler, sharing, and share tokens
type: prompt
whenToUse: When working on playlist CRUD, smart playlist rules or compilation, playlist sharing/share links, or playlist OpenSubsonic endpoints
---

# Sonarly Playlists

## Map of the subsystem

- `packages/server/src/features/playlists/` — `repository.ts` (CRUD + `playlist_songs` with `position` + share/ACL queries), `management-routes.ts` (10 native endpoints), `opensubsonic-routes.ts` (5 Subsonic endpoints).
- `packages/server/src/features/smart-playlists/compiler.ts` — compiles the rule AST to parameterized SQL. Fields from a fixed switch (unknown field silently falls back to `s.title` — validate rules at the API boundary if you touch this).
- Rule model: shared types in `packages/shared/src/smart-playlist.ts` (`isSmartPlaylistRuleGroup` shape guard, `SMART_PLAYLIST_FIELDS`). Single-level groups: `all` AND'd with `any`; no nesting by design.
- Deep dive doc: `docs/smart-playlists.md`.

## Sharing model (read before changing)

- Visibility: private / public / link. `share_token` (random UUID) grants anonymous access to the linked playlist's *content* via SQL EXISTS scoping (`shareTokenGrantsSong`/`CoverArt` in `repository.ts`).
- ACL: `playlist_shares(playlist_id, user_id, can_edit)`.
- **Known divergence**: `canViewPlaylist` in `management-routes.ts` accepts tokens regardless of visibility; `opensubsonic-routes.ts` requires `visibility='link'`. Token lifecycle also differs (Subsonic update clears token when visibility≠'link'; management PUT keeps it). Unify when touching either.
- `GET /api/playlists/:id` currently leaks `shareToken` to any viewer — the list endpoint strips it.
- 30s grant cache for smart-playlist share resolution is keyed `${id}:${rules_json}` in an unbounded Map — bounded caches only, please.

## Smart playlist facts

- Compilation + execution runs **per HTTP request**; the playlist list view compiles once per smart row. Keep rules cheap.
- `limitPercent` triggers an extra `COUNT(DISTINCT …)` query per compile.
- The `genre` rule joins on `s.genre_id` (primary genre only) — multi-genre songs miss secondary genres; auto-dj does it correctly via `song_genres` EXISTS.
- `inPlaylist` doesn't verify the referenced playlist belongs to the requesting user (UUID-guessability only).

## Invariants to preserve

- `createPlaylist`/`updatePlaylist` rewrite `playlist_songs` non-transactionally — wrap in `db.transaction` when touching them.
- Playlist authorization is enforced consistently on **both** surfaces; any change must update `management-routes.ts` and `opensubsonic-routes.ts` together (or better: extract the shared policy).
- Smart rules are data, never SQL strings — the compiler's parameterization and LIKE-escaping (`ESCAPE '\'`) are load-bearing; preserve them and the join/WHERE bind-order handling (`compiler.ts:296-305`).
- Tests: `tests/features/playlists/` (management 20 tests, opensubsonic 21), `tests/features/smart-playlists/` (compiler 17, routes 4), `packages/server/scripts/test-smart-compiler.ts` (debug script, hardcoded paths).
