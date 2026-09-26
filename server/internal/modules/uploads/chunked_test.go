package uploads_test

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/modules/uploads"
)

func TestIsValidFileID(t *testing.T) {
	valid := []string{"abc", "ABC-123_xYz", "0", "a_b-c"}
	for _, id := range valid {
		if !uploads.IsValidFileID(id) {
			t.Errorf("IsValidFileID(%q): want true", id)
		}
	}
	invalid := []string{"", "a b", "a/b", "../x", "..", "a.b", "héllo", "a\\b"}
	for _, id := range invalid {
		if uploads.IsValidFileID(id) {
			t.Errorf("IsValidFileID(%q): want false", id)
		}
	}
}

func TestParseChunkIndex(t *testing.T) {
	cases := []struct {
		raw     string
		want    int
		wantErr bool
	}{
		{"0", 0, false},
		{"7", 7, false},
		{"9999", 9999, false},
		{"01", 1, false}, // digits-only, leading zero: the retired server accepted it too
		{"10000", 0, true},
		{"", 0, true},
		{"-1", 0, true},
		{"1.5", 0, true},
		{" 1", 0, true},
		{"1a", 0, true},
		{"99999", 0, true},
	}
	for _, c := range cases {
		got, err := uploads.ParseChunkIndex(c.raw)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseChunkIndex(%q): want error, got %d", c.raw, got)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("ParseChunkIndex(%q): want %d, got %d, err %v", c.raw, c.want, got, err)
		}
	}
}

func TestIsSafeRelativePath(t *testing.T) {
	safe := []string{
		"spike.mp3",
		"incoming/spike.mp3",
		`incoming\nested\spike.mp3`, // backslash is a filename char on the Linux server (wire parity)
		"a//b.mp3",
		"./x.mp3",
		"a/b/c.flac",
	}
	for _, p := range safe {
		if !uploads.IsSafeRelativePath(p) {
			t.Errorf("IsSafeRelativePath(%q): want true", p)
		}
	}
	unsafe := []string{
		"",
		"../x.mp3",
		"a/../../x.mp3",
		`..\x.mp3`,
		`a\..\x.mp3`,
		"/etc/passwd",
		"/abs/x.mp3",
		"..",
	}
	for _, p := range unsafe {
		if uploads.IsSafeRelativePath(p) {
			t.Errorf("IsSafeRelativePath(%q): want false", p)
		}
	}
}

