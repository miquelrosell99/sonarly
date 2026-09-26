# S1 metadata spike artifacts

> Historical spike artifact (2026-09, pre-cutover investigation). Kept for archaeology; not part of the production build. Version names inside refer to the pre- and post-rewrite codebases.

Self-contained spike for plan.md S1. Two independent Go modules (this dir and
`../taglib`), each with its own `go.mod` — deliberately **not** part of the
production module `github.com/miquelrosell99/sonarly/server`, so `go build ./...`
from `server/` never touches them.

See `../../../docs/s1-metadata-findings.md` for the report.

## Layout

- `gen_corpus.py` — builds `corpus/` + `manifest.json` (ground truth).
  Requires: python3 + mutagen 1.48.1.
- `dump_v1.mjs` — gold standard: runs the retired reader's exact `music-metadata@11.14.0`
  (pnpm store copy in the main checkout) against the corpus.
- `main.go` — spike reader on `github.com/dhowden/tag` (pinned in `go.mod`).
- `../taglib/main.go` — comparison spike on `go.senan.xyz/taglib`
  (TagLib 2.1.1 via embedded Wasm; needs Go ≥ 1.25).

## Re-run

```sh
python3 gen_corpus.py
node dump_v1.mjs corpus gold_v1.json
go run . corpus > go_dhowden_dump.json      # from server/spikes/metadata
(cd ../taglib && go run . ../metadata/corpus > taglib_dump.json)
```
