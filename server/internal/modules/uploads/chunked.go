// Chunk store, streaming reassembly and the ingest move. The invariants
// here answer the audit's F10/B11 findings: reassembly streams chunk→file
// (never more than the io.Copy buffer is resident, a far cry from the old
// read-all-then-Buffer.concat), the cumulative size cap is enforced
// incrementally while streaming, and a missing chunk is a typed 4xx error
// carrying the index, not an fs read failure surfacing as a 500.

package uploads

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// Limits. They are variables (not constants) so tests can lower them; the
// chunk PUT and the reassembler read them at call time. The 1 GiB file cap
// exists so a malicious totalChunks cannot make the server write unbounded
// disk — the retired server enforced the same number but after buffering everything.
var (
	// MaxTotalChunks bounds the per-file chunk count and the chunk index
	// (0..9999). 10_000 × 10 MiB already overshoots MaxFileBytes.
	MaxTotalChunks = 10_000
	// MaxChunkBytes caps one chunk PUT (the old multipart parts were
	// implicitly bounded by the global body limit; the Go server states it).
	MaxChunkBytes int64 = 10 << 20
	// MaxFileBytes is the per-file reassembly cap, enforced incrementally.
	MaxFileBytes int64 = 1 << 30
)

// Typed validation/limit errors; routes map them to 4xx statuses.
var (
	ErrInvalidFileID       = errors.New("invalid file id")
	ErrInvalidChunkIndex   = errors.New("invalid chunk index")
	ErrInvalidChunkCount   = errors.New("invalid chunk count")
	ErrInvalidRelativePath = errors.New("invalid relative path")
	ErrChunkTooLarge       = errors.New("chunk too large")
	ErrFileTooLarge        = errors.New("file too large")
)

// MissingChunkError is the typed 4xx for a gap at reassembly time (old
// lesson: a missing chunk surfaced as a 500 read error, teaching clients
// nothing). Index is the first chunk index with no file on disk.
type MissingChunkError struct {
	Index int
}

func (e MissingChunkError) Error() string {
	return fmt.Sprintf("missing chunk %d", e.Index)
}

// IsValidFileID ports the old FILE_ID_PATTERN. The id doubles as a directory
// name, so it must be strictly alphanumeric/dash/underscore.
func IsValidFileID(fileID string) bool {
	if fileID == "" {
		return false
	}
	for _, r := range fileID {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}

// ParseChunkIndex validates a chunk index path segment: decimal digits only,
// value below MaxTotalChunks. (Digits-only doubles as path safety: the index
// becomes a file name under the chunk dir.)
func ParseChunkIndex(raw string) (int, error) {
	if raw == "" || len(raw) > 4 {
		return 0, ErrInvalidChunkIndex
	}
	n := 0
	for _, r := range raw {
		if r < '0' || r > '9' {
			return 0, ErrInvalidChunkIndex
		}
		n = n*10 + int(r-'0')
	}
	if n >= MaxTotalChunks {
		return 0, ErrInvalidChunkIndex
	}
	return n, nil
}

// IsSafeRelativePath ports the old guard: reject empty and absolute paths and
// any ".." segment on either separator, before the path ever joins the
// session dir. Reassembly re-checks containment on the resolved path — the
// double guard stays.
func IsSafeRelativePath(relativePath string) bool {
	if relativePath == "" || filepath.IsAbs(relativePath) {
		return false
	}
	for _, segment := range strings.FieldsFunc(relativePath, func(r rune) bool { return r == '/' || r == '\\' }) {
		if segment == ".." {
			return false
		}
	}
	return true
}

// chunkPath returns the on-disk chunk path for (fileID, index).
func chunkPath(sessionDir, fileID string, index int) string {
	return filepath.Join(sessionDir, "chunks", fileID, fmt.Sprintf("%d", index))
}

// WriteChunk stores one chunk at <sessionDir>/chunks/<fileId>/<index>,
// streaming r and refusing more than MaxChunkBytes. A re-PUT of the same
// index overwrites (retry/idempotency support, wire parity). The chunk lands
// via a temp file + rename so a crash mid-PUT cannot leave a truncated
// chunk that reassembly would concatenate silently.
func WriteChunk(sessionDir, fileID string, index int, r io.Reader) (int64, error) {
	if !IsValidFileID(fileID) {
		return 0, ErrInvalidFileID
	}
	if index < 0 || index >= MaxTotalChunks {
		return 0, ErrInvalidChunkIndex
	}
	dir := filepath.Join(sessionDir, "chunks", fileID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, fmt.Errorf("create chunk dir: %w", err)
	}
	target := chunkPath(sessionDir, fileID, index)
	tmp, err := os.CreateTemp(dir, ".partial-*")
	if err != nil {
		return 0, fmt.Errorf("create chunk temp: %w", err)
	}
	tmpName := tmp.Name()
	// Best-effort cleanup; after a successful rename tmpName no longer
	// exists and this is a no-op.
	defer os.Remove(tmpName)

	written, err := io.Copy(tmp, io.LimitReader(r, MaxChunkBytes+1))
	if err != nil {
		tmp.Close()
		return 0, fmt.Errorf("write chunk %d: %w", index, err)
	}
	if err := tmp.Close(); err != nil {
		return 0, fmt.Errorf("close chunk %d: %w", index, err)
	}
	if written > MaxChunkBytes {
		return 0, ErrChunkTooLarge
	}
	if err := os.Rename(tmpName, target); err != nil {
		return 0, fmt.Errorf("commit chunk %d: %w", index, err)
	}
	return written, nil
}

// ReassembleFile streams chunks 0..totalChunks-1 of fileID into
// <sessionDir>/files/<relativePath> — the final name under which the
// session-complete move will deliver the file to ingest. At most one chunk
// is in flight as an io.Copy buffer; every chunk's existence is verified up
// front of its copy, a missing one fails with MissingChunkError; the size
// cap is checked incrementally against actual bytes copied. A failed
// reassembly removes the partial target so retries and the sweeper never
// trip over it.
func ReassembleFile(sessionDir, fileID string, totalChunks int, relativePath string) (string, int64, error) {
	if !IsValidFileID(fileID) {
		return "", 0, ErrInvalidFileID
	}
	if totalChunks < 1 || totalChunks > MaxTotalChunks {
		return "", 0, ErrInvalidChunkCount
	}
	if !IsSafeRelativePath(relativePath) {
		return "", 0, ErrInvalidRelativePath
	}

	filesDir := filepath.Join(sessionDir, "files")
	target := filepath.Join(filesDir, relativePath)
	// Resolved-containment re-check (the old double guard): the lexical
	// IsSafeRelativePath filter runs first, this one proves the joined,
	// resolved path still cannot escape the session.
	absFilesDir, err := filepath.Abs(filesDir)
	if err != nil {
		return "", 0, fmt.Errorf("resolve files dir: %w", err)
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", 0, fmt.Errorf("resolve target: %w", err)
	}
	if absTarget != absFilesDir && !strings.HasPrefix(absTarget, absFilesDir+string(os.PathSeparator)) {
		return "", 0, ErrInvalidRelativePath
	}

	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", 0, fmt.Errorf("create target dir: %w", err)
	}
	out, err := os.Create(target)
	if err != nil {
		return "", 0, fmt.Errorf("create reassembled file: %w", err)
	}
	committed := false
	defer func() {
		out.Close()
		if !committed {
			os.Remove(target)
		}
	}()

	var total int64
	for i := 0; i < totalChunks; i++ {
		chunk, err := os.Open(chunkPath(sessionDir, fileID, i))
		if errors.Is(err, os.ErrNotExist) {
			return "", 0, MissingChunkError{Index: i}
		}
		if err != nil {
			return "", 0, fmt.Errorf("open chunk %d: %w", i, err)
		}
		info, err := chunk.Stat()
		if err != nil {
			chunk.Close()
			return "", 0, fmt.Errorf("stat chunk %d: %w", i, err)
		}
		total += info.Size()
		if total > MaxFileBytes {
			chunk.Close()
			return "", 0, ErrFileTooLarge
		}
		if _, err := io.CopyN(out, chunk, info.Size()); err != nil {
			chunk.Close()
			return "", 0, fmt.Errorf("copy chunk %d: %w", i, err)
		}
		chunk.Close()
	}
	if err := out.Close(); err != nil {
		return "", 0, fmt.Errorf("close reassembled file: %w", err)
	}
	committed = true
	return relativePath, total, nil
}