func TestWriteChunkOverwriteAndValidation(t *testing.T) {
	dir := t.TempDir()
	if _, err := uploads.WriteChunk(dir, "f1", 0, bytes.NewReader([]byte("aaaa"))); err != nil {
		t.Fatalf("write chunk: %v", err)
	}
	// Re-PUT of the same index overwrites (retry support).
	if _, err := uploads.WriteChunk(dir, "f1", 0, bytes.NewReader([]byte("bb"))); err != nil {
		t.Fatalf("overwrite chunk: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "chunks", "f1", "0"))
	if err != nil {
		t.Fatalf("read chunk: %v", err)
	}
	if string(got) != "bb" {
		t.Fatalf("overwrite: want %q, got %q", "bb", got)
	}

	if _, err := uploads.WriteChunk(dir, "bad/id", 0, bytes.NewReader([]byte("x"))); !errors.Is(err, uploads.ErrInvalidFileID) {
		t.Fatalf("bad file id: want ErrInvalidFileID, got %v", err)
	}
	if _, err := uploads.WriteChunk(dir, "f1", uploads.MaxTotalChunks, bytes.NewReader([]byte("x"))); !errors.Is(err, uploads.ErrInvalidChunkIndex) {
		t.Fatalf("bad index: want ErrInvalidChunkIndex, got %v", err)
	}
}

// The streaming cap: a reader that yields more than the limit must fail
// with ErrChunkTooLarge and leave no committed chunk behind, even when the
// declared length cannot be trusted (no Content-Length).
func TestWriteChunkStreamingCap(t *testing.T) {
	old := uploads.MaxChunkBytes
	uploads.MaxChunkBytes = 8
	t.Cleanup(func() { uploads.MaxChunkBytes = old })

	dir := t.TempDir()
	_, err := uploads.WriteChunk(dir, "f1", 0, bytes.NewReader([]byte("123456789")))
	if !errors.Is(err, uploads.ErrChunkTooLarge) {
		t.Fatalf("want ErrChunkTooLarge, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "chunks", "f1", "0")); !os.IsNotExist(statErr) {
		t.Fatalf("oversized chunk must not be committed: %v", statErr)
	}
	if entries, _ := os.ReadDir(filepath.Join(dir, "chunks", "f1")); len(entries) != 0 {
		t.Fatalf("no partial file may survive: %v", entries)
	}
}

func TestReassembleFileUnit(t *testing.T) {
	dir := t.TempDir()
	parts := []string{"hello ", "odd ", "world"}
	for i, p := range parts {
		if _, err := uploads.WriteChunk(dir, "f1", i, bytes.NewReader([]byte(p))); err != nil {
			t.Fatalf("write chunk %d: %v", i, err)
		}
	}

	name, size, err := uploads.ReassembleFile(dir, "f1", 3, "sub/f.txt")
	if err != nil {
		t.Fatalf("reassemble: %v", err)
	}
	if name != "sub/f.txt" || size != int64(len("hello odd world")) {
		t.Fatalf("want (sub/f.txt, 15), got (%q, %d)", name, size)
	}
	got, err := os.ReadFile(filepath.Join(dir, "files", "sub", "f.txt"))
	if err != nil {
		t.Fatalf("read reassembled: %v", err)
	}
	if string(got) != "hello odd world" {
		t.Fatalf("content: %q", got)
	}

	// Missing chunk is a typed error carrying the index — never a bare 500.
	_, _, err = uploads.ReassembleFile(dir, "f1", 4, "sub/g.txt")
	var missing uploads.MissingChunkError
	if !errors.As(err, &missing) || missing.Index != 3 {
		t.Fatalf("want MissingChunkError{3}, got %v", err)
	}
	// The failed reassembly must not leave a partial target behind.
	if _, statErr := os.Stat(filepath.Join(dir, "files", "sub", "g.txt")); !os.IsNotExist(statErr) {
		t.Fatalf("partial target must be removed: %v", statErr)
	}

	if _, _, err := uploads.ReassembleFile(dir, "f1", 0, "x"); !errors.Is(err, uploads.ErrInvalidChunkCount) {
		t.Fatalf("zero chunks: want ErrInvalidChunkCount, got %v", err)
	}
	if _, _, err := uploads.ReassembleFile(dir, "f1", 3, "../escape.txt"); !errors.Is(err, uploads.ErrInvalidRelativePath) {
		t.Fatalf("traversal: want ErrInvalidRelativePath, got %v", err)
	}
}

func TestReassembleFileSizeCap(t *testing.T) {
	old := uploads.MaxFileBytes
	uploads.MaxFileBytes = 10
	t.Cleanup(func() { uploads.MaxFileBytes = old })

	dir := t.TempDir()
	for i, p := range []string{"12345", "67890"} {
		if _, err := uploads.WriteChunk(dir, "f1", i, bytes.NewReader([]byte(p))); err != nil {
			t.Fatalf("write chunk %d: %v", i, err)
		}
	}
	// 10 bytes is exactly the cap; one more chunk tips it over.
	if _, err := uploads.WriteChunk(dir, "f1", 2, bytes.NewReader([]byte("x"))); err != nil {
		t.Fatalf("write chunk 2: %v", err)
	}
	_, _, err := uploads.ReassembleFile(dir, "f1", 3, "f.bin")
	if !errors.Is(err, uploads.ErrFileTooLarge) {
		t.Fatalf("want ErrFileTooLarge, got %v", err)
	}
}

func TestMoveSessionFilesToIngest(t *testing.T) {
	sessionDir := t.TempDir()
	target := t.TempDir()
	for _, rel := range []string{"a.mp3", "sub/b.mp3"} {
		p := filepath.Join(sessionDir, "files", rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("data-"+rel), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	moved, err := uploads.MoveSessionFilesToIngest(sessionDir, target)
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if moved != 2 {
		t.Fatalf("want 2 moved, got %d", moved)
	}
	for _, rel := range []string{"a.mp3", "sub/b.mp3"} {
		got, err := os.ReadFile(filepath.Join(target, rel))
		if err != nil {
			t.Fatalf("moved file %s: %v", rel, err)
		}
		if string(got) != "data-"+rel {
			t.Fatalf("moved content %s: %q", rel, got)
		}
		if _, err := os.Stat(filepath.Join(sessionDir, "files", rel)); !os.IsNotExist(err) {
			t.Fatalf("source %s must be gone: %v", rel, err)
		}
	}

	// No files dir at all: nothing to move, not an error.
	empty, err := uploads.MoveSessionFilesToIngest(t.TempDir(), target)
	if err != nil || empty != 0 {
		t.Fatalf("empty session: want (0, nil), got (%d, %v)", empty, err)
	}
}
