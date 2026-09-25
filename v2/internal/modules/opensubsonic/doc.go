// Package opensubsonic is the Subsonic/OpenSubsonic compatibility adapter
// served under /rest/*. P6.5 builds the foundation: the response envelope
// (JSON + XML), the authentication hook (API key, u/t/s token, session
// cookie), the system endpoint group, and the Song/Album/Artist DTO +
// serializer layer. Browsing/retrieval endpoints land in P9 against
// docs/v2-opensubsonic-quirks.md — the archaeology of every v1 behavior
// this adapter must reproduce (or deliberately fix).
//
// Wire contract, per the quirks doc:
//   - Every response is enveloped in "subsonic-response" with HTTP 200,
//     including errors (status "failed" + error{code,message}).
//   - Auth precedence: apiKey query param → X-API-Key header → u/t/s token
//     → session cookie. Plaintext p= password auth is intentionally NOT
//     implemented (v1 parity; documented but absent there too).
//   - Format: f=xml → XML, anything else → JSON; with no f param an
//     XML-typed Accept header selects XML (the one negotiated delta).
package opensubsonic