// MoveSessionFilesToIngest ports the old moveDirectoryContents: every file
// under <sessionDir>/files is renamed into ingestDir keeping its relative
// path; EXDEV (cross-device) falls back to copy+unlink. It returns the moved
// file count. A missing files dir means nothing was reassembled — nothing
// to move, still not an error (the caller decides whether an empty session
// is worth an ingest job).
//
// The move is non-atomic by nature: a crash between renames leaves some
// files moved and some not. That is the same window the retired server had, and the safety
// net is the same too — the scanner/ingest reconciliation re-derives the
// library from what is actually on disk, so a half-moved file is either
// ingested on the next pass or its source half is re-uploaded.
func MoveSessionFilesToIngest(sessionDir, ingestDir string) (int, error) {
	filesDir := filepath.Join(sessionDir, "files")
	moved := 0
	err := filepath.WalkDir(filesDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(filesDir, path)
		if err != nil {
			return err
		}
		target := filepath.Join(ingestDir, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := moveFile(path, target); err != nil {
			return fmt.Errorf("move %s: %w", rel, err)
		}
		moved++
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return moved, err
	}
	return moved, nil
}

// moveFile renames, converting cross-device renames (EXDEV) into
// copy+unlink — the old fallback, for when DATA_DIR and INGEST_PATH live on
// different mounts (the stock docker layout does exactly that).
func moveFile(sourcePath, targetPath string) error {
	if err := os.Rename(sourcePath, targetPath); err != nil {
		if !errors.Is(err, syscall.EXDEV) {
			return err
		}
		src, err := os.Open(sourcePath)
		if err != nil {
			return err
		}
		defer src.Close()
		dst, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		if _, err := io.Copy(dst, src); err != nil {
			dst.Close()
			return err
		}
		if err := dst.Close(); err != nil {
			return err
		}
		if err := os.Remove(sourcePath); err != nil {
			return err
		}
	}
	return nil
}

// RemoveSessionDirectory deletes the session's whole directory (chunks +
// reassembled files). Called after a successful session complete; the
// sweeper is the backstop for everything else.
func RemoveSessionDirectory(sessionDir string) error {
	if err := os.RemoveAll(sessionDir); err != nil {
		return fmt.Errorf("remove session dir: %w", err)
	}
	return nil
}
