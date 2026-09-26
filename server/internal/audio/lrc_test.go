package audio

import "testing"

func TestFormatLRCParseRoundTrip(t *testing.T) {
	lines := []SyncedLyricLine{
		{Time: 0, Text: "start"},
		{Time: 1.5, Text: "half"},
		{Time: 61.25, Text: "over a minute"},
		{Time: 600, Text: "ten minutes"},
	}
	lrc := FormatLRC(lines)
	want := "[00:00.00] start\n[00:01.50] half\n[01:01.25] over a minute\n[10:00.00] ten minutes"
	if lrc != want {
		t.Fatalf("FormatLRC: want %q, got %q", want, lrc)
	}
	back := ParseLRC(lrc)
	if len(back) != len(lines) {
		t.Fatalf("round trip line count: want %d, got %d (%v)", len(lines), len(back), back)
	}
	for i, line := range lines {
		if back[i].Time != line.Time || back[i].Text != line.Text {
			t.Errorf("line %d: want %+v, got %+v", i, line, back[i])
		}
	}
}

func TestFormatLRCFractionCarry(t *testing.T) {
	// 59.995s rounds to 6000 centiseconds; the carry must produce a valid
	// next-minute timestamp, not an invalid "[59:60.00]".
	if got := FormatLRC([]SyncedLyricLine{{Time: 59.995, Text: "x"}}); got != "[01:00.00] x" {
		t.Fatalf("carry: got %q", got)
	}
}

func TestFormatLRCFractionRounding(t *testing.T) {
	if got := FormatLRC([]SyncedLyricLine{{Time: 1.234, Text: "x"}}); got != "[00:01.23] x" {
		t.Fatalf("truncating round: got %q", got)
	}
	if got := FormatLRC([]SyncedLyricLine{{Time: 1.236, Text: "x"}}); got != "[00:01.24] x" {
		t.Fatalf("rounding up: got %q", got)
	}
}
