// Package playlists hosts the playlists domain: static and smart playlists,
// per-user shares, link sharing via share tokens, and the single access
// policy every surface (native routes now, the OpenSubsonic adapter in P9)
// must consult.
//
// Share-token/visibility contract (P10 decision, strict wire parity):
// the token lifecycle is INDEPENDENT of visibility. POST share-link
// mints/rotates the token without touching visibility; DELETE share-link
// clears the token only; a native visibility change never clears the token
// and auto-mints one when visibility becomes 'link' with none set (old
// management-routes.ts). The Subsonic adapter's updatePlaylist instead
// re-derives the token from the resolved visibility on every update (link
// keeps/mints, anything else clears — the retired server opensubsonic-routes.ts).
// Deliberately preserved the retired server divergence (the old F7 finding): the NATIVE
// anonymous metadata view (GET /api/playlists/{id}?shareToken=) grants VIEW
// on a matching token regardless of visibility (old management
// canViewPlaylist), while Resolve's token branch — the Subsonic getPlaylist
// bypass and every data-mutating path — requires visibility='link' AND a
// matching token, and the streaming/cover-art grants couple link+token in
// SQL (TokenGrantsSong/TokenGrantsCoverArt). Unifying the native view with
// the stricter Resolve rule is a post-cutover cleanup candidate.
//
// Deliberate fixes over the retired server implementation this ports:
//
//   - ONE access policy (policy.go). the retired server kept two divergent canViewPlaylist
//     copies (native routes vs OpenSubsonic routes); the Go server keeps one Resolve
//     for the adapter/data paths and applies the old looser token rule only
//     to the native metadata view (see the contract note above).
//   - The share token is the owner's secret: DTOs include it for the owner
//     only (the old B10 leaked it to any detail-viewer).
//   - Playlist create/update rewrites members transactionally, in one tx
//     (the old B3 ran the DELETE and the INSERTs outside any transaction).
//   - The smart-playlist grant cache is a size-capped, TTL-bounded map
//     (the old smartGrantCache was an unbounded process-lifetime Map).
//   - The inPlaylist rule verifies the referenced playlist belongs to the
//     user the rules resolve against (old accepted any playlist id).
//   - The genre rule matches the song_genres junction, so secondary genres
//     match too (old matched only the primary genre via songs.genre_id).
//   - Rule fields/operators are validated against a whitelist; anything
//     unknown is a 400 (old silently compiled bogus fields against s.title).
//   - All rule values are bound parameters; LIKE metacharacters are escaped
//     with ESCAPE '\'; LIMIT is always a bound parameter, never interpolated.
//
// Song-list scoping (documented, the old semantics): a playlist's stored/resolved
// song list is filtered to the viewing user's library scope, except the
// owner (who sees the playlist as curated) and anonymous share-token viewers
// (the token authorizes the linked playlist's own content; library scope
// only applies to signed-in users — the retired server /api/stream parity).
package playlists
