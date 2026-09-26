package main

import "testing"

func TestParseMaxBitRate(t *testing.T) {
	cases := []struct {
		in   string
		want int
		ok   bool
	}{
		{"128", 128, true},
		{"64", 64, true},       // lower bound inclusive
		{"10000", 10000, true}, // upper bound inclusive
		{"63", 0, false},       // below range
		{"10001", 0, false},    // above range
		{"128.5", 0, false},    // non-integer
		{"abc", 0, false},
		{"", 0, false},
		{"  128  ", 128, true}, // Number() trims whitespace
		{"1e2", 100, true},     // Number("1e2") === 100
		{"0x40", 0, false},     // v1 quirk: Number("0x40") === 64 → honored; port rejects hex
		{"NaN", 0, false},
		{"Infinity", 0, false},
		{"128abc", 0, false},
	}
	for _, c := range cases {
		got, ok := parseMaxBitRate(c.in)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("parseMaxBitRate(%q) = %d,%v; want %d,%v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestDecideTranscode(t *testing.T) {
	flac := SongInfo{FilePath: "/music/a.flac", BitRate: 846000} // ~846 kbps
	mp3_128 := SongInfo{FilePath: "/music/b.mp3", BitRate: 128000}
	mp3_320 := SongInfo{FilePath: "/music/c.mp3", BitRate: 320000}
	m4a := SongInfo{FilePath: "/music/d.m4a", BitRate: 256000}
	ogg := SongInfo{FilePath: "/music/e.ogg", BitRate: 160000}
	unknown := SongInfo{FilePath: "/music/f.flac", BitRate: 0}

	userCap192 := &UserTranscodePrefs{MaxBitrateKbps: 192}
	userFmtAAC := &UserTranscodePrefs{TranscodeFormat: "aac"}
	userBoth := &UserTranscodePrefs{MaxBitrateKbps: 192, TranscodeFormat: "mp3"}

	cases := []struct {
		name   string
		song   SongInfo
		user   *UserTranscodePrefs
		req    int
		hasReq bool
		want   TranscodeDecision
	}{
		{"nothing configured", mp3_128, nil, 0, false, TranscodeDecision{}},
		{"flac + requested 128", flac, nil, 128, true, TranscodeDecision{true, "mp3", 128}},
		{"mp3 128 + requested 64 (clamp edge)", mp3_128, nil, 64, true, TranscodeDecision{true, "mp3", 64}},
		{"mp3 128 + requested 128 not > source → direct", mp3_128, nil, 128, true, TranscodeDecision{}},
		{"mp3 320 + requested 128", mp3_320, nil, 128, true, TranscodeDecision{true, "mp3", 128}},
		{"requested 320, user cap 192 → min wins", mp3_320, userCap192, 320, true, TranscodeDecision{true, "mp3", 192}},
		{"requested 128, user cap 192 → requested wins", mp3_320, userCap192, 128, true, TranscodeDecision{true, "mp3", 128}},
		{"user cap alone under source", flac, userCap192, 0, false, TranscodeDecision{true, "mp3", 192}},
		{"user cap above source → direct", mp3_128, &UserTranscodePrefs{MaxBitrateKbps: 320}, 0, false, TranscodeDecision{}},
		{"unknown source bitrate + cap → transcode", unknown, userCap192, 0, false, TranscodeDecision{true, "mp3", 192}},
		{"m4a + aac target → suffix mismatch quirk (always transcode)", m4a, userFmtAAC, 0, false, TranscodeDecision{true, "aac", 0}},
		{"ogg + aac target → transcode to aac", ogg, userFmtAAC, 0, false, TranscodeDecision{true, "aac", 0}},
		{"mp3 + aac target → transcode to aac", mp3_128, userFmtAAC, 0, false, TranscodeDecision{true, "aac", 0}},
		{"mp3 + mp3 target, no bitrate → direct", mp3_128, userBoth, 0, false, TranscodeDecision{}},
		{"flac + mp3 target + cap → transcode mp3", flac, userBoth, 0, false, TranscodeDecision{true, "mp3", 192}},
		{"format-only target, bitrate carried along", flac, &UserTranscodePrefs{TranscodeFormat: "opus", MaxBitrateKbps: 96}, 0, false, TranscodeDecision{true, "opus", 96}},
	}
	for _, c := range cases {
		got := decideTranscode(c.song, c.user, c.req, c.hasReq)
		if got != c.want {
			t.Errorf("%s: got %+v; want %+v", c.name, got, c.want)
		}
	}
}

func TestParseRangeV1(t *testing.T) {
	const size = 1000
	cases := []struct {
		header string
		ok     bool
		start  int64
		end    int64
	}{
		{"bytes=0-99", true, 0, 99},
		{"bytes=100-", true, 100, 999},   // open-ended
		{"bytes=-100", true, 900, 999},   // suffix
		{"bytes=-1000", true, 0, 999},    // suffix == size → whole file
		{"bytes=-0", false, 0, 0},        // zero suffix invalid
		{"bytes=0-99999", true, 0, 999},  // clamped
		{"bytes=999-", true, 999, 999},   // open-ended from the last byte is valid
		{"bytes=1000-", false, 0, 0},     // start == size invalid
		{"bytes=200-100", false, 0, 0},   // end < start invalid
		{"bytes=0-9,20-29", false, 0, 0}, // multi-range unsupported
		{"bytes=abc-5", false, 0, 0},
		{"items=0-99", false, 0, 0},
		{"bytes=-", false, 0, 0},
		{"bytes=0-1-2", false, 0, 0},
	}
	for _, c := range cases {
		r, ok := parseRangeV1(c.header, size)
		if ok != c.ok || (ok && (r.start != c.start || r.end != c.end)) {
			t.Errorf("parseRangeV1(%q, %d) = %+v,%v; want %d-%d,%v", c.header, size, r, ok, c.start, c.end, c.ok)
		}
	}
}

func TestFFmpegArgs(t *testing.T) {
	got := ffmpegArgs("/music/a song.mp3", "mp3", 128)
	want := []string{"-hide_banner", "-loglevel", "error", "-i", "/music/a song.mp3", "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"}
	if len(got) != len(want) {
		t.Fatalf("len mismatch: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("arg[%d] = %q; want %q (full: %v)", i, got[i], want[i], got)
		}
	}
	// No bitrate → -q:a 2 (v1 parity)
	got = ffmpegArgs("/a.flac", "mp3", 0)
	if got[9] != "-q:a" || got[10] != "2" {
		t.Errorf("default quality args: %v", got)
	}
	// argv-style spawn: no shell interpretation of spaces/metachars by
	// construction (exec.Command, never sh -c). Verified by the args being
	// discrete strings; a shell would split "/music/a song.mp3".
}
