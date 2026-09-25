// Package playlists hosts the playlists domain: static and smart playlists,
// per-user shares, link sharing via share tokens, and the single access
// policy every surface (native routes now, the OpenSubsonic adapter in P9)
// must consult.
//
// Deliberate fixes over the v1 implementation this ports:
//
//   - ONE access policy (policy.go). v1 kept two divergent canViewPlaylist
//     copies (native routes vs OpenSubsonic routes) that disagreed on whether
//     a share token required visibility=link. v2 has exactly one Resolve.
//   - The share token is the owner's secret: DTOs include it for the owner
//     only (v1 B10 leaked it to any detail-viewer).
//   - Playlist create/update rewrites members transactionally, in one tx
//     (v1 B3 ran the DELETE and the INSERTs outside any transaction).
//   - The smart-playlist grant cache is a size-capped, TTL-bounded map
//     (v1's smartGrantCache was an unbounded process-lifetime Map).
//   - The inPlaylist rule verifies the referenced playlist belongs to the
//     user the rules resolve against (v1 accepted any playlist id).
//   - The genre rule matches the song_genres junction, so secondary genres
//     match too (v1 matched only the primary genre via songs.genre_id).
//   - Rule fields/operators are validated against a whitelist; anything
//     unknown is a 400 (v1 silently compiled bogus fields against s.title).
//   - All rule values are bound parameters; LIKE metacharacters are escaped
//     with ESCAPE '\'; LIMIT is always a bound parameter, never interpolated.
//
// Song-list scoping (documented, v1 semantics): a playlist's stored/resolved
// song list is filtered to the viewing user's library scope, except the
// owner (who sees the playlist as curated) and anonymous share-token viewers
// (the token authorizes the linked playlist's own content; library scope
// only applies to signed-in users — v1 /api/stream parity).
package playlists
