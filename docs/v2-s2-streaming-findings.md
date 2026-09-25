# S2 — Streaming spike findings: Go `net/http` + ffmpeg vs v1 Fastify streaming

> Date: 2026-09-25 · Branch: `feat/go-rewrite` (worktree `.worktrees/go-rewrite`)
> Gate: plan.md S2 — gates P5 (playback). Deliverable per plan: measured results
> + architecture recommendation, not "it works".
> Status: **spike complete — GO.** All numbers below are from `go test ./... -v`
> in `v2/spikes/streaming` (Go 1.23.4, ffmpeg 5.1.9, linux/amd64, this host).
> Production tree untouched; `cd v2 && go build ./... && go vet ./...` green.

---

## 1. Executive summary

**Recommendation: GO.** Build the P5 streaming layer in Go as
`StreamingService → DirectStreamer / TranscodingStreamer` (§8), one service
behind both the native and OpenSubsonic endpoints — exactly the shape the
backend audit §18 prescribes for playback. Every v1 streaming behavior was
reproduced or improved with stdlib-only code (zero new dependencies): the
direct path is `http.ServeContent` behind four small parity guards, the
transcode path is `exec.CommandContext` + a buffered-channel semaphore, and
the v1 transcode-decision semantics (incl. the `min(requested, userCap)` clamp
from the `ff4a1ec` hardening) port line-for-line.

**Key measured numbers** (medians, localhost, synthetic corpus):

| Metric | Value |
|---|---|
| Direct stream TTFB (headers) | **95 µs** (73 µs min) |
| Transcode TTFB (headers, includes ffmpeg spawn+init) | **42.3 ms** (41.5 ms min) |
| `exec.Cmd.Start` process-spawn cost | **54 µs** (42–105 µs) |
| Server-side spawn → first MP3 byte | **40.6 ms** → 99.9 % of transcode TTFB is ffmpeg init, not spawn |
| Client disconnect → ffmpeg SIGKILL observed gone (`/proc`) | **3.4 ms** mid-stream, **3.4 ms** immediate (max 6.6 ms) |
| Transcode slot rejection (cap full) | **503 + Retry-After in ~0.2 ms**, no queue, no hang |
| Go process RSS @ 20 range streams + 2 transcodes | rest 9.3 MB → max **13.8 MB** (+4.4 MB; Go heap +0.96 MB) |
| ffmpeg child RSS (one 24/96 → 320k transcode) | **~53 MB** each — the real memory cost of a transcode slot |
| Full 60 s 24/96 → 320 kbps mp3 transcode wall time | **< 1 s** (~100× realtime; synthetic best case — see §7) |

**The three surprises** (details §6):

1. **Go 1.21+ `http.ServeContent` DOES multi-range** — `206
   multipart/byteranges` where v1 answers `416`. The task brief assumed no
   multipart; that was true ≤ Go 1.20. Client-visible delta, needs a guard.
2. **`bytes=-0` makes ServeContent emit an invalid `Content-Range`**:
   `206`, `Content-Length: 0`, `Content-Range: bytes 481115-481114/481115`
   (start > end). v1 answers `416`. Guarded by the same pre-validation.
3. **Go has no v1-B12 async-spawn trap**: `exec.Cmd.Start` returns ENOENT
   synchronously (measured: error after ~5 µs, zero bytes written), so the
   "fallback to direct serving when ffmpeg is missing" fix is race-free by
   construction — no `spawn`/`error` event dance needed.

---

## 2. Method & corpus

Generated with `v2/spikes/streaming/genmedia.sh` (ffmpeg 5.1.9, ffprobe-verified):

| File | Stream | Size | Use |
|---|---|---|---|
| `spike_128k.mp3` | 30.04 s MP3 128 kbps CBR 44.1 k | 481 115 B | direct-path range matrix |
| `spike.flac` | 30.00 s FLAC 16/44.1 (~98 kbps) | 368 006 B | transcode @128k scenario |
| `spike_320k.mp3` | 60.03 s MP3 320 kbps CBR 44.1 k | 2 402 264 B | high-bitrate direct source, RSS load |
| `spike_2496.flac` | 60.00 s FLAC 24/96, ~**1.99 Mbps** | 14 948 124 B | high-bitrate transcode source |
| `corrupt.mp3` | 200 000 random bytes, `.mp3` ext | 200 000 B | ffmpeg-failure scenario |

