package playback

import (
	"context"
	"testing"
)

// TestLoadActiveSongToleratesLegacyFractionalNumerics is the regression for
// the corrected P10b dual-run finding (2026-09-26): v1-written catalog rows
// carry fractional REAL numerics — production example, Eminem's
// "Amityville": bit_rate 924936.3617333054, duration 254.77333333333334 —
// and the strict sql.NullInt64 scan failed with "converting driver.Value
// type float64 ... invalid syntax", 500-ing /api/stream for every such row.
// The tolerant db.NullInt64 truncates instead (v2's integer-second spec).
func TestLoadActiveSongToleratesLegacyFractionalNumerics(t *testing.T) {
	env := newEnv(t, Options{})
	env.mustExec(t, `UPDATE songs SET bit_rate = 924936.3617333054, duration = 254.77333333333334 WHERE id = 's-a1'`)

	song, err := env.svc.loadActiveSong(context.Background(), "s-a1")
	if err != nil {
		t.Fatalf("loadActiveSong: %v", err)
	}
	if song.bitRate != 924936 {
		t.Errorf("bitRate = %d, want truncated 924936", song.bitRate)
	}
	if song.duration == nil || *song.duration != 254 {
		t.Errorf("duration = %v, want truncated 254", song.duration)
	}

	// NULLs must stay unknown, and well-formed ints must pass through.
	env.mustExec(t, `UPDATE songs SET bit_rate = NULL, duration = NULL WHERE id = 's-a1'`)
	song, err = env.svc.loadActiveSong(context.Background(), "s-a1")
	if err != nil {
		t.Fatalf("loadActiveSong NULL: %v", err)
	}
	if song.bitRate != 0 || song.duration != nil {
		t.Errorf("NULL row: bitRate = %d duration = %v, want 0/nil", song.bitRate, song.duration)
	}
}
