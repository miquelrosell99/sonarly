package testparity

// Cutover evaluation report: summarizes the parity run (cases, accepted
// deltas, blockers) plus the sequential-fetch performance smoke, and writes
// docs/v2-p10-parity-report.md next to the quirks doc.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

type caseResult struct {
	Group    string
	Name     string
	Failures []string
	Accepted []string
	RawV1    any // original decoded payloads for blocker forensics
	RawV2    any
}

var results []caseResult

// TestParity asserts the replay results computed in TestMain.
func TestParity(t *testing.T) {
	if results == nil {
		t.Skip("parity replay not run")
	}
	var failed int
	for _, r := range results {
		if len(r.Failures) == 0 {
			continue
		}
		failed++
		t.Errorf("case %s/%s:\n  %s", r.Group, r.Name, strings.Join(r.Failures, "\n  "))
	}
	t.Logf("parity: %d/%d cases passed", len(results)-failed, len(results))
}

// runPerformanceSmoke sequentially fetches 200 song details against each
// server and records the wall time (informational only). Runs from TestMain
// while both servers are still up.
func runPerformanceSmoke() error {
	const requests = 200

	fetchIDs := func(port int) ([]string, error) {
		c := newClient(port, newWorld(), env.password, port == env.v2Port)
		if _, err := c.doRaw("POST", "/api/login",
			map[string]any{"username": adminUser, "password": env.password}, nil); err != nil {
			return nil, err
		}
		cap, err := c.do("GET", "/api/songs", nil, nil)
		if err != nil {
			return nil, err
		}
		var ids []string
		for _, s := range listAt(jsonBody(cap), "songs") {
			if m, ok := s.(map[string]any); ok {
				if id, ok := m["id"].(string); ok {
					ids = append(ids, id)
				}
			}
		}
		return ids, nil
	}

	run := func(port int, ids []string) (time.Duration, error) {
		c := newClient(port, newWorld(), env.password, port == env.v2Port)
		if _, err := c.doRaw("POST", "/api/login",
			map[string]any{"username": adminUser, "password": env.password}, nil); err != nil {
			return 0, err
		}
		start := time.Now()
		for i := 0; i < requests; i++ {
			cap, err := c.do("GET", "/api/songs/"+ids[i%len(ids)], nil, nil)
			if err != nil || cap.status != 200 {
				return 0, fmt.Errorf("smoke fetch %d: status=%d err=%v", i, cap.status, err)
			}
		}
		return time.Since(start), nil
	}

	v1IDs, err := fetchIDs(env.v1Port)
	if err != nil {
		return err
	}
	v2IDs, err := fetchIDs(env.v2Port)
	if err != nil {
		return err
	}
	if len(v1IDs) != len(v2IDs) {
		return fmt.Errorf("smoke: song counts differ: %d vs %d", len(v1IDs), len(v2IDs))
	}
	v1Dur, err := run(env.v1Port, v1IDs)
	if err != nil {
		return err
	}
	v2Dur, err := run(env.v2Port, v2IDs)
	if err != nil {
		return err
	}
	perfSmoke = &perfResult{
		Requests:     requests,
		SongCount:    len(v1IDs),
		V1Wall:       v1Dur,
		V2Wall:       v2Dur,
		V2OverV1:     float64(v2Dur) / float64(v1Dur),
		V1PerRequest: v1Dur / requests,
		V2PerRequest: v2Dur / requests,
	}
	logf("perf smoke: %d song details — v1 %s (%s/req), v2 %s (%s/req), ratio %.2fx",
		requests, v1Dur, perfSmoke.V1PerRequest, v2Dur, perfSmoke.V2PerRequest, perfSmoke.V2OverV1)
	return nil
}

// TestPerformanceSmoke documents that the smoke ran during TestMain setup.
func TestPerformanceSmoke(t *testing.T) {
	if perfSmoke == nil {
		t.Skip("performance smoke not run")
	}
	t.Logf("perf smoke: %d requests over %d songs — v1 %s, v2 %s (%.2fx)",
		perfSmoke.Requests, perfSmoke.SongCount, perfSmoke.V1Wall, perfSmoke.V2Wall, perfSmoke.V2OverV1)
}

type perfResult struct {
	Requests     int
	SongCount    int
	V1Wall       time.Duration
	V2Wall       time.Duration
	V2OverV1     float64
	V1PerRequest time.Duration
	V2PerRequest time.Duration
}

