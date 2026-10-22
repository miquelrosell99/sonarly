// Codec/Atmos probe tests: synthetic MP4 stsd entries for the sample-entry
// 4CCs the live library actually carries (FLAC-in-MP4 'flac' per the MP4
// registration, Dolby 'ec-3' with and without the JOC dec3 configuration)
// plus the mp4a esds objectTypeIndication mapping. Builders mirror the
// hand-built corpus generator (testdata/gen_corpus.py).

package audio

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// mp4Atom prefixes payload with an 8-byte size+name atom header.
func mp4Atom(name string, payload []byte) []byte {
	b := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(b[0:4], uint32(len(b)))
	copy(b[4:8], name)
	copy(b[8:], payload)
	return b
}

// mp4AudioEntry builds a v0 AudioSampleEntry: 8-byte header (size+format),
// the 28-byte v0 layout body, then child atoms.
func mp4AudioEntry(format string, children ...[]byte) []byte {
	body := make([]byte, 0, 28)
	body = append(body, make([]byte, 6)...)               // reserved
	body = append(body, 0, 1)                             // data reference index
	body = append(body, make([]byte, 8)...)               // version/revision/vendor (0 = v0)
	body = append(body, 0, 2)                             // channels
	body = append(body, 0, 16)                            // sample size
	body = append(body, 0, 0, 0, 0)                       // compression id / packet size
	body = binary.BigEndian.AppendUint32(body, 44100<<16) // sample rate, 16.16 fixed
	for _, c := range children {
		body = append(body, c...)
	}
	return mp4Atom(format, body)
}

// mp4StsdPayload wraps sample entries in a stsd full-atom payload
// (version/flags + entry count).
func mp4StsdPayload(entries ...[]byte) []byte {
	b := make([]byte, 0, 8)
	b = append(b, 0, 0, 0, 0) // version/flags
	b = binary.BigEndian.AppendUint32(b, uint32(len(entries)))
	for _, e := range entries {
		b = append(b, e...)
	}
	return b
}

// mp4EsdsAtom builds an esds child atom whose DecoderConfigDescriptor carries
// the given objectTypeIndication and avg bitrate (same shape the corpus
// generator writes).
func mp4EsdsAtom(oti byte, avgBitrate uint32) []byte {
	cfg := []byte{oti, 0x15} // objectTypeIndication + audio stream type
	cfg = append(cfg, 0, 0, 0)
	cfg = binary.BigEndian.AppendUint32(cfg, avgBitrate)
	cfg = binary.BigEndian.AppendUint32(cfg, avgBitrate)
	desc := append([]byte{0x04, byte(len(cfg))}, cfg...)
	es := append([]byte{0x03, byte(3 + len(desc)), 0, 1, 0}, desc...)
	payload := append([]byte{0, 0, 0, 0}, es...) // version/flags
	return mp4Atom("esds", payload)
}

// mp4Dec3Atom builds a dec3 (E-AC-3 configuration) child atom with the given
// num_dep_sub encoded per the MSB-first 4-bit layout (ETSI TS 102 366).
func mp4Dec3Atom(numDepSub int) []byte {
	payload := []byte{
		0x18,                      // fscod(2) bsid(5) reserved(1) — live files write bsid 12
		byte(numDepSub>>3) & 0x01, // byte1 low bit: num_dep_sub bit 3
		byte(numDepSub&0x07) << 5, // byte2 top three bits: num_dep_sub bits 2..0
	}
	return mp4Atom("dec3", payload)
}

func TestParseStsdFlacEntry(t *testing.T) {
	for _, format := range []string{"fLaC", "flac"} {
		info, err := parseStsd(mp4StsdPayload(mp4AudioEntry(format)))
		if err != nil {
			t.Fatalf("parseStsd %q: %v", format, err)
		}
		if info.codec != "FLAC" {
			t.Fatalf("%s: codec = %q, want FLAC", format, info.codec)
		}
		if info.atmos {
			t.Fatalf("%s entry must not flag Atmos", format)
		}
		if info.channels != 2 || info.sampleRate != 44100 || info.bitsPerSample != 16 {
			t.Errorf("%s: v0 layout fields: %+v", format, info)
		}
	}
}

