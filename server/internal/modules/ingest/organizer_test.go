// Pattern rendering, sanitize, and move-collision tests: the organizer is
// pure given (pattern, tags, paths), so these are table-driven against the old
// documented behavior including its sharpest edges.
package ingest_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/ingest"
)

func meta(artist, album, title string, track, disc, year int, genre string) *audio.Metadata {
	return &audio.Metadata{
		Title:       title,
		Artist:      artist,
		Artists:     []string{artist},
		Album:       album,
		AlbumArtist: artist,
		TrackNo:     track,
		DiscNo:      disc,
		Year:        year,
		Genres:      []string{genre},
	}
}

func TestBuildTargetPathEveryToken(t *testing.T) {
	m := meta("The Artist", "The Album", "The Title", 3, 1, 2021, "Jazz")

	cases := []struct {
		pattern string
		want    string
	}{
		{"{artist}/x", "The Artist/x"},
		{"{albumArtist}/x", "The Artist/x"},
		{"{album}/x", "The Album/x"},
		{"{title}/x", "The Title/x"},
		{"{track}/x", "3/x"},
		{"{track:00}/x", "03/x"},
		{"{disc}/x", "1/x"},
		{"{disc:00}/x", "01/x"},
		{"{year}/x", "2021/x"},
		{"{genre}/x", "Jazz/x"},
		// the retired server default pattern composition.
		{"{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}",
			"The Artist/(2021) The Album/0103 - The Title"},
	}
	for _, tc := range cases {
		got := ingest.BuildTargetPath(tc.pattern, "/lib", m, "/src/file.mp3")
		want := filepath.Join("/lib", tc.want+".mp3")
		if got != want {
			t.Errorf("pattern %q:\n got %s\nwant %s", tc.pattern, got, want)
		}
	}
}

func TestBuildTargetPathAbsentValues(t *testing.T) {
	// Title carries the filename fallback ReadMetadata would have applied
	// (the old readMetadata ran before buildTargetPath saw the tags).
	m := &audio.Metadata{Title: "file"}

	cases := []struct {
		pattern string
		want    string
	}{
		// Unknown tokens expand to "" (old behavior), and an empty segment sanitizes
		// to "_" — the same outcome the retired server produced.
		{"{unknown}/{title}", "_/file"},
		// Absent track/disc/year: bare tokens and :00 variants all expand
		// to "", the empty segment sanitizes to "_".
		{"{track}{track:00}{disc}{disc:00}{year}", "_"},
		// Defaults the retired server filled in buildVariables.
		{"{artist}/{album}/{title}", "Unknown Artist/Unknown Album/file"},
	}
	for _, tc := range cases {
		got := ingest.BuildTargetPath(tc.pattern, "/lib", m, "/src/file.mp3")
		want := filepath.Join("/lib", tc.want+".mp3")
		if got != want {
			t.Errorf("pattern %q:\n got %s\nwant %s", tc.pattern, got, want)
		}
	}
}

func TestSanitize(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"AC/DC", "AC_DC"},                         // separator becomes underscore
		{`a\b:c*d?e"f<g>h|i`, "a_b_c_d_e_f_g_h_i"}, // Windows-forbidden set
		{"lots   of\t whitespace\n", "lots of whitespace"},
		{"...", ".."},    // exactly one trailing dot stripped
		{"foo.", "foo"},  // trailing dot
		{"foo. ", "foo"}, // trailing dot behind whitespace
		{".", "_"},       // lone dot → empty → "_"
		{"", "_"},        // empty → "_"
		{"  ", "_"},      // whitespace-only → "_"
		{"....", "..."},  // one dot only
		{"(2005) Album [live]", "(2005) Album [live]"}, // brackets are legal
	}
	for _, tc := range cases {
		if got := ingest.Sanitize(tc.in); got != tc.want {
			t.Errorf("Sanitize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestBuildTargetPathSanitizesSegments(t *testing.T) {
	m := meta(`AC/DC:Live "Bootleg"?`, "Al.bum...", "Song*", 3, 1, 2021, "J/az/z")
	got := ingest.BuildTargetPath("{albumArtist}/{album}/{title}", "/lib", m, "/src/song.mp3")
	// Forbidden characters become underscores (replaced, not stripped);
	// sanitizing runs twice (variables, then segments), so "Al.bum..." loses
	// one trailing dot per pass; the filename comes from the title token,
	// the extension always from the source file.
	want := filepath.Join("/lib", "AC_DC_Live _Bootleg__", "Al.bum.", "Song_.mp3")
	if got != want {
		t.Errorf("\n got %s\nwant %s", got, want)
	}
}

func TestResolveDuplicateTargetCollisionSuffix(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "song.mp3")
	writeFile(t, target, "a")
	writeFile(t, filepath.Join(dir, "song (1).mp3"), "b")

	got, err := ingest.ResolveDuplicateTarget(target)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if want := filepath.Join(dir, "song (2).mp3"); got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestMoveToLibraryPicksCollisionFreeTarget(t *testing.T) {
	dir := t.TempDir()
	lib := t.TempDir()

	first, err := ingest.MoveToLibrary(writeFile(t, filepath.Join(dir, "a.mp3"), "one"),
		filepath.Join(lib, "album", "a.mp3"))
	if err != nil {
		t.Fatalf("first move: %v", err)
	}
	if first != filepath.Join(lib, "album", "a.mp3") {
		t.Fatalf("unexpected first target %s", first)
	}

	second, err := ingest.MoveToLibrary(writeFile(t, filepath.Join(dir, "b.mp3"), "two"),
		filepath.Join(lib, "album", "a.mp3"))
	if err != nil {
		t.Fatalf("second move: %v", err)
	}
	if want := filepath.Join(lib, "album", "a (1).mp3"); second != want {
		t.Fatalf("collision not suffixed: got %s, want %s", second, want)
	}

	// Source files are gone, both targets hold their own content.
	if fileExists(filepath.Join(dir, "a.mp3")) || fileExists(filepath.Join(dir, "b.mp3")) {
		t.Fatal("sources survived the move")
	}
	assertContent(t, first, "one")
	assertContent(t, second, "two")
}

// TestMoveToLibraryAcrossDevices exercises the EXDEV copy+unlink fallback
// when the ingest folder and the library live on different filesystems
// (old organizer.ts:73-84). It skips on hosts without a second mount
// writable to the test user.
func TestMoveToLibraryAcrossDevices(t *testing.T) {
	other, err := os.MkdirTemp("/dev/shm", "sonarly-exdev-")
	if err != nil {
		t.Skipf("no usable second filesystem: %v", err)
	}
	defer os.RemoveAll(other)

	// Probe that the second filesystem actually crosses devices.
	probe := writeFile(t, filepath.Join(t.TempDir(), "probe"), "x")
	if err := os.Rename(probe, filepath.Join(other, "probe")); err == nil {
		t.Skip("test filesystems share a device; EXDEV path untestable here")
	}

	source := writeFile(t, filepath.Join(t.TempDir(), "song.mp3"), "audio-body")
	final, err := ingest.MoveToLibrary(source, filepath.Join(other, "song.mp3"))
	if err != nil {
		t.Fatalf("cross-device move: %v", err)
	}
	assertContent(t, final, "audio-body")
	if fileExists(source) {
		t.Fatal("source survived the verified copy")
	}
}

func writeFile(t *testing.T, path, content string) string {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

func assertContent(t *testing.T, path, want string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(data) != want {
		t.Fatalf("%s holds %q, want %q", path, data, want)
	}
}
