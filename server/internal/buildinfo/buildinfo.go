// Package buildinfo carries the server version reported by API surfaces.
//
// The retired TypeScript server hardcoded serverVersion "0.1.0" in its
// Subsonic envelope while the released server was already at 0.7.x
// (../../.audits/opensubsonic-quirks.md E2). The Go server injects the real version
// at build time:
//
//	go build -ldflags "-X github.com/miquelrosell99/sonarly/server/internal/buildinfo.Version=0.8.0"
//
// A dev build (no ldflags) reports the dev default.
package buildinfo

// Version is the Sonarly server version. Overridden via -ldflags -X at
// release build time; the default marks untagged development builds.
var Version = "0.0.0-dev"
