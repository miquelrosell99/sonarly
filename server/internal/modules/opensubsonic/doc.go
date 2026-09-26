// Package opensubsonic is the Subsonic/OpenSubsonic compatibility adapter
// served under /rest/*. P6.5 built the foundation: the response envelope
// (JSON + XML), the authentication hook (API key, u/t/s token, session
// cookie), the system endpoint group, and the Song/Album/Artist DTO +
// serializer layer. P9a added the browsing group (17 endpoints) and the
// retrieval group (7 endpoints, stream/download delegating to the playback
// StreamingService), all against docs/opensubsonic-quirks.md — the
// archaeology of every old behavior this adapter must reproduce (or
// deliberately fix). P9b completed the adapter: the starring group
// (star/unstar/setRating/scrobble/getStarred(2)), getNowPlaying from the P8
// players tracker, the playlist group (delegating to the playlists module's
// ONE policy), and the bookmark group (delegating to the playback service)
// — 46 registered routes, all 61 quirks done.
//
// Wire contract, per the quirks doc:
//   - Every response is enveloped in "subsonic-response" with HTTP 200,
//     including errors (status "failed" + error{code,message}).
//   - Auth precedence: apiKey query param → X-API-Key header → u/t/s token
//     → session cookie. Plaintext p= password auth is intentionally NOT
//     implemented (wire parity; documented but absent there too).
//   - Format: f=xml → XML, anything else → JSON; with no f param an
//     XML-typed Accept header selects XML (the one negotiated delta).
//   - Binary endpoints (stream/download/getCoverArt/getAvatar) answer
//     plain-text statuses, not envelopes (R1/R2); every content endpoint
//     enforces the caller's library scope (libraries/policy), and out-of-
//     scope entity lookups answer enveloped 70 like the old adapter.
package opensubsonic