func TestParseStsdEc3Atmos(t *testing.T) {
	cases := []struct {
		name      string
		children  [][]byte
		wantAtmos bool
	}{
		{"dec3 num_dep_sub=1 (JOC)", [][]byte{mp4Dec3Atom(1)}, true},
		{"dec3 num_dep_sub=3", [][]byte{mp4Dec3Atom(3)}, true},
		{"dec3 num_dep_sub=0 (plain E-AC-3)", [][]byte{mp4Dec3Atom(0)}, false},
		{"no dec3 atom", nil, false},
		{"short dec3 payload", [][]byte{mp4Atom("dec3", []byte{0, 0})}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info, err := parseStsd(mp4StsdPayload(mp4AudioEntry("ec-3", tc.children...)))
			if err != nil {
				t.Fatalf("parseStsd: %v", err)
			}
			if info.codec != "E-AC-3" {
				t.Fatalf("codec = %q, want E-AC-3", info.codec)
			}
			if info.atmos != tc.wantAtmos {
				t.Fatalf("atmos = %v, want %v", info.atmos, tc.wantAtmos)
			}
		})
	}
}

// The dec3 payload of the one true Atmos file in the live library, verbatim
// ("0106 - Reich_ The Desert Music_ IV. moderate.m4a"; ffprobe: "Dolby
// Digital Plus + Dolby Atmos", 768 kbps). num_dep_sub spans the byte
// boundary, which is exactly the encoding a naive byte-aligned read misses.
func TestParseStsdEc3LiveAtmosPayload(t *testing.T) {
	liveDec3 := mp4Atom("dec3", []byte{0x18, 0x00, 0x20, 0x0f, 0x00, 0x01, 0x10})
	info, err := parseStsd(mp4StsdPayload(mp4AudioEntry("ec-3", liveDec3)))
	if err != nil {
		t.Fatalf("parseStsd: %v", err)
	}
	if info.codec != "E-AC-3" || !info.atmos {
		t.Fatalf("live dec3: codec=%q atmos=%v, want E-AC-3 + Atmos", info.codec, info.atmos)
	}
}

func TestParseStsdMp4aObjectTypeIndication(t *testing.T) {
	cases := []struct {
		oti  byte
		want string
	}{
		{0x40, "AAC"}, // MPEG-4 AAC (the corpus spike.m4a value)
		{0x6B, "MP3"}, // MPEG-1 audio
		{0x69, "MP3"}, // MPEG-2 audio
		{0x66, "AAC"}, // unknown OTI still rides the mp4a entry → AAC fallback
	}
	for _, tc := range cases {
		info, err := parseStsd(mp4StsdPayload(mp4AudioEntry("mp4a", mp4EsdsAtom(tc.oti, 768000))))
		if err != nil {
			t.Fatalf("OTI %#x: parseStsd: %v", tc.oti, err)
		}
		if info.codec != tc.want {
			t.Errorf("OTI %#x: codec = %q, want %q", tc.oti, info.codec, tc.want)
		}
	}
	if info, err := parseStsd(mp4StsdPayload(mp4AudioEntry("mp4a", mp4EsdsAtom(0x40, 768000)))); err != nil || info.avgBitrate != 768000 {
		t.Errorf("avg bitrate = %d, err %v; want 768000", info.avgBitrate, err)
	}
}

func TestParseStsdEntryCodecMapping(t *testing.T) {
	cases := []struct {
		format string
		want   string
	}{
		{"alac", "ALAC"},
		{"ac-3", "AC-3"},
		{"Opus", "Opus"},
		{"enca", ""}, // encrypted: unknown until decrypted
		{"raw ", "PCM"},
		{"sowt", "PCM"},
		{"twos", "PCM"},
	}
	for _, tc := range cases {
		info, err := parseStsd(mp4StsdPayload(mp4AudioEntry(tc.format)))
		if err != nil {
			t.Fatalf("%q: parseStsd: %v", tc.format, err)
		}
		if info.codec != tc.want {
			t.Errorf("%q: codec = %q, want %q", tc.format, info.codec, tc.want)
		}
		if info.atmos {
			t.Errorf("%q: atmos must be false", tc.format)
		}
	}
}

