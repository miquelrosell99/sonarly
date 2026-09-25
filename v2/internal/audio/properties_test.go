// W5 properties-reader accuracy test: cross-checks ReadMetadata's Properties
// against the format block of testdata/gold_v1.json (music-metadata@11.14.0,
// v1's exact version) with the S1-documented tolerances:
//
//   - duration: within ±50 ms or 1%, whichever is larger
//   - bitrate:  within 10%
//
// Documented deviations (S1 §5 W5):
//   - m4a bitrate: gold reports 800 — music-metadata derives mp4 bitrate
//     from the stsz sample table (audio bytes x 8 / duration), NOT the
//     esds avgBitrate (128000). P10 parity found the mm-derived value is
//     what v1 stores, so the reader sums stsz exactly like mm.
//     Gold's 800 is therefore the asserted value.
//   - flac bitrate: gold is 0 (mm reports 0 for lossless); we mirror that.

package audio

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

type goldDump struct {
	Format struct {
		Duration      float64 `json:"duration"`
		Bitrate       int     `json:"bitrate"`
		SampleRate    int     `json:"sampleRate"`
		NumberOfChans int     `json:"numberOfChannels"`
		BitsPerSample int     `json:"bitsPerSample"`
	} `json:"format"`
}

func TestPropertiesParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "gold_v1.json"))
	if err != nil {
		t.Fatalf("read gold_v1.json: %v", err)
	}
	var gold map[string]goldDump
	if err := json.Unmarshal(raw, &gold); err != nil {
		t.Fatalf("parse gold_v1.json: %v", err)
	}

	// m4a bitrate: music-metadata derives it from the stsz sample table
	// (audio bytes × 8 / duration — 800 for the synthetic corpus file), not
	// the esds avgBitrate (128000). P10 parity requires the mm value, so the
	// stsz sum is asserted against gold like every other field.
	for name, g := range gold {
		t.Run(name, func(t *testing.T) {
			md, err := ReadMetadata(filepath.Join("testdata", "corpus", name))
			if err != nil {
				t.Fatalf("ReadMetadata: %v", err)
			}
			p := md.Properties

			// duration: ±50 ms or 1%, whichever is larger
			tol := math.Max(0.05, g.Format.Duration*0.01)
			if math.Abs(p.Duration-g.Format.Duration) > tol {
				t.Errorf("Duration = %v, gold %v (tolerance %v)", p.Duration, g.Format.Duration, tol)
			}

			// bitrate: within 10% (m4a: gold's stsz-derived value — see header note)
			wantBitrate := g.Format.Bitrate
			if wantBitrate > 0 {
				if p.Bitrate == 0 || math.Abs(float64(p.Bitrate-wantBitrate)) > 0.10*float64(wantBitrate) {
					t.Errorf("Bitrate = %d, want %d ±10%%", p.Bitrate, wantBitrate)
				}
			} else if p.Bitrate != 0 {
				// flac: gold is 0 and we mirror it exactly
				t.Errorf("Bitrate = %d, want %d (lossless parity)", p.Bitrate, wantBitrate)
			}

			if p.SampleRate != g.Format.SampleRate {
				t.Errorf("SampleRate = %d, gold %d", p.SampleRate, g.Format.SampleRate)
			}
			if p.Channels != g.Format.NumberOfChans {
				t.Errorf("Channels = %d, gold %d", p.Channels, g.Format.NumberOfChans)
			}
			if g.Format.BitsPerSample != 0 && p.BitsPerSample != g.Format.BitsPerSample {
				t.Errorf("BitsPerSample = %d, gold %d", p.BitsPerSample, g.Format.BitsPerSample)
			}
		})
	}
}
