package testdualrun

// P10b verification phases: reconciliation assertions, the pristine-vs-v2
// catalog diff with per-row classification, real-data serving verification
// (native + OpenSubsonic), a transcode smoke, and a proof the library
// directory was untouched.

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Phase 1: reconciliation assertions.
// ---------------------------------------------------------------------------

func TestScanReconciliation(t *testing.T) {
	s := env.scan
	if s.Stats.Failed != 0 {
		t.Fatalf("scan recorded %d failed files: %v", s.Stats.Failed, s.Failures)
	}
	if len(s.Failures) > 0 {
		t.Fatalf("scan recorded %d failures (cap-limited list): %+v", len(s.Failures), s.Failures)
	}

	onDisk := len(env.onDisk)
	if onDisk == 0 {
		t.Fatal("library walk found no audio files — nothing to reconcile")
	}

	// Classify the pre-scan active catalog by file existence from the DB's
	// own path perspective (the production rows carry the v1 container
	// prefix /media/music, which does not exist on the host).
	pdb, err := openCopy(env.pristine)
	if err != nil {
		t.Fatal(err)
	}
	defer pdb.Close()
	var activePaths []string
	rows, err := pdb.Query(`SELECT file_path FROM songs WHERE active = 1`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			t.Fatal(err)
		}
		activePaths = append(activePaths, p)
	}
	rows.Close()
	present, missing := 0, 0
	for _, p := range activePaths {
		if _, err := os.Stat(p); err == nil {
			present++
		} else {
			missing++
		}
	}
	reconFacts = append(reconFacts,
		fmt.Sprintf("pre-scan active=%d; of those, files present on disk=%d, missing=%d", len(activePaths), present, missing),
		fmt.Sprintf("scan stats: scanned=%d added=%d updated=%d removed=%d moved=%d failed=%d",
			s.Stats.Scanned, s.Stats.Added, s.Stats.Updated, s.Stats.Removed, s.Stats.Moved, s.Stats.Failed),
		fmt.Sprintf("scan wall clock (boot -> observed completed): %s (%.1f MB hashed on disk)",
			s.WallClock.Round(time.Millisecond), float64(totalLibraryBytes())/1e6),
		fmt.Sprintf("scan job window: started_at=%s finished_at=%s", s.JobStartedAt, s.JobFinishedAt),
	)

	// Every pre-existing active row whose file vanished must be accounted
	// for by a remove or a move (move = the same audio content re-detected
	// under its new path via checksum). On-disk files land either at an
	// existing DB path (matched/updated) or as adds/moves.
	if s.Stats.Added+s.Stats.Moved > s.Stats.Scanned {
		t.Errorf("added(%d)+moved(%d) exceed scanned(%d)", s.Stats.Added, s.Stats.Moved, s.Stats.Scanned)
	}
	if s.Stats.Removed+s.Stats.Moved != missing {
		t.Errorf("removed(%d)+moved(%d) = %d, want pre-active missing-file count %d", s.Stats.Removed, s.Stats.Moved, s.Stats.Removed+s.Stats.Moved, missing)
	}
	if s.Stats.Scanned != onDisk {
		t.Errorf("scanned=%d, want %d", s.Stats.Scanned, onDisk)
	}

	vdb, err := openCopy(env.v2DB)
	if err != nil {
		t.Fatal(err)
	}
	defer vdb.Close()
	var postActive, postInactive, postTotal int
	if err := vdb.QueryRow(`SELECT COUNT(1) FROM songs WHERE active=1`).Scan(&postActive); err != nil {
		t.Fatal(err)
	}
	if err := vdb.QueryRow(`SELECT COUNT(1) FROM songs WHERE active=0`).Scan(&postInactive); err != nil {
		t.Fatal(err)
	}
	if err := vdb.QueryRow(`SELECT COUNT(1) FROM songs`).Scan(&postTotal); err != nil {
		t.Fatal(err)
	}
	reconFacts = append(reconFacts,
		fmt.Sprintf("post-scan: active=%d inactive=%d total=%d", postActive, postInactive, postTotal))
	if want := present + s.Stats.Added + s.Stats.Moved; postActive != want {
		t.Errorf("post-scan active=%d, want present(%d)+added(%d)+moved(%d)=%d", postActive, present, s.Stats.Added, s.Stats.Moved, want)
	}
	if want := env.baseline.Counts["songs"] + s.Stats.Added; postTotal != want {
		t.Errorf("post-scan total songs=%d, want baseline(%d)+added(%d)=%d — rows must never vanish", postTotal, env.baseline.Counts["songs"], s.Stats.Added, want)
	}
}

func totalLibraryBytes() int64 {
	var n int64
	for _, f := range env.onDisk {
		n += f.Size
	}
	return n
}

var reconFacts []string

// ---------------------------------------------------------------------------
// Phase 2: catalog diff vs. the pristine snapshot copy.
// ---------------------------------------------------------------------------

type tableDiff struct {
	Name    string
	CountA  int // pristine
	CountB  int // v2-processed
	Added   []string
	Removed []string
	Changed []string

	// Classification outcome.
	OK       bool
	Findings []string
	Summary  string // classified bucket counts, e.g. "7421 deactivated (file missing)"
}