var perfSmoke *perfResult

// ---------------------------------------------------------------------------
// Report writer.
// ---------------------------------------------------------------------------

// blockerAnalysis maps a failing case to its root-cause analysis where the
// investigation went past a guess. The P10 share-link/visibility cluster
// was resolved by the strict-v1-parity decision (see the module doc.go);
// entries stay here for future blockers.
var blockerAnalysis = map[string]string{}

// writeBlockerSummary renders the decision-ready summary of unresolved
// blockers. Empty today: the P10 share-link/visibility cluster was fixed
// by the strict-v1-parity decision (token lifecycle independent of
// visibility, OSS updatePlaylist re-derivation ported; see
// internal/modules/playlists/doc.go).
func writeBlockerSummary(sb *strings.Builder, blockers []caseResult) {
	if len(blockers) == 0 {
		sb.WriteString("## Blocker summary\n\nNone — all compared surfaces match after normalization. " +
			"The P10 share-link/visibility blocker was resolved by the strict-v1-parity decision: " +
			"the share-token lifecycle is independent of visibility (native share-link/delete touch only the token; " +
			"native visibility PUTs never clear it), the Subsonic updatePlaylist re-derives the token from the " +
			"resolved visibility like v1, and the native anonymous metadata view keeps v1's matching-token-grants-view " +
			"rule while streaming/content grants and the adapter stay on link+token (internal/modules/playlists/doc.go).\n\n")
	}
}

