# S2 streaming spike

Validates the Go streaming architecture before P5 (playback). Own Go module
(`sonarly-spike-streaming`) — **not** imported by `cmd/sonarly`; the production
tree under `v2/internal/` is untouched.

Findings: `docs/v2-s2-streaming-findings.md` (worktree root).

## Layout

| File | What |
|---|---|
| `genmedia.sh` | ffmpeg corpus generator → `media/` |
| `decide.go` | Ports of v1 `decideTranscode`, `parseMaxBitRate`, `parseRange` |
| `direct.go` | Direct path: `http.ServeContent` mode + v1-parity custom mode |
| `transcode.go` | `transcodeStreamer`: semaphore cap, `exec.CommandContext` kill-on-disconnect, slog outcomes |
| `main.go` | Demo server (`-addr`, `-cap`, `-media`) wiring both paths |
| `decide_test.go` / `direct_test.go` | Behavior parity matrices |
| `transcode_test.go` | Disconnect-kill, external kill, corrupt input, spawn failure, semaphore |
| `measure_test.go` | TTFB, spawn cost, RSS under load |

## Run

```sh
./genmedia.sh            # needs ffmpeg 5.1.x + ffprobe
go test ./... -v         # behavior + measurements (needs /proc, ~2-4 min)
go run . -cap 2          # demo server on :18099
```