Spike code: `v2/spikes/streaming/` (own module `sonarly-spike-streaming`, not
imported by `cmd/sonarly`):

- `decide.go` — Go ports of v1 `decideTranscode`, `parseMaxBitRate`,
  `parseRange` (from the **main checkout**, post-`ff4a1ec` clamp; the
  worktree's `packages/server` copy is the older pre-fix version — the spike
  ported main's semantics deliberately).
- `direct.go` — two direct modes: `http.ServeContent` (SC) and a v1-parity
  custom handler (V1), both behind the same 404/stat flow; 64 KiB copy chunks
  (v1 `createReadStream` highWaterMark parity).
- `transcode.go` — `transcodeStreamer`: buffered-channel semaphore,
  `exec.CommandContext` (stdlib wires ctx-cancel → `Process.Kill` = SIGKILL),
  64 KiB copy loop with kill-on-write-error, bounded 4 KiB stderr tail,
  slog outcomes incl. request ID.
- `main.go` — demo server (`-cap`, `-addr`, `-media`) shaped like the planned
  P5 service: routes decide → direct | transcode; 503/Retry-After on full
  slots; spawn-failure → direct fallback.
- Tests: `decide_test.go` (decision/parse tables), `direct_test.go` (16-case
  range matrix × 2 modes + delta capture), `transcode_test.go` (behavior +
  kill measurements), `measure_test.go` (TTFB/spawn/RSS).

All behavioral tests run against a real `httptest.Server` with a real
`net/http` client (true chunked/HEAD/connection semantics), not
`ResponseRecorder`, except the spawn-failure test which needs an unroutable
binary.

---

## 3. Direct path: `http.ServeContent` vs v1-parity custom handler

### 3.1 Range parity matrix (both modes, 16 cases, body bytes verified against file slices)

| Case | SC mode | V1 mode | Match |
|---|---|---|---|
| no range | 200, CL=481115 | 200, CL=481115 | ✅ |
| `bytes=0-99` | 206, CL=100, CR `0-99/481115` | same | ✅ |
| `bytes=100-199` | 206, CL=100 | same | ✅ |
| `bytes=100-` (open) | 206, CR `100-481114/…` | same | ✅ |
| `bytes=-100` (suffix) | 206, CR `481015-481114/…` | same | ✅ |
| `bytes=-481115` (suffix=size) | 206 whole file | same | ✅ |
| `bytes=-999999999` (suffix>size) | 206 whole file | same | ✅ |
| `bytes=0-999999999` (clamp) | 206 whole file | same | ✅ |
| `bytes=481115-` (start=size) | 416 | 416 | ✅ status |
| `bytes=999999999-` | 416 | 416 | ✅ status |
| `bytes=200-100` (end<start) | 416 | 416 | ✅ status |
| `bytes=abc-def` | 416 | 416 | ✅ status |
| `items=0-99` | 416 | 416 | ✅ status |
| `bytes=-0` (zero suffix) | **206, CL=0, CR `481115-481114/481115` (invalid!)** | 416 | ❌ **surprise 2** |
| `bytes=0-99,200-299` (multi) | **206 `multipart/byteranges` (525 B, 2 parts)** | 416 | ❌ **surprise 1** |
| `bytes=0-9,20-29,40-49` | 206 multipart (481 B, 3 parts) | 416 | ❌ |

Both modes: correct `Accept-Ranges: bytes` on 200/206 (SC must be given the
header up-front for 200s — it only sets it on 206), absent file → 404 in both,
HEAD (no Range) → 200 + full CL + empty body in both.

### 3.2 Verdict: ServeContent alone does NOT suffice for v1 parity

Four client-visible deltas need guards (or a full custom handler):

1. **Multi-range → 206 multipart** (Go ≥1.21; `net/http/fs.go:361`) vs v1's
   416. A Subsonic client that pipelines multi-ranges (rare, but DLNA-ish
   players exist) would get a body it never got from v1.
2. **`bytes=-0` → 206 with an inverted Content-Range** vs v1's 416. An
   invalid header on the wire from the stdlib — worth rejecting regardless of
   parity.
3. **HEAD + Range → 206 (CL=100)** vs v1's 200 + full CL (v1 special-cases
   HEAD before range parsing). Seek-probing clients (Symfonium sends HEAD
   with Range) observe different length semantics.