var diffResults []*tableDiff

// diffKind picks the classifier for a table.
type diffKind int

const (
	kindSongs diffKind = iota
	kindActivity // albums/artists/genres/labels: activity-flag flips only, inserts reported
	kindSongJunction
	kindAlbumJunction
	kindFrozen // user state / playlists / history: must be byte-identical
	kindUserLibraries
	kindCoverArts
)

var diffPlan = []struct {
	table string
	kind  diffKind
}{
	{"songs", kindSongs},
	{"albums", kindActivity},
	{"artists", kindActivity},
	{"genres", kindActivity},
	{"labels", kindActivity},
	{"song_artists", kindSongJunction},
	{"song_genres", kindSongJunction},
	{"song_composers", kindSongJunction},
	{"album_artists", kindAlbumJunction},
	{"album_genres", kindAlbumJunction},
	{"album_labels", kindAlbumJunction},
	{"playlists", kindFrozen},
	{"playlist_songs", kindFrozen},
	{"playlist_shares", kindFrozen},
	{"user_songs", kindFrozen},
	{"user_albums", kindFrozen},
	{"user_artists", kindFrozen},
	{"user_playlists", kindFrozen},
	{"listening_history", kindFrozen},
	{"bookmarks", kindFrozen},
	{"user_libraries", kindUserLibraries},
	{"cover_arts", kindCoverArts},
}

// volatile columns: scan-refreshed values excluded from the STRICT row hash.
// They are still compared per changed row and reported, just not asserted.
var volatileCols = map[string]bool{"mtime": true, "checksum": true}

func TestCatalogDiff(t *testing.T) {
	t0 := time.Now()
	a, err := openCopy(env.pristine)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	// The v2 copy is read LIVE: the server is quiescent between the scan and
	// the serving phases (watch poll 1h, all schedulers 0), so a WAL read
	// snapshot is the post-scan state.
	b, err := openCopy(env.v2DB)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()

	diffArtifacts = filepath.Join(env.tmp, "diff-artifacts")
	_ = os.MkdirAll(diffArtifacts, 0o755)

	var addedSongIDs, movedSongIDs map[string]bool
	songsTouched := map[string]bool{} // added ∪ moved ∪ re-persisted (junction rewrites are v1-parity on every persist)
	for _, planned := range diffPlan {
		td := &tableDiff{Name: planned.table}
		diffResults = append(diffResults, td)
		rowsA, colsA, err := loadTable(a, planned.table)
		if err != nil {
			t.Fatalf("pristine %s: %v", planned.table, err)
		}
		rowsB, _, err := loadTable(b, planned.table)
		if err != nil {
			t.Fatalf("v2 %s: %v", planned.table, err)
		}
		td.CountA, td.CountB = len(rowsA), len(rowsB)
		for k := range rowsB {
			if _, ok := rowsA[k]; !ok {
				td.Added = append(td.Added, k)
			}
		}
		for k := range rowsA {
			if _, ok := rowsB[k]; !ok {
				td.Removed = append(td.Removed, k)
			} else if rowHash(colsA, rowsA[k], volatileColsFor(planned.table)) != rowHash(colsA, rowsB[k], volatileColsFor(planned.table)) {
				td.Changed = append(td.Changed, k)
			}
		}
		sort.Strings(td.Added)
		sort.Strings(td.Removed)
		sort.Strings(td.Changed)
		writeArtifact(td)

		switch planned.kind {
		case kindSongs:
			addedSongIDs, movedSongIDs = classifySongs(t, td, rowsA, rowsB, colsA)
			for _, k := range td.Changed {
				songsTouched[k] = true
			}
			for k := range addedSongIDs {
				songsTouched[k] = true
			}
			for k := range movedSongIDs {
				songsTouched[k] = true
			}
		case kindActivity:
			classifyActivity(t, td, rowsA, rowsB)
		case kindSongJunction:
			classifySongJunction(t, td, songsTouched)
		case kindAlbumJunction:
			classifyAlbumJunction(t, td, songsTouched)
		case kindFrozen:
			if len(td.Added)+len(td.Removed)+len(td.Changed) > 0 {
				td.Findings = append(td.Findings,
					fmt.Sprintf("frozen table changed: +%d -%d ~%d (sample added=%v removed=%v changed=%v)",
						len(td.Added), len(td.Removed), len(td.Changed), sample(td.Added), sample(td.Removed), sample(td.Changed)))
			}
		case kindUserLibraries:
			// The only legitimate write is the test admin's own assignment.
			for _, k := range td.Added {
				if !strings.HasPrefix(k, adminUID+"\x1f") {
					td.Findings = append(td.Findings, "user_libraries row for unexpected user: "+k)
				}
			}
			for _, k := range td.Removed {
				td.Findings = append(td.Findings, "user_libraries row removed: "+k)
			}
			for _, k := range td.Changed {
				td.Findings = append(td.Findings, "user_libraries row changed: "+k)
			}
			td.Summary = fmt.Sprintf("test-admin assignment +%d", len(td.Added))
		case kindCoverArts:
			if len(td.Removed)+len(td.Changed) > 0 {
				td.Findings = append(td.Findings,
					fmt.Sprintf("cover_arts removed/changed: -%d ~%d", len(td.Removed), len(td.Changed)))
			}
			td.Summary = fmt.Sprintf("+%d art blobs (persisted by the scan for on-disk files)", len(td.Added))
		}

		td.OK = len(td.Findings) == 0
		if !td.OK {
			t.Errorf("diff %s: %d findings: %s", td.Name, len(td.Findings), strings.Join(td.Findings, " | "))
		}
	}
	diffDuration = time.Since(t0)
	logf("catalog diff done in %s", diffDuration.Round(time.Millisecond))
}

