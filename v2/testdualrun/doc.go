// Package testdualrun is the P10b production dual-run harness.
//
// It snapshots the LIVE v1 production database (main file + WAL + SHM) and
// the v1 data directory (artist images, avatars) into a scratch area, boots
// the v2 server on a DB copy against the REAL read-only library directory,
// and verifies, in order:
//
//  1. Reconciliation: v2's boot-pushed initial scan completes with zero
//     per-file failures and reconciles the catalog to the files physically
//     on disk (the production DB's active catalog can be stale relative to
//     the library directory — that is a finding to report, not to paper
//     over).
//  2. Catalog diff: the v2-processed DB copy is compared table-by-table
//     against a pristine second copy of the snapshot that never saw v2 —
//     row counts plus per-row content hashes over canonical projections.
//     Every differing row is classified (reconciliation vs. real finding);
//     anything outside the classified set fails the test.
//  3. Serving on real data: five songs covering formats/flags get full-file
//     stream SHA-256 vs. the on-disk file, a range request vs. dd-extracted
//     bytes, cover-art bytes, and the same through /rest u/t/s token auth
//     (search3 + getAlbum on real metadata). A stream hash mismatch is a
//     release blocker and fails the test loudly.
//  4. A transcode smoke (maxBitRate) proving the ffmpeg path end-to-end.
//
// The run emits docs/v2-p10b-dualrun-report.md with the numbers, the
// cutover runbook, and the rollback story.
//
// Environment:
//   - P10B_TMP_ROOT: where the scratch copies live (the snapshot is ~1.7 GB
//     of copies; point this at a big disk, e.g. /var/tmp).
//   - P10B_KEEP_TMP: set to keep the scratch dir for post-run inspection.
//
// The harness NEVER writes to the live config directory and never attempts
// to authenticate against the live v1 server.
package testdualrun
