// Package testparity is the P10 cutover evaluation harness: a test-only
// package (nothing here is linked into the production binary) that boots the
// v1 TypeScript server from the main checkout and the v2 Go server against
// the SAME library directory and database file, replays one deterministic
// request script against both, and asserts the responses match after
// applying the accepted-delta normalization rules in parity_norm.go.
//
// The suite is the cutover gate: any delta not covered by a documented,
// commented normalization rule is a failure and lands in the BLOCKERS
// section of docs/v2-p10-parity-report.md.
package testparity