func writeReport(exitCode int, total time.Duration) {
	var sb strings.Builder
	var pass, fail int
	accepted := map[string]int{}
	var blockers []caseResult
	for _, r := range results {
		if len(r.Failures) == 0 {
			pass++
		} else {
			fail++
			blockers = append(blockers, r)
		}
		for _, a := range r.Accepted {
			accepted[a]++
		}
	}

	fmt.Fprintf(&sb, "# Sonarly v2 — P10 parity & cutover evaluation report\n\n")
	fmt.Fprintf(&sb, "Generated by `go test ./testparity/` on %s.\n\n", time.Now().Format("2006-01-02 15:04"))
	fmt.Fprintf(&sb, "- **Cases**: %d total — %d passed, %d failed\n", len(results), pass, fail)
	fmt.Fprintf(&sb, "- **Suite wall time**: %s\n", total.Round(time.Second))
	fmt.Fprintf(&sb, "- **Verdict**: %s\n\n", map[bool]string{true: "READY FOR CUTOVER (no blockers)", false: "BLOCKERS FOUND — see below"}[fail == 0])

	sb.WriteString("## Method\n\n")
	sb.WriteString("`testparity` seeds a temp library (12 songs / 3 albums / 4 artists, mp3+flac+ogg+m4a, " +
		"multi-genre, one explicit, one with embedded art, lyrics, multi-disc, track totals) with the " +
		"`internal/audio` mutagen writer, boots the **v1 TypeScript server** from the main checkout, scans, " +
		"then snapshots the SQLite DB and boots the **v2 Go server** on the copy (same library dir, same " +
		"`SESSION_SECRET`, so the v1-created admin user and its Subsonic secret box work on both). " +
		"One deterministic request script is replayed against both; v2 also runs its boot-time scan first " +
		"(the scanner is file-read-only; this is the 'both do a post-import scan pass' option from the P10 brief). " +
		"The DB snapshot is taken between the script's read phase and write phase, so write round-trips " +
		"(favorites, ratings, scrobbles, playlists, bookmarks, star) replay from identical state on both servers. " +
		"Created-entity ids and share tokens are server-generated uuids: the harness maps v1 values onto v2 " +
		"counterparts before diffing; write-time timestamps are canonicalized on both sides. " +
		"**Any delta not covered by a commented rule in `parity_norm.go` is a BLOCKER.**\n\n")

	sb.WriteString("## Case results\n\n")
	sb.WriteString("| Group | Case | Result | Accepted deltas |\n|---|---|---|---|\n")
	for _, r := range results {
		status := "PASS"
		if len(r.Failures) > 0 {
			status = "FAIL"
		}
		acc := "-"
		if len(r.Accepted) > 0 {
			seen := map[string]bool{}
			var ids []string
			for _, a := range r.Accepted {
				id := strings.SplitN(a, ":", 2)[0]
				if !seen[id] {
					seen[id] = true
					ids = append(ids, id)
				}
			}
			acc = strings.Join(ids, ", ")
		}
		fmt.Fprintf(&sb, "| %s | %s | %s | %s |\n", r.Group, r.Name, status, acc)
	}
	sb.WriteString("\n")

	sb.WriteString("## Accepted deltas (normalized, with justification)\n\n")
	if len(accepted) == 0 {
		sb.WriteString("None — every compared payload matched exactly.\n\n")
	} else {
		keys := make([]string, 0, len(accepted))
		for k := range accepted {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Fprintf(&sb, "- **%s** (%d cases) — %s\n", strings.SplitN(k, ":", 2)[0], accepted[k], strings.SplitN(k, ":", 2)[1])
		}
		sb.WriteString("\n")
	}

	sb.WriteString("## Blockers\n\n")
	if len(blockers) == 0 {
		sb.WriteString("None found.\n\n")
	} else {
		for _, b := range blockers {
			fmt.Fprintf(&sb, "### %s/%s\n\n", b.Group, b.Name)
			for _, f := range b.Failures {
				fmt.Fprintf(&sb, "- %s\n", f)
			}
			if analysis, ok := blockerAnalysis[b.Group+"/"+b.Name]; ok {
				fmt.Fprintf(&sb, "- Cause: %s\n", analysis)
			} else {
				fmt.Fprintf(&sb, "- Cause guess: see the delta above; first check whether it is a real v2 behavior "+
					"difference (compare against the v1 source), then whether the seed exercised an untested v1 quirk.\n")
			}
			if b.RawV1 != nil && b.RawV2 != nil {
				m1, _ := json.Marshal(b.RawV1)
				m2, _ := json.Marshal(b.RawV2)
				const capN = 1500
				s1, s2 := string(m1), string(m2)
				if len(s1) > capN {
					s1 = s1[:capN] + "…"
				}
				if len(s2) > capN {
					s2 = s2[:capN] + "…"
				}
				fmt.Fprintf(&sb, "\n<details><summary>raw payloads</summary>\n\nv1:\n\n```json\n%s\n```\n\nv2:\n\n```json\n%s\n```\n\n</details>\n\n", s1, s2)
			} else {
				sb.WriteString("\n")
			}
		}
	}

	writeBlockerSummary(&sb, blockers)

	sb.WriteString("## Performance smoke (informational)\n\n")
	if perfSmoke != nil {
		fmt.Fprintf(&sb, "Sequential fetch of %d song details over %d songs:\n\n", perfSmoke.Requests, perfSmoke.SongCount)
		fmt.Fprintf(&sb, "| Server | Wall time | Per request |\n|---|---|---|\n")
		fmt.Fprintf(&sb, "| v1 (Node/TS) | %s | %s |\n", perfSmoke.V1Wall, perfSmoke.V1PerRequest)
		fmt.Fprintf(&sb, "| v2 (Go) | %s | %s |\n", perfSmoke.V2Wall, perfSmoke.V2PerRequest)
		fmt.Fprintf(&sb, "\nv2/v1 wall-time ratio: **%.2fx**.\n\n", perfSmoke.V2OverV1)
	} else {
		sb.WriteString("Not run.\n\n")
	}

	sb.WriteString("## Environment notes\n\n")
	fmt.Fprintf(&sb, "- v1: main checkout `packages/server` via `pnpm exec tsx src/index.ts`, temp DATA_DIR, scan/ingest/artist-image intervals 0\n")
	fmt.Fprintf(&sb, "- v2: `go build ./cmd/sonarly` binary, `SONARLY_SCAN_INTERVAL_MINUTES=0` (boot scan still runs once, read-only re: files)\n")
	sb.WriteString("- Native bookmarks: v1 has no native bookmark routes (only `/rest/*`); bookmark parity is covered under OpenSubsonic, v2's native `/api/bookmarks` is an addition, not a delta\n")
	sb.WriteString("- Seed tag writes go through `internal/audio.MutagenWriter` (python3+mutagen, the production path); the one embedded-art file gets its APIC frame via the same mechanism\n")

	path := filepath.Join("..", "..", "docs", "v2-p10-parity-report.md")
	if err := os.WriteFile(path, []byte(sb.String()), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "p10 report:", err)
	}
	logf("report written to %s", path)
}
