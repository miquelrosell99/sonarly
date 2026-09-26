# S1 — Metadata spike findings: Go tag-reading vs v1 `music-metadata`

> Historical transition-era artifact (2026-09): documents the TypeScript→Go rewrite and cutover. Version names inside refer to the pre- and post-rewrite codebases; preserved as project history.

> Date: 2026-09-24 · Branch: `feat/go-rewrite` (worktree `.worktrees/go-rewrite`)
> Gate: plan.md S1 — gates P4 (library runtime). Deliverable per plan: *"an
> explicit accept/reject list of every tag semantic v1 supports, with product
> sign-off"* — not "it works".
> Status: **spike complete — sign-off list APPROVED by product owner 2026-09-25
> (W1/W2/W4 patches land in the owned fork before P4 ships; W5 built as
> part of the scanner; dead-SYLT / LRC-parity model accepted).**

---

## 1. Executive summary

**Recommendation: GO** — build the v2 scanner on Go, with `github.com/dhowden/tag`
as the tag reader plus a bounded, enumerated patch/shim list (§5) and a small
pure-Go audio-properties reader for duration/bitrate/sampleRate/channels (which
dhowden/tag does not provide at all). Full v1 tag parity is achievable without
CGO and without leaving the single-static-binary story. Every gap found is
closed by either a trivial shim in our code, a small upstream-shaped patch, or
~60–100 lines of new pure-Go code; none requires a new dependency except the
optional properties reader, which is hand-rolled.

**The biggest surprise of the spike**: v1's native-SYLT synced-lyrics branch in
`reader.ts` is *dead code* against the installed `music-metadata@11.14.0`
(native SYLT values are objects, and the code requires an array). In practice
v1 only ever extracts synced lyrics via the LRC-in-tag sniffing path
(`SYNCED_LYRICS` / `SYNCEDLYRICS`). That path is fully reachable through
dhowden/tag's `Raw()` on all four formats — so the scariest-looking semantic
(SYLT) reduces to parity-by-doing-nothing, and pure-Go covers it.

**Sign-off needed** (user-visible, enumerated in §6): explicit flag on m4a
(unpatched), multi-value tags on all formats (unpatched), duration/format
fields (until the properties reader lands — required for OpenSubsonic anyway),
ID3v1-only mojibake (unpatched shim), mb4a multi-value MBIDs.

---

## 2. Method

Corpus (generated, not sampled — every value chosen to be unambiguous):