4. **416 envelope**: Go adds `Content-Range: bytes */size` on no-overlap
   (harmless, RFC-recommended) and answers `text/plain; charset=utf-8` with a
   small machine body; v1 keeps the file's `Content-Type` (e.g. `audio/mpeg`)
   with body `Invalid range`. Cosmetic; clients key on status only.
   (Also note: Go adds `Content-Range */size` only for no-overlap; syntax
   errors get a bare 416 — same as v1 there.)

**Recommendation (decision D1)**: keep `http.ServeContent` as the I/O engine
and add a thin v1-validation pre-pass (~15 lines, already ported in
`decide.go::parseRangeV1`): if a `Range` header is present, validate it with
v1 rules first — multi-range, zero-suffix, or any v1-invalid spec → v1-style
416; otherwise hand the request to `ServeContent` (single-range specs that
pass v1 validation behave identically in SC; residual nano-deltas: `bytes=+5-9`
accepted by v1's `parseInt`, rejected by Go — no client sends it). This keeps
ServeContent's battle-tested I/O, `If-Modified-Since`→304, and `Last-Modified`
(§6.5) while making the wire byte-identical to v1 everywhere it matters. The
full custom V1 handler remains in the spike as the fallback if product prefers
byte-parity over 304 support.

Also **pin the Content-Type map** (`direct.go::contentTypeByExt`, v1
mime-types values): measured host Go lookup disagrees with v1 —
`flac`: host `audio/flac` vs v1 `audio/x-flac`; `wav`: host `audio/x-wav` vs
v1 `audio/wav`; `mp3`/`m4a`/`ogg`/`opus`/`aac` agree. Worse, on a scratch
container image `/etc/mime.types` may be absent and Go's builtin table is
tiny → ServeContent would sniff. Never let Content-Type depend on the host.

---

## 4. Transcode path

### 4.1 Wire behavior (argv = v1's, `exec.Command`, no shell)

`ffmpeg -hide_banner -loglevel error -i <file> -map 0:a:0 -c:a libmp3lame -b:a
128k -f mp3 pipe:1` (or `-q:a 2` when no bitrate — v1 parity). Measured
response: `200`, `Content-Type: audio/mpeg`, **`Accept-Ranges: none`**, **no
`Content-Length`, `Transfer-Encoding: chunked`**, body 480 698 B for the 30 s
FLAC @128k and it **decodes cleanly** (ffprobe: `mp3, 30.040813 s, 128011 bps`).
Body starts with an **ID3v2 tag** (`49 44 33…`) — ffmpeg's mp3 muxer emits it
on pipes; v1's identical argv does the same, so this is parity, but any P5
"is this really mp3" sniffing must skip ID3 first (helper in the tests).

HEAD on a transcode-decided route: `200`, `audio/mpeg`, `Accept-Ranges: none`,
no body, **and no ffmpeg spawned** (v1 parity, asserted).

### 4.2 Disconnect → ffmpeg death (MEASURED, `/proc/<pid>` polling at 1 ms)

- Mid-stream disconnect (after 256 KiB): SIGKILL observed at **3.46 ms
  median, 6.59 ms max** (n=5).
- Immediate disconnect (close right after headers): **3.36 ms median,
  3.61 ms max** (n=5).
- Mechanism: `exec.CommandContext(r.Context(), …)` — Go cancels the request
  ctx on connection teardown and the stdlib kills the process (SIGKILL on
  Linux). No manual `request.raw.on('close')` wiring, no zombie leak (every
  test's `t.Cleanup` asserts `livePIDs` is empty).
- The copy loop's write-error branch also kills (belt & suspenders for the
  case where the kernel reports EPIPE before ctx propagation).

### 4.3 ffmpeg failure modes

| Scenario | Client sees | v1 behavior | Spike v2 behavior |
|---|---|---|---|
| External SIGKILL mid-stream | 200, **truncated** body (266 925 of 2 401 005 B) | truncated stream, `console.error` | truncated 200 (headers committed — unavoidable) + **slog error with request ID + ffmpeg stderr tail** | 
| Corrupt input / missing file (dies pre-first-byte) | **500** (body `Transcode failed`) | empty 200 (headers already committed by Fastify before ffmpeg exits) | **500** — Go hasn't committed headers because no byte was written; the one deliberate wire deviation, recommended (sign-off item) |
| ffmpeg binary missing | **200 full original file** (fallback to direct) | dead fallback pre-`ff4a1ec`; race-fixed fallback post-`ff4a1ec` | race-free by construction: `Start` returns the error synchronously (measured ~5 µs, 0 bytes written) → handler falls back to `directServeContent` |

Trailer/`Connection: close` were considered for mid-stream failures and
rejected: Subsonic clients don't surface trailers, the stream is already
truncated either way, and the slog record + stderr tail is what operators
actually need. Decision D5.

### 4.4 Spawn latency / TTFB

- `exec.Cmd.Start` alone: **54 µs median** (42–105 µs, n=30) — process
  creation is noise.
- Server-side, stream entry → first response byte: **40.6 ms median**
  (n=10) — i.e. **>99 % of transcode TTFB is ffmpeg init + first MP3 frame**,
  not Go. 42.3 ms client-side (headers) vs 95 µs direct — the transcode
  premium is real and irreducible without a pre-transcode cache (out of scope;
  audit §10 agrees live-transcode-per-request is correct at this scale).

---

## 5. Concurrency cap

Implementation: `chan struct{}` (cap 2 default) owned by the
`TranscodingStreamer` — **cap lives in the streaming service, not per-route**
(decision D6; routes share one service instance, audit §18). Acquisition is
`select` with `default` → **reject, don't queue**.

Measured under genuine saturation (both slots held by slow readers):

- 3 direct streams during saturation: **3/3 completed, unaffected** (direct
  path never touches the semaphore — asserted in the handler wiring, and the
  direct handlers don't even receive the streamer).
- 1 transcode while saturated: **503 + `Retry-After: 3` in 174 µs**.
- 6 concurrent transcodes at cap=2: **2×200 + 4×503**, all rejections
  252–275 µs (no client ever waited on a full slot).

**Policy recommendation (reject, not queue)**: a queued stream holds an HTTP
connection + client timeout against a realtime encoder that may take a
track's duration to free a slot; an immediate 503 lets clients (which already
handle transcoded-stream unavailability) retry or fall back to direct. Queue
would also need its own fairness/cancellation story for zero user-visible
benefit at self-host scale. **v1 had no cap at all** (audit: transcode-DoS),
so 503s are new user-visible behavior — product sign-off item S1.

RSS note: each live transcode costs **~53 MB** (ffmpeg child, libmp3lame +
96 kHz decode buffers — this synthetic stream is a heavy decoder case) — at
cap 2 that's ~106 MB worst-case, bounded by construction. Direct streams:
**no ffmpeg, ~0 memory** (§7).

---

## 6. Go-vs-v1 deltas that matter (client-visible summary)

| # | Behavior | v1 | Go (naive) | Spike resolution |
|---|---|---|---|---|
| 1 | Multi-range | 416 | 206 multipart/byteranges | pre-validate → 416 (parity) |
| 2 | `bytes=-0` | 416 | 206 + invalid CR | pre-validate → 416 (parity) |
| 3 | HEAD + Range | 200 + full CL | 206 + range CL | strip Range on HEAD → 200 (parity) |
| 4 | 416 headers | no CR, audio CT | CR `bytes */size` on no-overlap, text/plain body | accept Go (harmless, RFC-recommended); cosmetic |
| 5 | Conditional GET | none | `Last-Modified` + `If-Modified-Since`→304 | **accept Go** (improvement; sign-off) |
| 6 | Content-Type | mime-types db (host-independent) | host `/etc/mime.types` or sniff | **pin v1's map** (host-independent) |
| 7 | Range on transcode | ignored (200 from 0, chunked) | same (spike ignores by construction) | parity ✅ |
| 8 | Transcode HEAD | 200 CT+AR only, no spawn | same | parity ✅ |
| 9 | ffmpeg missing | dead fallback (F13) / race-fixed post-B12 | — | synchronous spawn error → clean fallback (better) |
| 10 | Transcode pre-first-byte failure | empty 200 | — | **500** (deliberate deviation, recommended) |
| 11 | `maxBitRate="0x40"` (hex) | honored (=64) | rejected (→ ignored) | accepted nano-delta (no client sends hex) |
| 12 | Transcode body head | ID3v2 tag | ID3v2 tag | parity (identical argv) ✅ |
| 13 | `bytes=+5-9` | 206 (JS parseInt) | 416 | accepted nano-delta |

Deltas 1–3 are why "just call `http.ServeContent`" is not the answer;
delta 6 is why the MIME map must be pinned; deltas 9–10 are strict
improvements the Go stdlib makes trivial.

---

## 7. Memory / CPU sanity

`TestMeasureRSSUnderLoad`: 20 concurrent range streams (2.4 MB file, throttled
readers) + 2 transcodes (24/96 → 320k, throttled), 4.5 s window:

- Go process VmRSS: rest **9 332 KiB** → max **13 792 KiB** (+4 460 KiB);
  after drain + `runtime.GC()` **13 828 KiB** (Go retains freed arenas in
  RSS — HeapInuse delta only **+960 KiB**, i.e. no per-stream heap growth, no
  full-file buffering; 64 KiB copy buffers confirmed by construction).
- ffmpeg children: **~53 MB RSS each** while encoding.
- No zombie ffmpeg after any test (`livePIDs` empty at every `t.Cleanup`).

Encoding speed caveat: this synthetic corpus (sines + pink noise, mono)
encodes at ~100× realtime (60 s transcode < 1 s wall), which is a best case —
real music typically runs 5–15× realtime for libmp3lame. All latency numbers
(TTFB, kill latency) are unaffected; only slot-holding duration in production
will be longer than these tests.

---

## 8. Architecture recommendation for P5

Mirror the audit §18 playback module — one `StreamingService` behind **both**
the native `/api/stream/:id` and OpenSubsonic `/rest/stream.view` +
`download.view` (kills the v1 duplication and the "Subsonic-only play
accounting" audit gap by construction):

```text
internal/modules/playback/
├── service.go        StreamingService
│                       Decide(song, user, requestedMaxBitRate) → direct | transcode
│                       (ports decide.go + parseMaxBitRate verbatim)
├── direct.go         DirectStreamer
│                       stat → 404/Subsonic-70 → HEAD strip → v1 range pre-validation
│                       → http.ServeContent + pinned MIME map + Accept-Ranges
├── transcode.go      TranscodingStreamer
│                       semaphore (cap, default 2, config) → 503 + Retry-After
│                       exec.CommandContext (kill-on-disconnect) → 64 KiB copy
│                       spawn-failure → direct fallback (synchronous, race-free)
│                       mid-stream death → slog + requestID + stderr tail
│                       pre-first-byte death → 500
└── routes.go         thin adapters (native + opensubsonic), zero business rules
```

Decisions recorded for P5 (D1–D6 resolved by this spike; S1–S5 need product
sign-off):

- **D1 Direct engine**: `http.ServeContent` + v1 pre-validation guards.
  Alternative (full custom port, in spike as `directCustomV1`) rejected: more
  owned code for zero wire difference after guards, and it would forfeit
  `Last-Modified`/304.
- **D2 ffmpeg-missing fallback**: YES, fallback to direct — race-free in Go.
- **D3 maxBitRate**: port `parseMaxBitRate` (integer 64..10000) and the
  `min(requested, userCap)` clamp from main-checkout v1 verbatim.
- **D4 Range×transcode**: ignore Range, 200 chunked from t=0 (v1 parity).
- **D5 Mid-stream failure**: truncated 200 + slog (incl. request ID); no
  trailers; pre-first-byte → 500.
- **D6 Cap location + default**: inside `TranscodingStreamer` (service-level,
  not per-route), **default 2**, configurable.

## 9. P5 build list (ordered)

1. `playback` module skeleton + `decide.go` port + decision-table tests
   (copy from spike `decide_test.go`).
2. `DirectStreamer` (§3 guards + pinned MIME) + the 16-case range matrix tests.
3. `TranscodingStreamer` + argv/HEAD/range tests + disconnect-kill test
   (assert <100 ms; measured 3.4 ms here).
4. Semaphore + config (`playback.max_concurrent_transcodes`, default 2) +
   saturation tests (2 accepted, rest 503 + Retry-After, direct unaffected).
5. Spawn-failure fallback-to-direct (synchronous — no v1-B12 dance) + test.
6. Route wiring: native `/api/stream/:id` AND OpenSubsonic
   `stream.view`/`download.view`; **record play accounting for all clients**
   (audit gap: v1 native stream records nothing); vanished-file → Subsonic
   code-70 envelope (keep v1's stat-first order so ffmpeg never sees a missing
   file).
7. Quirks-checklist entries in `docs/v2-opensubsonic-quirks.md` (P6.5):
   multi-range 416, HEAD+Range 200-full, `Accept-Ranges: none` on transcode,
   ID3v2-headed transcode bodies, 500-on-early-transcode-failure, 503 cap
   behavior, code-70 envelope.

## 10. Product sign-off items

| # | Item | What the user sees | Recommendation |
|---|---|---|---|
| S1 | **503 + Retry-After when transcode slots full** (cap 2) | Client-dependent: most Subsonic clients retry or fall back; some show a transient error. v1 had no cap (CPU-DoS, audit) | Accept 503-reject; cap default 2 configurable |
| S2 | **500 on pre-first-byte transcode failure** (v1: empty 200) | Failed transcodes surface as an error instead of silent 0-byte "song" | Accept (strict improvement) |
| S3 | **`Last-Modified` + 304 conditional support** on direct streams (v1: none) | Better caching in clients that revalidate; byte-identical full responses | Accept |
| S4 | **Multi-range → 416 / HEAD+Range → 200-full** (parity guards) | Identical to v1; only pathological requests affected | Accept parity |
| S5 | **Inactive songs**: v1 streams them (audit gap); v2 playback should check `active` + library scope (F1) | 404 for songs the library has deactivated; v1 silently served them | Confirm v2 fixes this (recommended; consistent with F1 boundary) |

## 11. Artifacts & reproduction

All under `v2/spikes/streaming/` (own module, **not** imported by
`cmd/sonarly`; production `go.mod` untouched):

- `genmedia.sh` — corpus generator (needs ffmpeg + ffprobe 5.1.x)
- `decide.go`, `direct.go`, `transcode.go`, `main.go` — spike implementation
- `decide_test.go`, `direct_test.go`, `transcode_test.go`, `measure_test.go` —
  all behavioral + measurement tests
- `go test ./... -v` — full suite (~10 s + transcode encode time; needs
  `/proc` for the kill/RSS measurements)
- `go run . -cap 2` — demo server on `:18099`
- Verification run 2026-09-25: **all tests PASS**; `gofmt`/`go vet` clean;
  `cd v2 && go build ./... && go vet ./...` green; `git status` shows only
  the untracked spike dir (nothing committed, main checkout untouched).