// The whole-file probe against the real corpus: every file reports its
// display codec, and no synthetic file is Atmos.
func TestReadMetadataCodecCorpus(t *testing.T) {
	cases := []struct {
		file  string
		codec string
	}{
		{"spike.flac", "FLAC"},
		{"spike.mp3", "MP3"},
		{"spike.ogg", "Vorbis"},
		{"spike.m4a", "AAC"},
	}
	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			md, err := ReadMetadata(filepath.Join("testdata", "corpus", tc.file))
			if err != nil {
				t.Fatalf("ReadMetadata: %v", err)
			}
			if md.Properties.Codec != tc.codec {
				t.Errorf("Properties.Codec = %q, want %q", md.Properties.Codec, tc.codec)
			}
			if md.Codec != tc.codec {
				t.Errorf("Metadata.Codec = %q, want %q", md.Codec, tc.codec)
			}
			if md.Properties.Atmos || md.Atmos {
				t.Error("corpus files are not Atmos")
			}
		})
	}
}

// mp4MvhdV0 builds an mvhd v0 payload: version/flags, creation, modification,
// timescale, duration, plus filler to a full header.
func mp4MvhdV0(timescale, duration uint32) []byte {
	b := make([]byte, 24)
	binary.BigEndian.PutUint32(b[12:16], timescale)
	binary.BigEndian.PutUint32(b[16:20], duration)
	return mp4Atom("mvhd", b)
}

// mp4MdhdV0 builds an mdhd v0 payload the way the mp4Properties reader
// consumes it (timescale at [12:16], duration at [16:20]).
func mp4MdhdV0(timescale, duration uint32) []byte {
	b := make([]byte, 24)
	binary.BigEndian.PutUint32(b[12:16], timescale)
	binary.BigEndian.PutUint32(b[16:20], duration)
	return mp4Atom("mdhd", b)
}

// mp4StszFixed builds an stsz atom with a fixed sample size.
func mp4StszFixed(sampleSize, count uint32) []byte {
	b := make([]byte, 16)
	binary.BigEndian.PutUint32(b[4:8], sampleSize)
	binary.BigEndian.PutUint32(b[8:12], count)
	return mp4Atom("stsz", b)
}

// mvhd fallback: ffmpeg in some Atmos muxes writes the track mdhd duration as
// 0 while the movie header mvhd carries the real duration (the live library's
// one true Atmos file: mdhd 0, mvhd 208544/1000 = 208.544 s per ffprobe). The
// probe must fall back; a valid mdhd still wins over mvhd.
func TestMp4MvhdFallbackDuration(t *testing.T) {
	cases := []struct {
		name         string
		mdhdDuration uint32
		mvhdDuration uint32
		wantDuration float64
	}{
		{"mdhd 0 falls back to mvhd", 0, 208544, 208.544},
		{"mdhd present wins over mvhd", 5000, 208544, 5.0},
		{"mdhd 0 and mvhd 0 stays 0", 0, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stblPayload := append(mp4Atom("stsd", mp4StsdPayload(mp4AudioEntry("mp4a", mp4EsdsAtom(0x40, 768000)))), mp4StszFixed(48000, 100)...)
			stbl := mp4Atom("stbl", stblPayload)
			mdia := mp4Atom("mdia", append(mp4MdhdV0(1000, tc.mdhdDuration), mp4Atom("minf", stbl)...))
			moov := mp4Atom("moov", append(mp4MvhdV0(1000, tc.mvhdDuration), mp4Atom("trak", mdia)...))
			ftyp := mp4Atom("ftyp", []byte("M4A \x00\x00\x00\x00M4A "))
			path := filepath.Join(t.TempDir(), "mvhd-fallback.m4a")
			if err := os.WriteFile(path, append(ftyp, moov...), 0o644); err != nil {
				t.Fatal(err)
			}
			p, err := readProperties(path)
			if err != nil {
				t.Fatalf("readProperties: %v", err)
			}
			if p.Duration != tc.wantDuration {
				t.Fatalf("Duration = %v, want %v", p.Duration, tc.wantDuration)
			}
		})
	}
}