| File | Format | Writer |
|---|---|---|
| `v2/spikes/metadata/corpus/spike.mp3` | MP3, ID3v2.4 + MPEG-1 L3 frame stream (~3.1 s @ 128 kbps) | mutagen 1.48.1 |
| `v2/spikes/metadata/corpus/spike.flac` | FLAC, Vorbis comments + picture block | mutagen 1.48.1 |
| `v2/spikes/metadata/corpus/spike.ogg` | Ogg Vorbis, comments + METADATA_BLOCK_PICTURE | hand-built (mutagen can't reserialize a synthetic vorbis stream) |
| `v2/spikes/metadata/corpus/spike.m4a` | MP4/M4A, ilst incl. freeform atoms + real mdhd/stsd/esds | hand-built (so duration/bitrate fields are real) |
| `v2/spikes/metadata/corpus/pathological-id3v1.mp3` | ID3v1 only, Latin-1 high bytes (`Caf\xe9 na\xefve`, `Bj\xf6rk \x86 stray \xff`) + frame stream | hand-built |

Every file carries the full v1 schema: multi-value artists/genres/composers,
all four MBID types (+ multi artist MBIDs), barcode, ASIN, ISRC, ReplayGain
track+album, explicit flag (TXXX / vorbis comment / mp4 `rtng`), producers,
label, release type, USLT lyrics, SYLT frame **and** LRC-in-TXXX, cover art.

Three artifacts per run, all reproducible (`v2/spikes/metadata/README.md`):

1. `manifest.json` — ground truth written by the generator.
2. `gold_v1.json` — `music-metadata@11.14.0` (v1's exact pnpm-locked version)
   run against the corpus via `dump_v1.mjs`, full `common` + `native` + `format`.
3. `go_dhowden_dump.json` / `../taglib/taglib_dump.json` — Go libraries' full
   output (typed accessors + `Raw()`), with per-file panic recovery.

v1 semantics were then evaluated by faithfully porting `reader.ts`
(`readMetadata`, `extractSyncedLyrics`, `detectExplicit`) onto the gold dump,
so the comparison column is *v1's actual behavior*, not the npm docs.

---

## 3. Library survey (2025-2026)

| Library | Status | Scope | Notes |
|---|---|---|---|
| `github.com/dhowden/tag` | 653★, last release commit **2024-04-17**, repo last touched 2024-07. Maintenance mode. | Read: ID3v1/v2, MP4, FLAC, Ogg Vorbis (+ DSF) | Pure Go, zero deps, ~4k LOC, clean code. No audio properties (duration/bitrate/…). Effectively fork-and-patch for us. |
| `go.senan.xyz/taglib` (`sentriz/go-taglib`) | 94★, **active** (pushed 2026-07-24). Bundles **TagLib 2.1.1 compiled to Wasm** (388 KB), runs on `wazero`. | Read **and write**, MP3/FLAC/M4A/WAV/OGG/WMA; properties (length, bitrate, sample rate, channels, bit depth); images | **No CGO — static builds preserved.** Needs Go ≥ 1.25 (toolchain auto-fetches). Costs: +wazero runtime (~MBs binary), per-file Wasm call overhead, and it still leaves three gaps (§4, last row). Write path would double as the P7 ingest writer (v1 uses mutagen for writes). |
| `github.com/mikkyang/id3-go` | idle since 2023 | ID3 only | No MP4/Vorbis. Not a candidate. |
| `github.com/bogem/id3v2` | repo gone/renamed; ID3v2 only anyway | — | Not a candidate. |
| `wtolson/go-taglib` and other CGO TagLib bindings | dead (2021) | — | **CGO breaks the pure-Go single-binary story** (cross-compile, static linking, base-image pain). Recorded as an option with that cost; rejected at v2.0. |

Survey conclusion: the realistic pure-Go menu is **dhowden/tag (read, patchable)**
and **go-taglib (read+write+properties, heavier)**. Everything below is measured
against dhowden/tag; go-taglib was also run against the same corpus and is
reported where it changes a conclusion (§5 W-column).

---

## 4. ACCEPT / REJECT / GAP table

Legend: **A** = accept (available via accessor or `Raw()`, with at most a
`TrimRight "\x00"`). **P** = partial (value reachable but degraded vs v1).
**G** = gap (needs the workaround in §5). **R** = reject (no support; needs a
new component). Formats: 3 = mp3(ID3v2.4), F = flac, O = ogg/vorbis, 4 = m4a.

| # | v1 semantic | 3 | F | O | 4 | Gap → §5 |
|---|---|---|---|---|---|---|
| 1 | title | A | A | A | A | |
| 2 | album | A | A | A | A | |
| 3 | albumArtist | A | A | A | A | |
| 4 | track no / total | A | A | A | A | totals via `trkn_count`/`tracktotal` |
| 5 | disc no / total | A | A | A | A | same |
| 6 | year (+ date string) | A | A | A | A | `TDRC`/`date`/`©day` raw; `Year()` int |
| 7 | **multi-value artists / genres / composers** | G | G | G | G | W1 |
| 8 | **multi-value MB artist ids** | P | G | G | G | W1 (mp3 keeps both NUL-separated in one TXXX → recoverable) |
| 9 | MBID recording (UFID / MUSICBRAINZ_TRACKID / freeform) | A | A | A | A | |
| 10 | MBID release | A | A | A | A | |
| 11 | MBID release-group | A | A | A | A | |
| 12 | MBID album-artist | A | A | A | A | |
| 13 | barcode | A | A | A | A | |
| 14 | ASIN | A | A | A | A | |
| 15 | ISRC | A (TSRC) | A | A | A | |
| 16 | ReplayGain track + album | A | A | A | A | raw `replaygain_*` |
| 17 | **explicit flag** | A (TXXX) | A (comment) | A (comment) | **G** (`rtng` atom not in dhowden's atom table — silently dropped) | W2 |
| 18 | composers | P | P | P | P | W1 (multi-value gap; single composer fine) |
| 19 | producers | P | A | A | A | W3 (mp3 `TIPL` raw is role+name concatenated w/o separator; **v1 also drops v2.4 TIPL producers — parity by doing nothing**, see §5 W3) |
| 20 | labels | A (TPUB) | A | A | A | |
| 21 | release type (`album; soundtrack` → prefers "soundtrack") | A | A | A | A | raw value + v1's 3-line preference fn |
| 22 | comment | A | A | A | A | |
| 23 | bpm | A | A | A | G (`tmpo` misread as 0 — 1-byte reader vs 2-byte value) | W2 (same class as rtng) |
| 24 | USLT / plain lyrics | A | A | A | A | `Lyrics()` accessor ✓ |
| 25 | **SYLT native synced lyrics** | — | — | — | — | **non-gap**: dead branch in v1 (§1). See #26. |
| 26 | synced lyrics via LRC-in-tag (TXXX `SYNCED_LYRICS`, vorbis `SYNCEDLYRICS`, mp4 freeform) | A | A | A | A | raw + v1's `parseLrc` port (~40 lines) |
| 27 | embedded cover art (picture[0]) | A | A | A | A | `Picture()` accessor all four incl. ogg METADATA_BLOCK_PICTURE; PNG/JPEG mime present |
| 28 | **ID3v1-only encoding (Latin-1 high bytes)** | **G** | — | — | — | W4: `Caf\xe9` → `Caf� na�ve` (invalid UTF-8 passthrough). ID3v2 ISO-8859-1 frames **are** decoded correctly by dhowden — this is ID3v1-only. |
| 29 | **duration** | R | R | R | R | W5 (required by OpenSubsonic regardless) |
| 30 | **bitrate / sampleRate / channels / bitsPerSample** | R | R | R | R | W5 |
| 31 | compilation flag | — | — | — | A (`cpil`) | (v1 reads `common.compilation`; parity ok) |
| 32 | totalTracks/totalDiscs as strings | A | A | A | A | #4/#5 |

Measured evidence for every row is in `go_dhowden_dump.json` vs `gold_v1.json`
side by side (e.g. row 7: mp3 `TPE1 = "Spike Artist OneSpike Artist Two"` —
NULs stripped, unrecoverable; flac/ogg `artist = "Spike Artist Two"` — last
wins, first lost; row 17: `rtng` absent from m4a raw map; row 28: mojibake
vs gold `Café naïve`).

---

## 5. Gap workarounds (W1–W5)

Effort estimates are against `dhowden/tag@v0.0.0-20240417` (7 core files,
~4 kLOC — genuinely clean). "Own fork" means vendoring
`github.com/miquelrosell99/sonarly/dhowden-tag` (or an internal package
forked from it); upstreaming is possible but the maintainer is slow, so plan
as if we own the fork.

- **W1 — multi-value collapse (rows 7, 8, 18).**
  - vorbis/flac/ogg: `vorbis.go:59` `m.c[strings.ToLower(k)] = v` — last wins.
    Patch to `map[string][]string` (or join-on-read with a separator that
    cannot appear… no: do it properly, []string). Touches accessors; ~1 day
    incl. tests. **go-taglib does this natively** (verified: full artist
    arrays, both MB artist ids on flac/ogg/mp3).
  - id3v2: `id3v2frames.go:310` `strings.Join(strings.Split(txt, "\x00"), "")`
    — one-line-shaped patch (return the parts instead of joining with "").
    Trivial.
  - mp4: `mp4.go` stores one value per atom; patch to accumulate repeated
    `data` atoms. Small.
  - *User-visible impact if unpatched:* multi-artist albums lose all but one
    artist; genre lists collapse; **MusicBrainz artist-id lists lose the first
    id** (row 8 — that one feeds external-ID lookups, not just display).
- **W2 — m4a `rtng` (explicit) and `tmpo` (bpm).** dhowden's mp4 atom table
  (`mp4.go:23`) lacks `rtng`; uint8 reader is 1-byte. Add `"rtng"` entry +
  2-byte int read: ~20 lines. *Impact if unpatched:* **explicit-content filter
  silently wrong for iTunes-sourced m4a** — the hide-explicit feature is
  user-visible (parental control, playlist filtering); needs sign-off.
  (go-taglib has the same gap: `rtng` not exposed, `COMPILATION` is.)
- **W3 — mp3 producers (TIPL).** dhowden concatenates role+name without
  separator. BUT the gold dump shows **v1 doesn't map v2.4 TIPL producers
  either** (music-metadata only maps v2.3 `IPLS` producers) — so doing nothing
  is v1 parity. If we want *better than v1*: parse `TIPL` raw with the known
  role list, ~30 lines. Sign-off: parity-loss = zero; improvement optional.
- **W4 — ID3v1 Latin-1 → UTF-8.** 5-line shim in our reader (bytes < 0x80 →
  as-is, else rune(b) — no x/text dependency needed). *Impact if unpatched:*
  pre-2005-ish untagged files show mojibake titles/artists. Low; sign-off
  cheap.
- **W5 — duration / bitrate / sampleRate / channels / bitsPerSample.**
  dhowden/tag provides **nothing** (tags only) — the biggest real gap. Options:
  1. **Hand-rolled pure-Go properties reader (recommended):** MP3 = frame-header
     scan (Xing/VBRI or CBR estimate — music-metadata's own algorithm, ~120
     lines); FLAC = STREAMINFO block (~40); Ogg = identification header + last
     granule (~60); MP4 = `mdhd` + `stsd` walk (~100). Total ~300 lines, zero
     new deps, fully testable against the corpus (real values already in
     `gold_v1.json` for all four formats). Note the corpus m4a exposed a
     music-metadata quirk: it reported `bitrate: 800` for our file while
     TagLib reported 129 kbps — v1's mp4 bitrate math is itself quirky; parity
     here means "close enough for display", not bit-exact.
  2. **go-taglib `ReadProperties` (option B):** free, battle-tested, exact
     (verified: length/bitrate/sampleRate/channels/bitDepth correct on all
     corpus files), and would hand P7 its tag *writer* — but adds wazero +
     Wasm to every scan, and needs Go 1.25.
  3. CGO taglib — rejected (breaks static binary).
  *Impact: blocking without one of these* — no duration means OpenSubsonic
  `duration` attributes and the player timeline break. Not sign-off-able as a
  loss; W5 must be built either way. This is the one place where "accept loss"
  is not on the table.

---

## 6. Recommendation & product sign-off list

**Go/no-go: GO.** Adopt for P4:

- **Primary: dhowden/tag + own fork carrying W1 (vorbis/id3v2/mp4), W2, and a
  W4 shim**, plus the hand-rolled W5 properties reader. This is the smallest
  dependency surface that reaches full v1 parity, keeps the static binary, and
  the fork is small enough to own outright (the alternative — designing our
  own ID3/MP4/Vorbis readers from scratch — is strictly more code and more
  risk than forking 4 kLOC of well-tested parsers).
- **Documented alternative: go.senan.xyz/taglib (option B)** as primary if
  product prefers battle-tested property reading and wants the write path for
  P7 ingest in the same dependency — accepting wazero in the binary and the
  residual gaps (W2-equivalent `rtng`, m4a multi-value collapse — verified on
  corpus: `ARTIST: ["Spike Artist One"]`, mp3 `SYNCED_LYRICS` ✓ but no native
  SYLT, which is parity anyway). A hybrid (go-taglib for properties+writes,
  dhowden raw for the residuals) is also viable but runs two tag stacks — not
  recommended at v2.0.
- **Rejected: CGO taglib** (static-binary story dies), **status-quo
  ffprobe/ffmpeg** (no ffmpeg on the host today; violates single-binary).

**Product sign-off required (per plan.md S1) — semantic losses if we shipped
the unpatched library, which we will not, except where stated:**

| Needs sign-off | Why user-visible |
|---|---|
| W1 multi-value loss (if patches deferred) | Artist/genre lists wrong on multi-artist releases; MusicBrainz artist-id arrays lose members → broken external-id linking |
| W2 m4a explicit flag (if patch deferred) | Hide-explicit filter silently passes explicit tracks for iTunes m4a purchases |
| W4 ID3v1 mojibake (if shim deferred) | Old rips show garbled titles/artists in UI |
| W5 properties reader is new code | Duration parity is a *build* item, not a loss, but its per-format quirks (mp3 VBR estimates) differ slightly from v1 — accept "close" |
| Dead SYLT branch | Zero-loss claim: v1 never parsed native SYLT with mm 11.14. Confirm product agrees synced-lyrics parity = LRC-in-tag path only |

Everything else in the v1 schema is **accepted as-is** (rows marked A/P above).

**Follow-ups filed for P4 design:** fork strategy (vendor vs `internal/`
package), W5 reader placement (`internal/audio`), corpus promotion into the P4
test suite (the generator + gold dump are already repeatable), and a
performance pass (dhowden pure-Go parse cost per file on a 50 k-track library;
if go-taglib is chosen, measure warm-Wasm per-file cost).

---

## 7. Artifacts & reproduction

All under `v2/spikes/` (own Go modules, **not** imported by `cmd/sonarly`;
production `go.mod` untouched — production tree still builds, verified):

- `v2/spikes/metadata/gen_corpus.py` — corpus generator (mutagen 1.48.1 +
  hand-built ogg/m4a); `python3 gen_corpus.py`
- `v2/spikes/metadata/corpus/` — 5 files (§2)
- `v2/spikes/metadata/manifest.json` — ground truth
- `v2/spikes/metadata/dump_v1.mjs` — gold dump via v1's exact
  `music-metadata@11.14.0`; `node dump_v1.mjs corpus gold_v1.json`
- `v2/spikes/metadata/main.go` — dhowden/tag spike; `go run . corpus`
- `v2/spikes/taglib/main.go` — go-taglib spike (same corpus); `go run . ../metadata/corpus`
- `gold_v1.json`, `go_dhowden_dump.json`, `taglib_dump.json` — measured outputs
  cited above
