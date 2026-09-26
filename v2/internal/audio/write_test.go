// MutagenWriter round-trip tests against a corpus copy, guarded like v1's
// tag-writer suite: skipped unless python3 and the mutagen package are
// importable on the host.
package audio_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
)

// mutagenAvailable reports whether the python3 + mutagen runtime exists.
func mutagenAvailable(t *testing.T) bool {
	t.Helper()
	cmd := exec.Command("python3", "-c", "import mutagen")
	return cmd.Run() == nil
}

func requireMutagen(t *testing.T) {
	t.Helper()
	if !mutagenAvailable(t) {
		t.Skip("python3+mutagen not available on this host")
	}
}

// corpusCopy copies a corpus file into the test's temp dir and returns its path.
func corpusCopy(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "corpus", name))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write corpus copy: %v", err)
	}
	return path
}

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }
func boolPtr(b bool) *bool    { return &b }

// TestMutagenWriterRoundTrip writes a full tag set into every supported
// corpus format and reads it back through ReadMetadata.
func TestMutagenWriterRoundTrip(t *testing.T) {
	requireMutagen(t)
	writer := audio.NewMutagenWriter()
	for _, name := range []string{"spike.mp3", "spike.flac", "spike.ogg", "spike.m4a"} {
		t.Run(name, func(t *testing.T) {
			path := corpusCopy(t, name)
			if !writer.Supports(path) {
				t.Fatalf("Supports(%s) = false", name)
			}
			tags := audio.SongTags{
				Title:       strPtr("Rewritten Title"),
				Artist:      []string{"First Artist", "Second Artist"},
				Album:       strPtr("Rewritten Album"),
				AlbumArtist: []string{"Album Artist"},
				TrackNumber: intPtr(7),
				DiscNumber:  intPtr(2),
				Genre:       []string{"Noise"},
				Year:        intPtr(1999),
				Explicit:    boolPtr(true),
				Lyrics:      strPtr("la la la"),
			}
			if err := writer.Write(context.Background(), path, tags); err != nil {
				t.Fatalf("Write: %v", err)
			}

			meta, err := audio.ReadMetadata(path)
			if err != nil {
				t.Fatalf("ReadMetadata: %v", err)
			}
			if meta.Title != "Rewritten Title" {
				t.Errorf("title = %q", meta.Title)
			}
			if len(meta.Artists) != 2 || meta.Artists[0] != "First Artist" || meta.Artists[1] != "Second Artist" {
				t.Errorf("artists = %v", meta.Artists)
			}
			if meta.Album != "Rewritten Album" {
				t.Errorf("album = %q", meta.Album)
			}
			if meta.TrackNo != 7 {
				t.Errorf("track = %d", meta.TrackNo)
			}
			if meta.DiscNo != 2 {
				t.Errorf("disc = %d", meta.DiscNo)
			}
			if meta.Year != 1999 {
				t.Errorf("year = %d", meta.Year)
			}
			if len(meta.Genres) != 1 || meta.Genres[0] != "Noise" {
				t.Errorf("genres = %v", meta.Genres)
			}
			if meta.Explicit == nil || !*meta.Explicit {
				t.Errorf("explicit = %v", meta.Explicit)
			}
			if meta.Lyrics != "la la la" {
				t.Errorf("lyrics = %q", meta.Lyrics)
			}
		})
	}
}

// TestMutagenWriterAbsentFieldsUntouched: a write touching only the title
// must leave every other tag intact.
func TestMutagenWriterAbsentFieldsUntouched(t *testing.T) {
	requireMutagen(t)
	path := corpusCopy(t, "spike.mp3")
	writer := audio.NewMutagenWriter()
	if err := writer.Write(context.Background(), path, audio.SongTags{Title: strPtr("Only Title")}); err != nil {
		t.Fatalf("Write: %v", err)
	}
	meta, err := audio.ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}
	if meta.Title != "Only Title" {
		t.Errorf("title = %q", meta.Title)
	}
	if meta.Artist == "" && len(meta.Artists) == 0 {
		// Corpus files carry an artist; an absent field must not clear it.
		t.Errorf("artist was cleared by an absent field")
	}
}

// TestMutagenWriterFailureLeavesOriginalIntact: a failed write must never
// touch the original file — neither an unsupported extension nor a mutagen
// failure mid-rewrite (the atomic temp-sibling rename never runs).
func TestMutagenWriterFailureLeavesOriginalIntact(t *testing.T) {
	requireMutagen(t)

	// Unsupported extension: rejected before python ever runs.
	txt := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(txt, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := audio.WriteTags(context.Background(), txt, audio.SongTags{Title: strPtr("x")}); err == nil {
		t.Fatal("expected unsupported-format error")
	}
	if data, _ := os.ReadFile(txt); string(data) != "hello" {
		t.Fatal("unsupported file was modified")
	}

	// Corrupt file: mutagen raises on the temp copy; the rename never
	// happens and the original bytes are untouched.
	path := corpusCopy(t, "spike.mp3")
	if err := os.WriteFile(path, []byte{0x00, 0x01, 0x02}, 0o644); err != nil {
		t.Fatal(err)
	}
	err := audio.WriteTags(context.Background(), path, audio.SongTags{Title: strPtr("x")})
	if err == nil {
		t.Fatal("expected write failure on corrupt file")
	}
	if data, _ := os.ReadFile(path); len(data) != 3 {
		t.Fatalf("original modified: %d bytes", len(data))
	}
}

// TestMutagenWriterUnsupportedExtension: Supports and WriteTags both reject
// non-audio extensions without touching the file.
func TestMutagenWriterUnsupportedExtension(t *testing.T) {
	writer := audio.NewMutagenWriter()
	path := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if writer.Supports(path) {
		t.Fatal("Supports(.txt) = true")
	}
	err := audio.WriteTags(context.Background(), path, audio.SongTags{Title: strPtr("x")})
	if err == nil {
		t.Fatal("expected error for unsupported extension")
	}
	data, _ := os.ReadFile(path)
	if string(data) != "hello" {
		t.Fatal("file was modified")
	}
}