var (
	diffArtifacts string
	diffDuration  time.Duration
)

func volatileColsFor(table string) map[string]bool {
	if table == "songs" {
		return volatileCols
	}
	return nil
}

// loadTable reads every row keyed by its primary-key columns (or rowid).
func loadTable(db *sql.DB, table string) (map[string]map[string]any, []string, error) {
	sel := "*"
	pk, err := pkColumns(db, table)
	if err != nil {
		return nil, nil, err
	}
	if len(pk) == 0 {
		sel = "rowid AS __rowid__, *"
	}
	rows, err := db.Query(`SELECT ` + sel + ` FROM ` + table)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	useRowid := len(pk) == 0
	out := map[string]map[string]any{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		row := map[string]any{}
		for i, c := range cols {
			row[c] = normalize(vals[i])
		}
		keyParts := make([]string, 0, len(pk))
		if useRowid {
			keyParts = append(keyParts, fmt.Sprintf("%v", row["__rowid__"]))
		} else {
			for _, c := range pk {
				keyParts = append(keyParts, encodeValue(row[c]))
			}
		}
		out[strings.Join(keyParts, "\x1f")] = row
	}
	return out, cols, rows.Err()
}

func pkColumns(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func normalize(v any) any {
	switch t := v.(type) {
	case []byte:
		return string(t)
	default:
		return v
	}
}

func encodeValue(v any) string {
	switch t := v.(type) {
	case nil:
		return "<NULL>"
	case string:
		return t
	case int64:
		return strconv.FormatInt(t, 10)
	case float64:
		return strconv.FormatFloat(t, 'g', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func rowHash(cols []string, row map[string]any, volatile map[string]bool) string {
	var sb strings.Builder
	for _, c := range cols {
		if volatile[c] {
			continue
		}
		sb.WriteString(c)
		sb.WriteByte(0)
		sb.WriteString(encodeValue(row[c]))
		sb.WriteByte(0)
	}
	sum := sha256.Sum256([]byte(sb.String()))
	return hex.EncodeToString(sum[:])
}

func sample(keys []string) []string {
	if len(keys) == 0 {
		return nil
	}
	n := min(len(keys), 5)
	return keys[:n]
}

func writeArtifact(td *tableDiff) {
	var sb strings.Builder
	fmt.Fprintf(&sb, "table=%s pristine=%d v2=%d added=%d removed=%d changed=%d\n", td.Name, td.CountA, td.CountB, len(td.Added), len(td.Removed), len(td.Changed))
	for _, k := range td.Added {
		fmt.Fprintf(&sb, "added\t%s\n", k)
	}
	for _, k := range td.Removed {
		fmt.Fprintf(&sb, "removed\t%s\n", k)
	}
	for _, k := range td.Changed {
		fmt.Fprintf(&sb, "changed\t%s\n", k)
	}
	_ = os.WriteFile(filepath.Join(diffArtifacts, td.Name+".txt"), []byte(sb.String()), 0o644)
}

// classifySongs is the strict per-row audit of the reconciliation. Allowed
// changes on pre-existing rows:
//   - activity flips tied to file existence (deactivation / reactivation)
//   - file_path rewrites that are provable moves (old path gone, new
//     path present)
//   - scan-refreshed mtime/checksum values
//   - documented re-persist deltas: duration float→integer truncation
//     (SPEC-duration-integer-seconds, accepted by the P10 parity suite) and
//     erasure-to-NULL of absent-tag columns (v1-parity full-replace scan
//     semantics — v1's persistSong without options replaces wholesale too;
//     legacy navidrome-era values like "" or fractional bit_rate normalize
//     to NULL). Every documented transition is counted per column; any
//     other column change is a finding.
func classifySongs(t *testing.T, td *tableDiff, rowsA, rowsB map[string]map[string]any, cols []string) (added, moved map[string]bool) {
	added, moved = map[string]bool{}, map[string]bool{}
	deactivated, reactivated, movedCnt, volatileTouch := 0, 0, 0, 0
	documented := map[string]int{}
	for _, k := range td.Changed {
		a, b := rowsA[k], rowsB[k]
		var changed []string
		for _, c := range cols {
			if encodeValue(a[c]) != encodeValue(b[c]) {
				changed = append(changed, c)
			}
		}
		bad := false
		for _, c := range changed {
			switch {
			case c == "active" || c == "file_path" || c == "mtime" || c == "checksum":
			case c == "duration":
				if !durationTruncatesTo(a["duration"], b["duration"]) {
					td.Findings = append(td.Findings, fmt.Sprintf("song %s: duration changed outside int-truncation (%q -> %q)", k, encodeValue(a[c]), encodeValue(b[c])))
					bad = true
				} else {
					documented["duration float->int"]++
				}
			case erasureOK[c]:
				if !nullish(b[c]) {
					td.Findings = append(td.Findings, fmt.Sprintf("song %s: %s changed to a DIFFERENT non-null value (%q -> %q)", k, c, encodeValue(a[c]), encodeValue(b[c])))
					bad = true
				} else {
					documented[c+" ->NULL"]++
				}
			default:
				td.Findings = append(td.Findings, fmt.Sprintf("song %s: unexpected column change %s (%q -> %q)", k, c, encodeValue(a[c]), encodeValue(b[c])))
				bad = true
			}
		}
		if bad {
			continue
		}
		oldPath := encodeValue(a["file_path"])
		newPath := encodeValue(b["file_path"])
		if encodeValue(a["active"]) != encodeValue(b["active"]) {
			av, bv := encodeValue(a["active"]), encodeValue(b["active"])
			exists := fileExists(newPath)
			switch {
			case av == "1" && bv == "0" && !exists:
				deactivated++
			case av == "0" && bv == "1" && exists:
				reactivated++
			default:
				td.Findings = append(td.Findings, fmt.Sprintf("song %s: activity flip %s->%s with file-exists=%v (path %s)", k, av, bv, exists, newPath))
			}
		}
		if oldPath != newPath {
			if !fileExists(oldPath) && fileExists(newPath) {
				moved[k] = true
				movedCnt++
			} else {
				td.Findings = append(td.Findings, fmt.Sprintf("song %s: path rewrite is not a provable move: old=%q(exists=%v) new=%q(exists=%v)", k, oldPath, fileExists(oldPath), newPath, fileExists(newPath)))
			}
		}
		for _, c := range changed {
			if c == "mtime" || c == "checksum" {
				volatileTouch++
			}
		}
	}
	for _, k := range td.Added {
		p := encodeValue(rowsB[k]["file_path"])
		if fileExists(p) {
			added[k] = true
		} else {
			td.Findings = append(td.Findings, "added song whose file does not exist on disk: "+k+" path="+p)
		}
	}
	for _, k := range td.Removed {
		td.Findings = append(td.Findings, "song row vanished (soft-delete violation): "+k)
	}
	docParts := make([]string, 0, len(documented))
	for k, n := range documented {
		docParts = append(docParts, fmt.Sprintf("%s x%d", k, n))
	}
	sort.Strings(docParts)
	td.Summary = fmt.Sprintf("deactivated(missing file)=%d reactivated=%d moved=%d mtime/checksum refreshes=%d added=%d documented re-persist deltas: %s",
		deactivated, reactivated, movedCnt, volatileTouch, len(added), strings.Join(docParts, ", "))
	return added, moved
}

// durationTruncatesTo reports whether the new duration is the old
// fractional duration normalized to integer seconds (v2's integer-seconds
// spec: rounded to nearest, so any genuine metadata change of less than a
// whole second still lands on an adjacent integer — accept |Δ| < 1 with an
// integral new value; anything else is a real change).
func durationTruncatesTo(a, b any) bool {
	fa, errA := strconv.ParseFloat(strings.TrimSpace(encodeValue(a)), 64)
	fb, errB := strconv.ParseFloat(strings.TrimSpace(encodeValue(b)), 64)
	if errA != nil || errB != nil {
		return false
	}
	return math.Abs(fa-fb) < 1.0 && fb == math.Trunc(fb)
}

// nullish reports whether a value was erased (NULL or empty string).
func nullish(v any) bool {
	s := encodeValue(v)
	return s == "<NULL>" || s == ""
}

// erasureOK columns may transition any-value -> NULL/"" on a re-persist
// (absent tag under v1-parity full-replace scan semantics). Counted and
// reported, never silent.
var erasureOK = map[string]bool{
	"bit_rate": true, "bits_per_sample": true, "sample_rate": true, "channels": true,
	"bpm": true, "replay_gain": true,
	"music_brainz_id": true, "musicbrainz_track_id": true, "musicbrainz_work_id": true, "musicbrainz_disc_id": true,
	"comment": true, "sort_name": true, "mood": true, "media_type": true,
	"original_release_date": true, "release_date": true, "remix_of": true,
	"display_artist": true, "display_album_artist": true,
	"lyrics": true, "synced_lyrics": true, "producers": true, "isrcs": true,
	"original_year": true, "original_artist": true, "gapless": true,
	"total_tracks": true, "total_discs": true,
}

func classifyActivity(t *testing.T, td *tableDiff, rowsA, rowsB map[string]map[string]any) {
	flips := 0
	for _, k := range td.Changed {
		a, b := rowsA[k], rowsB[k]
		for c := range a {
			if c == "active" {
				continue
			}
			if encodeValue(a[c]) != encodeValue(b[c]) {
				td.Findings = append(td.Findings, fmt.Sprintf("%s %s: non-activity column %s changed (%q -> %q)", td.Name, k, c, encodeValue(a[c]), encodeValue(b[c])))
			}
		}
		flips++
	}
	for _, k := range td.Removed {
		td.Findings = append(td.Findings, td.Name+" row removed: "+k)
	}
	td.Summary = fmt.Sprintf("activity-flag recomputes=%d, new rows=%d (linked to the on-disk album/artists)", flips, len(td.Added))
	if len(td.Added) > 0 {
		names := make([]string, 0, len(td.Added))
		for _, k := range td.Added {
			if n, ok := rowsB[k]["name"]; ok {
				names = append(names, encodeValue(n))
			} else {
				names = append(names, k)
			}
		}
		sort.Strings(names)
		td.Summary += ": " + strings.Join(sample(names), ", ")
		if len(names) > 5 {
			td.Summary += fmt.Sprintf(" (+%d more)", len(names)-5)
		}
	}
}

func classifySongJunction(t *testing.T, td *tableDiff, touched map[string]bool) {
	bad := 0
	for _, k := range td.Added {
		songID := strings.SplitN(k, "\x1f", 2)[0]
		if !touched[songID] {
			td.Findings = append(td.Findings, fmt.Sprintf("%s row for song that was not added/moved/re-persisted: %q", td.Name, k))
			bad++
		}
	}
	for _, k := range td.Removed {
		td.Findings = append(td.Findings, td.Name+" row removed: "+k)
	}
	for _, k := range td.Changed {
		td.Findings = append(td.Findings, td.Name+" row changed: "+k)
	}
	td.Summary = fmt.Sprintf("+%d rows for added/moved songs, findings=%d", len(td.Added)-bad, bad)
}

func classifyAlbumJunction(t *testing.T, td *tableDiff, touched map[string]bool) {
	// Legitimate inserts reference albums that gained songs this scan (or
	// albums whose own row changed/was inserted); anything else is a
	// finding. Deletions/changes are findings.
	affected := affectedAlbums(t, touched)
	for _, d := range diffResults {
		if d.Name == "albums" {
			for _, k := range d.Changed {
				affected[k] = true
			}
			for _, k := range d.Added {
				affected[k] = true
			}
		}
	}
	for _, k := range td.Added {
		albumID := strings.SplitN(k, "\x1f", 2)[0]
		if !affected[albumID] {
			td.Findings = append(td.Findings, fmt.Sprintf("%s row for unaffected album: %q", td.Name, k))
		}
	}
	for _, k := range td.Removed {
		td.Findings = append(td.Findings, td.Name+" row removed: "+k)
	}
	for _, k := range td.Changed {
		td.Findings = append(td.Findings, td.Name+" row changed: "+k)
	}
	td.Summary = fmt.Sprintf("+%d rows tied to affected albums", len(td.Added))
}

// affectedAlbums resolves the distinct album_ids of the touched songs —
// the albums that legitimately gained junction rows this scan.
func affectedAlbums(t *testing.T, touched map[string]bool) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	ids := make([]string, 0, len(touched))
	for id := range touched {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return out
	}
	vdb, err := openCopy(env.v2DB)
	if err != nil {
		t.Fatal(err)
	}
	defer vdb.Close()
	const chunk = 400
	for start := 0; start < len(ids); start += chunk {
		end := min(start+chunk, len(ids))
		placeholders := strings.TrimSuffix(strings.Repeat("?,", end-start), ",")
		rows, err := vdb.Query(`SELECT DISTINCT album_id FROM songs WHERE album_id IS NOT NULL AND id IN (`+placeholders+`)`,
			strListToAny(ids[start:end])...)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			out[id] = true
		}
		rows.Close()
	}
	return out
}

func strListToAny(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// ---------------------------------------------------------------------------
// Phase 3+4: serving verification on real data.
// ---------------------------------------------------------------------------

type songPick struct {
	ID        string
	Title     string
	Path      string
	Ext       string
	Size      int64
	Explicit  bool
	CoverID   string
	AlbumID   string
	Duration  int
	FileSHA   string
}

type songResult struct {
	Pick         songPick
	APIDetail    string
	CoverBytes   int
	CoverSHA     string
	StreamSHA    string
	RangeStatus  int
	RangeOK      bool
	RestStream   string
	RestCoverOK  bool
	StreamMismatch bool
}

var (
	picks   []songPick
	results []songResult
)

// pickSongs chooses five active songs maximizing coverage: formats first
// (mp3/flac/ogg/m4a), then explicit + embedded art, then album diversity,
// then duration spread. The production library on disk may not contain all
// formats — coverage actually achieved is recorded in the report.
func pickSongs(t *testing.T) []songPick {
	if picks != nil {
		return picks
	}
	vdb, err := openCopy(env.v2DB)
	if err != nil {
		t.Fatal(err)
	}
	defer vdb.Close()
	rows, err := vdb.Query(`SELECT id, file_path, title, explicit, COALESCE(cover_art_id,''), COALESCE(album_id,''), COALESCE(duration,0)
		FROM songs WHERE active = 1`)
	if err != nil {
		t.Fatal(err)
	}
	type cand struct {
		songPick
		hasArt bool
	}
	var cands []cand
	for rows.Next() {
		var c cand
		var explicit int
		var dur float64
		if err := rows.Scan(&c.ID, &c.Path, &c.Title, &explicit, &c.CoverID, &c.AlbumID, &dur); err != nil {
			t.Fatal(err)
		}
		c.Duration = int(dur + 0.5)
		c.Explicit = explicit == 1
		c.hasArt = c.CoverID != ""
		c.Ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(c.Path), "."))
		fi, err := os.Stat(c.Path)
		if err != nil {
			continue // active row whose file is unreadable — skip (diff phase owns that check)
		}
		c.Size = fi.Size()
		cands = append(cands, c)
	}
	rows.Close()
	if len(cands) == 0 {
		t.Fatal("no streamable songs after the scan")
	}

	taken := map[string]bool{}
	take := func(pred func(cand) bool) *cand {
		for i := range cands {
			if !taken[cands[i].ID] && pred(cands[i]) {
				taken[cands[i].ID] = true
				c := cands[i]
				return &c
			}
		}
		return nil
	}
	want := []string{"mp3", "flac", "ogg", "m4a"}
	seenExt := map[string]bool{}
	// Round 1: one per format, preferring explicit+art, then art.
	for _, ext := range want {
		if c := take(func(c cand) bool { return c.Ext == ext && c.Explicit && c.hasArt }); c != nil {
			picks = append(picks, c.songPick)
			seenExt[c.Ext] = true
			continue
		}
		if c := take(func(c cand) bool { return c.Ext == ext && c.hasArt }); c != nil {
			picks = append(picks, c.songPick)
			seenExt[c.Ext] = true
			continue
		}
		if c := take(func(c cand) bool { return c.Ext == ext }); c != nil {
			picks = append(picks, c.songPick)
			seenExt[c.Ext] = true
		}
	}
	// Round 2: explicit+art and art coverage in whatever format exists.
	if c := take(func(c cand) bool { return c.Explicit && c.hasArt }); c != nil {
		picks = append(picks, c.songPick)
	}
	if c := take(func(c cand) bool { return c.hasArt }); c != nil {
		picks = append(picks, c.songPick)
	}
	// Round 3: duration extremes.
	best, worst := -1, -1
	for i := range cands {
		if taken[cands[i].ID] {
			continue
		}
		if best == -1 || cands[i].Duration > cands[best].Duration {
			best = i
		}
		if worst == -1 || cands[i].Duration < cands[worst].Duration {
			worst = i
		}
	}
	if best >= 0 && len(picks) < 5 {
		taken[cands[best].ID] = true
		picks = append(picks, cands[best].songPick)
	}
	if worst >= 0 && !taken[cands[worst].ID] && len(picks) < 5 {
		taken[cands[worst].ID] = true
		picks = append(picks, cands[worst].songPick)
	}
	// Fill up to five.
	for i := range cands {
		if len(picks) >= 5 {
			break
		}
		if !taken[cands[i].ID] {
			taken[cands[i].ID] = true
			picks = append(picks, cands[i].songPick)
		}
	}
	if len(picks) > 5 {
		picks = picks[:5]
	}

	var cov []string
	for _, p := range picks {
		cov = append(cov, fmt.Sprintf("%s[%s]cover=%v explicit=%v", p.Title, p.Ext, p.CoverID != "", p.Explicit))
	}
	servingFacts = append(servingFacts,
		fmt.Sprintf("picked %d songs covering formats actually present on disk: %s", len(picks), strings.Join(cov, "; ")))

	for i := range picks {
		data, err := os.ReadFile(picks[i].Path)
		if err != nil {
			t.Fatalf("read %s: %v", picks[i].Path, err)
		}
		sum := sha256.Sum256(data)
		picks[i].FileSHA = hex.EncodeToString(sum[:])
	}
	return picks
}

var servingFacts []string

func TestServingDirect(t *testing.T) {
	for _, p := range pickSongs(t) {
		res := songResult{Pick: p}

		cap, err := apiClient.do("GET", "/api/songs/"+p.ID, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if cap.status != http.StatusOK {
			t.Errorf("GET /api/songs/%s: status %d", p.ID, cap.status)
			res.APIDetail = fmt.Sprintf("status %d", cap.status)
		} else {
			var song struct {
				Title string `json:"title"`
			}
			var wrapper struct {
				Song struct {
					Title string `json:"title"`
				} `json:"song"`
			}
			if err := json.Unmarshal(cap.body, &wrapper); err != nil {
				t.Errorf("song json: %v", err)
			} else if song.Title = wrapper.Song.Title; !strings.EqualFold(song.Title, p.Title) {
				t.Errorf("GET /api/songs/%s: title %q != DB %q", p.ID, song.Title, p.Title)
				res.APIDetail = "title mismatch"
			} else {
				res.APIDetail = "ok"
			}
		}

		if p.CoverID != "" {
			ccap, err := apiClient.do("GET", "/api/cover-art/"+p.CoverID, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			if ccap.status != http.StatusOK || len(ccap.body) == 0 {
				t.Errorf("GET /api/cover-art/%s: status %d, %d bytes", p.CoverID, ccap.status, len(ccap.body))
			} else if ct := ccap.header.Get("Content-Type"); !strings.HasPrefix(ct, "image/") {
				t.Errorf("cover-art content-type %q", ct)
			} else {
				sum := sha256.Sum256(ccap.body)
				res.CoverSHA = hex.EncodeToString(sum[:])
				res.CoverBytes = len(ccap.body)
			}
		}

		scap, err := apiClient.do("GET", "/api/stream/"+p.ID, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if scap.status != http.StatusOK {
			t.Fatalf("GET /api/stream/%s: status %d (RELEASE-BLOCKER candidate: direct stream must be 200)", p.ID, scap.status)
		}
		sum := sha256.Sum256(scap.body)
		res.StreamSHA = hex.EncodeToString(sum[:])
		if res.StreamSHA != p.FileSHA {
			res.StreamMismatch = true
			streamMismatches++
			t.Errorf("STREAM HASH MISMATCH (RELEASE BLOCKER) song %s (%s): v2 stream %s != file %s",
				p.ID, p.Path, res.StreamSHA, p.FileSHA)
		}

		rcap, err := apiClient.do("GET", "/api/stream/"+p.ID, nil, map[string]string{"Range": "bytes=0-65535"})
		if err != nil {
			t.Fatal(err)
		}
		res.RangeStatus = rcap.status
		fileHead, err := os.ReadFile(p.Path)
		if err != nil {
			t.Fatal(err)
		}
		head := fileHead
		if len(head) > 65536 {
			head = head[:65536]
		}
		if rcap.status != http.StatusPartialContent {
			t.Errorf("range request: status %d, want 206", rcap.status)
		} else if string(rcap.body) != string(head) {
			t.Errorf("range request: body %d bytes != file[0:%d]", len(rcap.body), len(head))
		} else {
			res.RangeOK = true
		}

		hcap, err := apiClient.do("HEAD", "/api/stream/"+p.ID, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if hcap.status != http.StatusOK {
			t.Errorf("HEAD /api/stream/%s: status %d", p.ID, hcap.status)
		}
		results = append(results, res)
	}
}

var streamMismatches int

func TestServingSubsonic(t *testing.T) {
	for i := range pickSongs(t) {
		p := &picks[i]
		res := &results[i]

		cap, err := apiClient.restGET("stream.view", map[string][]string{"id": {p.ID}}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if cap.status != http.StatusOK {
			t.Fatalf("/rest/stream.view?id=%s: status %d", p.ID, cap.status)
		}
		sum := sha256.Sum256(cap.body)
		got := hex.EncodeToString(sum[:])
		res.RestStream = got
		if got != p.FileSHA {
			streamMismatches++
			res.StreamMismatch = true
			t.Errorf("REST STREAM HASH MISMATCH (RELEASE BLOCKER) song %s: %s != file %s", p.ID, got, p.FileSHA)
		}

		if p.CoverID != "" {
			ccap, err := apiClient.restGET("getCoverArt.view", map[string][]string{"id": {p.CoverID}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if ccap.status != http.StatusOK || len(ccap.body) == 0 {
				t.Errorf("/rest/getCoverArt.view?id=%s: status %d, %d bytes", p.CoverID, ccap.status, len(ccap.body))
			} else {
				sum := sha256.Sum256(ccap.body)
				if hex.EncodeToString(sum[:]) != res.CoverSHA {
					t.Errorf("/rest/getCoverArt bytes differ from /api/cover-art for %s", p.CoverID)
				} else {
					res.RestCoverOK = true
				}
			}
		}
	}

	// If the on-disk album carries no art of its own, still exercise the
	// cover-art byte path against a real historical blob (album-level art
	// from the pre-existing catalog).
	if picks[0].CoverID == "" {
		vdb, err := openCopy(env.v2DB)
		if err != nil {
			t.Fatal(err)
		}
		var artID string
		err = vdb.QueryRow(`SELECT id FROM cover_arts ORDER BY RANDOM() LIMIT 1`).Scan(&artID)
		vdb.Close()
		if err != nil {
			t.Fatalf("cover_arts lookup: %v", err)
		}
		ccap, err := apiClient.do("GET", "/api/cover-art/"+artID, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		rcap, err := apiClient.restGET("getCoverArt.view", map[string][]string{"id": {artID}}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if ccap.status != http.StatusOK || len(ccap.body) == 0 {
			t.Errorf("historical cover-art %s: status %d, %d bytes", artID, ccap.status, len(ccap.body))
		} else if !strings.HasPrefix(ccap.header.Get("Content-Type"), "image/") {
			t.Errorf("historical cover-art content-type %q", ccap.header.Get("Content-Type"))
		} else if rcap.status != http.StatusOK || string(rcap.body) != string(ccap.body) {
			t.Errorf("rest getCoverArt differs from native for historical blob %s", artID)
		} else {
			sum := sha256.Sum256(ccap.body)
			servingFacts = append(servingFacts,
				fmt.Sprintf("historical cover blob %s: %d bytes (%s…), native == /rest getCoverArt", artID, len(ccap.body), hex.EncodeToString(sum[:])[:12]))
		}
	}

	// search3 + getAlbum on real metadata.
	p0 := picks[0]
	term := firstSearchTerm(p0.Title)
	cap, err := apiClient.restGET("search3.view", map[string][]string{"query": {term}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	found := subsonicSongIDs(t, cap, "searchResult3")
	if !found[p0.ID] {
		t.Errorf("search3 %q: picked song %s not in results (got %d songs)", term, p0.ID, len(found))
	} else {
		servingFacts = append(servingFacts, fmt.Sprintf("search3 %q returned the picked song %q", term, p0.Title))
	}

	albumCap, err := apiClient.restGET("getAlbum.view", map[string][]string{"id": {p0.AlbumID}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	name, ids := subsonicAlbum(t, albumCap)
	if name == "" {
		t.Errorf("getAlbum %s: empty album name", p0.AlbumID)
	} else {
		servingFacts = append(servingFacts, fmt.Sprintf("getAlbum %s -> %q (%d songs)", p0.AlbumID, name, len(ids)))
		if !ids[p0.ID] {
			t.Errorf("getAlbum %s: picked song missing from track list", p0.AlbumID)
		}
	}
}

func firstSearchTerm(title string) string {
	for _, w := range strings.Fields(title) {
		w = strings.Trim(w, "()[]{}.-'\"")
		if len(w) >= 3 {
			return w
		}
	}
	return title
}

func subsonicRoot(t *testing.T, cap *capture) map[string]any {
	t.Helper()
	if cap.status != http.StatusOK {
		t.Fatalf("subsonic call: status %d: %s", cap.status, cap.body)
	}
	var env map[string]any
	if err := json.Unmarshal(cap.body, &env); err != nil {
		t.Fatalf("subsonic envelope: %v", err)
	}
	root, ok := env["subsonic-response"].(map[string]any)
	if !ok {
		t.Fatalf("no subsonic-response in %s", cap.body)
	}
	if st, _ := root["status"].(string); st != "ok" {
		t.Fatalf("subsonic error envelope: %s", cap.body)
	}
	return root
}

func subsonicSongIDs(t *testing.T, cap *capture, listKey string) map[string]bool {
	t.Helper()
	root := subsonicRoot(t, cap)
	out := map[string]bool{}
	list, ok := root[listKey].(map[string]any)
	if !ok {
		return out
	}
	songs, _ := list["song"].([]any)
	for _, s := range songs {
		if m, ok := s.(map[string]any); ok {
			if id, ok := m["id"].(string); ok {
				out[id] = true
			}
		}
	}
	return out
}

func subsonicAlbum(t *testing.T, cap *capture) (string, map[string]bool) {
	t.Helper()
	root := subsonicRoot(t, cap)
	album, _ := root["album"].(map[string]any)
	name, _ := album["name"].(string)
	ids := map[string]bool{}
	songs, _ := album["song"].([]any)
	for _, s := range songs {
		if m, ok := s.(map[string]any); ok {
			if id, ok := m["id"].(string); ok {
				ids[id] = true
			}
		}
	}
	return name, ids
}

// ---------------------------------------------------------------------------
// Phase 5: transcode smoke + library read-only proof.
// ---------------------------------------------------------------------------

var transcodeFacts []string

func TestTranscodeSmoke(t *testing.T) {
	p := pickSongs(t)[0]
	t0 := time.Now()
	cap, err := apiClient.do("GET", "/api/stream/"+p.ID+"?maxBitRate=128", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	d := time.Since(t0).Round(time.Millisecond)
	if cap.status != http.StatusOK {
		t.Fatalf("transcode stream: status %d", cap.status)
	}
	ct := cap.header.Get("Content-Type")
	if ct != "audio/mpeg" {
		t.Errorf("transcode content-type %q, want audio/mpeg", ct)
	}
	if len(cap.body) == 0 {
		t.Fatal("transcode produced no bytes")
	}
	sum := sha256.Sum256(cap.body)
	got := hex.EncodeToString(sum[:])
	if got == p.FileSHA {
		t.Error("transcode output equals the source file bytes — transcoding did not happen")
	}
	transcodeFacts = append(transcodeFacts,
		fmt.Sprintf("GET /api/stream/%s?maxBitRate=128 -> %d, %d bytes in %s (vs direct %d bytes), sha256 %s",
			p.ID, cap.status, len(cap.body), d, p.Size, got))
}

var libUntouched []string

func TestLibraryUntouched(t *testing.T) {
	bad := 0
	for _, f := range env.onDisk {
		fi, err := os.Stat(f.Path)
		if err != nil {
			t.Errorf("stat %s: %v", f.Path, err)
			bad++
			continue
		}
		if fi.Size() != f.Size || !fi.ModTime().Equal(f.ModTime) {
			t.Errorf("library file changed on disk: %s", f.Path)
			bad++
		}
	}
	libUntouched = append(libUntouched,
		fmt.Sprintf("%d library files re-statted after the full dual-run: %d changed (size/mtime)", len(env.onDisk), bad))
	if bad > 0 {
		t.Errorf("%d library files were modified during the dual-run", bad)
	}
}
