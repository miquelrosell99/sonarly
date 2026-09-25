// W5 audio-properties reader per docs/v2-s1-metadata-findings.md §5 W5
// option 1: hand-rolled, pure Go, zero dependencies. dhowden/tag (and
// therefore tagfork) reads tags only — duration/bitrate/sampleRate/channels
// are required by OpenSubsonic and the player timeline, so this fills the
// gap v1 got from music-metadata's `format` block.
//
// Format support (mirrors v1's coverage):
//   - MP3:   frame-header scan with Xing/Info/VBRI VBR headers; full frame
//     walk for exact CBR duration (matches music-metadata's
//     numberOfSamples/sampleRate result on CBR streams).
//   - FLAC:  STREAMINFO block.
//   - Ogg:   Vorbis identification header + last-page granule (file tail
//     scan); basic OpusHead support.
//   - MP4:   mdhd duration/timescale + stsd sample entry + esds avg bitrate.

package audio

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
)

// Properties holds the audio stream properties v1 sourced from
// music-metadata's format block.
type Properties struct {
	Duration      float64 // seconds
	Bitrate       int     // bits per second; 0 for lossless FLAC (v1 parity — mm reports 0)
	SampleRate    int     // Hz
	Channels      int
	BitsPerSample int // 0 when unknown (e.g. lossy codecs)
}

// readProperties detects the audio container by magic and reads its stream
// properties. Returns an error for unsupported/corrupt files; never panics.
func readProperties(path string) (Properties, error) {
	f, err := os.Open(path)
	if err != nil {
		return Properties{}, err
	}
	defer f.Close()

	head := make([]byte, 12)
	if _, err := io.ReadFull(f, head); err != nil {
		return Properties{}, fmt.Errorf("read header: %w", err)
	}
	// Rewind: the format readers below start from offset 0.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return Properties{}, err
	}

	switch {
	case string(head[0:4]) == "fLaC":
		return flacProperties(f)
	case string(head[0:4]) == "OggS":
		return oggProperties(f)
	case string(head[4:8]) == "ftyp":
		return mp4Properties(f)
	default:
		return mp3Properties(f)
	}
}

// --------------------------------------------------------------------- FLAC

func flacProperties(f *os.File) (Properties, error) {
	var p Properties
	if _, err := f.Seek(4, io.SeekStart); err != nil { // skip "fLaC"
		return p, err
	}
	for {
		hdr := make([]byte, 4)
		if _, err := io.ReadFull(f, hdr); err != nil {
			return p, fmt.Errorf("flac block header: %w", err)
		}
		last := hdr[0]&0x80 != 0
		typ := hdr[0] & 0x7F
		length := int(hdr[1])<<16 | int(hdr[2])<<8 | int(hdr[3])
		if typ == 0 { // STREAMINFO
			b := make([]byte, 34)
			if _, err := io.ReadFull(f, b); err != nil {
				return p, fmt.Errorf("flac STREAMINFO: %w", err)
			}
			packed := binary.BigEndian.Uint64(b[10:18])
			p.SampleRate = int((packed >> 44) & 0xFFFFF)
			p.Channels = int((packed>>41)&0x7) + 1
			p.BitsPerSample = int((packed>>36)&0x1F) + 1
			totalSamples := packed & 0xFFFFFFFFF
			if p.SampleRate > 0 && totalSamples > 0 {
				p.Duration = float64(totalSamples) / float64(p.SampleRate)
			}
			// v1 parity: music-metadata reports bitrate 0 for FLAC (lossless
			// streams have no nominal bitrate); keep Bitrate 0.
			return p, nil
		}
		if last {
			return p, errors.New("flac: no STREAMINFO block")
		}
		if _, err := f.Seek(int64(length), io.SeekCurrent); err != nil {
			return p, fmt.Errorf("flac skip block: %w", err)
		}
	}
}

// ---------------------------------------------------------------------- Ogg

// oggPageHeader mirrors the Ogg page header (bytes 0..26, before the segment
// table).
type oggPageHeader struct {
	Flags   uint8
	Granule uint64
	Serial  uint32
}

func readOggPageHeader(b []byte) (oggPageHeader, bool) {
	var h oggPageHeader
	if len(b) < 27 || string(b[0:4]) != "OggS" || b[4] != 0 {
		return h, false
	}
	h.Flags = b[5]
	h.Granule = binary.LittleEndian.Uint64(b[6:14])
	h.Serial = binary.LittleEndian.Uint32(b[14:18])
	return h, true
}

func oggProperties(f *os.File) (Properties, error) {
	var p Properties

	// First page: the Vorbis/Opus identification header. Read exactly the
	// 27-byte header, then the segment table, then the payload.
	hdr27 := make([]byte, 27)
	if _, err := io.ReadFull(f, hdr27); err != nil {
		return p, fmt.Errorf("ogg page header: %w", err)
	}
	h, ok := readOggPageHeader(hdr27)
	if !ok {
		return p, errors.New("ogg: invalid first page")
	}
	nSegs := int(hdr27[26])
	segTable := make([]byte, nSegs)
	if _, err := io.ReadFull(f, segTable); err != nil {
		return p, fmt.Errorf("ogg segment table: %w", err)
	}
	segTotal := 0
	for _, s := range segTable {
		segTotal += int(s)
	}
	payload := make([]byte, segTotal)
	if _, err := io.ReadFull(f, payload); err != nil {
		return p, fmt.Errorf("ogg ident payload: %w", err)
	}

	var lastGranule uint64
	var granuleSeen bool
	var err error

	switch {
	case len(payload) >= 30 && string(payload[0:7]) == "\x01vorbis":
		p.Channels = int(payload[11])
		p.SampleRate = int(binary.LittleEndian.Uint32(payload[12:16]))
		bitrateNominal := int(int32(binary.LittleEndian.Uint32(payload[20:24])))
		if bitrateNominal > 0 {
			p.Bitrate = bitrateNominal
		}
		// Duration from the last page's granule position of this stream.
		lastGranule, granuleSeen, err = oggLastGranule(f, h.Serial)
		if err != nil {
			return p, err
		}
		if granuleSeen && p.SampleRate > 0 {
			p.Duration = float64(lastGranule) / float64(p.SampleRate)
		}
	case len(payload) >= 19 && string(payload[0:8]) == "OpusHead":
		p.Channels = int(payload[9])
		p.SampleRate = 48000 // Opus decodes at 48 kHz regardless of the input rate field
		lastGranule, granuleSeen, err = oggLastGranule(f, h.Serial)
		if err != nil {
			return p, err
		}
		if granuleSeen {
			p.Duration = float64(lastGranule) / 48000
		}
	default:
		return p, errors.New("ogg: no vorbis/opus identification header")
	}

	if p.Bitrate == 0 && p.Duration > 0 {
		if fi, err := f.Seek(0, io.SeekEnd); err == nil {
			p.Bitrate = int(float64(fi) * 8 / p.Duration)
		}
	}
	return p, nil
}

// oggLastGranule scans the file tail for the last Ogg page carrying a
// granule position for the given serial. Returns ok=false when no such page
// exists (e.g. truncated streams — v1 still reports the nominal fields then).
func oggLastGranule(f *os.File, serial uint32) (granule uint64, ok bool, err error) {
	end, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, false, err
	}
	// The last page starts within the final 64 KiB for non-chained files.
	window := int64(64 * 1024)
	if end < window {
		window = end
	}
	buf := make([]byte, window)
	if _, err := f.ReadAt(buf, end-window); err != nil {
		return 0, false, fmt.Errorf("ogg tail read: %w", err)
	}
	for i := len(buf) - 27; i >= 0; i-- {
		h, valid := readOggPageHeader(buf[i:])
		if !valid || h.Serial != serial {
			continue
		}
		if h.Flags&0x1 != 0 {
			continue // continued packet: not a page boundary we trust for granule
		}
		if h.Granule == ^uint64(0) {
			continue // -1: no sample completes on this page
		}
		return h.Granule, true, nil
	}
	return 0, false, nil
}

// ---------------------------------------------------------------------- MP4

// mp4Properties walks the atom tree (moov/trak/mdia → mdhd; minf/stbl →
// stsd → audio sample entry → esds) of a QuickTime/MP4 file.
func mp4Properties(f *os.File) (Properties, error) {
	var p Properties
	var timescale, duration uint64
	var avgBitrate int

	found, err := mp4Walk(f, "", 0, -1, func(path string, data []byte) error {
		switch {
		case path == "moov/trak/mdia/mdhd":
			if len(data) < 4 {
				return errors.New("mp4: short mdhd")
			}
			version := data[0]
			switch version {
			case 0:
				if len(data) < 24 {
					return errors.New("mp4: short mdhd v0")
				}
				timescale = uint64(binary.BigEndian.Uint32(data[12:16]))
				duration = uint64(binary.BigEndian.Uint32(data[16:20]))
			case 1:
				if len(data) < 36 {
					return errors.New("mp4: short mdhd v1")
				}
				timescale = uint64(binary.BigEndian.Uint32(data[20:24]))
				duration = uint64(binary.BigEndian.Uint64(data[24:32]))
			default:
				return fmt.Errorf("mp4: unsupported mdhd version %d", version)
			}
		case path == "moov/trak/mdia/minf/stbl/stsd":
			ch, sr, bits, avg, err := parseStsd(data)
			if err != nil {
				return err
			}
			if ch > 0 {
				p.Channels = ch
			}
			if sr > 0 {
				p.SampleRate = sr
			}
			if bits > 0 {
				p.BitsPerSample = bits
			}
			if avg > 0 {
				avgBitrate = avg
			}
		}
		return nil
	})
	if err != nil {
		return p, err
	}
	if !found {
		return p, errors.New("mp4: no moov atom")
	}
	if timescale > 0 {
		p.Duration = float64(duration) / float64(timescale)
	}
	p.Bitrate = avgBitrate
	return p, nil
}

// mp4Containers are atoms whose children we recurse into. stsd is handled
// specially (its children are sample entries, see parseStsd).
var mp4Containers = map[string]bool{
	"moov": true, "trak": true, "mdia": true,
	"minf": true, "stbl": true, "udta": true, "meta": true,
}

// mp4Walk reads atoms from rs, calling fn with the slash-joined path and raw
// payload of mdhd and stsd atoms. Returns whether a moov atom was seen.
func mp4Walk(f *os.File, prefix string, depth int, limit int64, fn func(path string, data []byte) error) (bool, error) {
	if depth > 8 {
		return false, errors.New("mp4: atom nesting too deep")
	}
	found := false
	for limit != 0 {
		hdr := make([]byte, 8)
		if _, err := io.ReadFull(f, hdr); err != nil {
			// EOF at an atom boundary is normal (atom-aligned file end).
			return found, nil
		}
		size := uint64(binary.BigEndian.Uint32(hdr[0:4]))
		name := string(hdr[4:8])
		n := int64(8)
		switch size {
		case 1: // largesize
			b := make([]byte, 8)
			if _, err := io.ReadFull(f, b); err != nil {
				return found, err
			}
			size = binary.BigEndian.Uint64(b)
			n += 8
		case 0: // extends to end of file
			end, err := f.Seek(0, io.SeekEnd)
			if err != nil {
				return found, err
			}
			size = uint64(end) - uint64(n)
		}
		if size < uint64(n) {
			return found, fmt.Errorf("mp4: atom %q has invalid size %d", name, size)
		}
		payload := size - uint64(n)
		if limit > 0 && payload > uint64(limit) {
			return found, fmt.Errorf("mp4: atom %q overruns parent", name)
		}
		if limit > 0 {
			limit -= int64(size)
		}

		if name == "moov" {
			found = true
		}
		path := name
		if prefix != "" {
			path = prefix + "/" + name
		}

		switch {
		case name == "meta":
			// meta is a full atom: 4 bytes version/flags precede children.
			if _, err := f.Seek(4, io.SeekCurrent); err != nil {
				return found, err
			}
			sub, err := mp4Walk(f, path, depth+1, int64(payload)-4, fn)
			found = found || sub
			if err != nil {
				return found, err
			}
		case mp4Containers[name]:
			sub, err := mp4Walk(f, path, depth+1, int64(payload), fn)
			found = found || sub
			if err != nil {
				return found, err
			}
		case name == "mdhd" || name == "stsd":
			b := make([]byte, payload)
			if _, err := io.ReadFull(f, b); err != nil {
				return found, err
			}
			if err := fn(path, b); err != nil {
				return found, err
			}
		default:
			if _, err := f.Seek(int64(payload), io.SeekCurrent); err != nil {
				return found, err
			}
		}
	}
	return found, nil
}

// parseStsd parses a stsd (sample description) full atom payload: entry
// count, then the first audio sample entry (mp4a/alac/enca/...), from which
// channels/sampleSize/sampleRate and the esds avg bitrate are extracted.
func parseStsd(b []byte) (channels, sampleRate, bitsPerSample, avgBitrate int, err error) {
	if len(b) < 8 {
		return 0, 0, 0, 0, errors.New("mp4: short stsd")
	}
	count := int(binary.BigEndian.Uint32(b[4:8]))
	if count < 1 {
		return 0, 0, 0, 0, errors.New("mp4: stsd with no entries")
	}
	pos := 8
	for i := 0; i < count; i++ {
		if pos+36 > len(b) {
			return 0, 0, 0, 0, errors.New("mp4: short stsd entry")
		}
		size := int(binary.BigEndian.Uint32(b[pos : pos+4]))
		if size < 36 || pos+size > len(b) {
			return 0, 0, 0, 0, errors.New("mp4: invalid stsd entry size")
		}
		entry := b[pos : pos+size]
		format := string(entry[4:8])
		if format == "mp4a" || format == "alac" || format == "enca" || format == "raw " || format == "sowt" || format == "twos" {
			// AudioSampleEntry v0: 6 reserved + dataRef(2) + version(2) +
			// revision(2) + vendor(4) + channels(2) + sampleSize(2) +
			// compression(2) + packetSize(2) + sampleRate(16.16 fixed).
			if binary.BigEndian.Uint16(entry[16:18]) != 0 {
				return 0, 0, 0, 0, errors.New("mp4: unsupported sample entry version")
			}
			channels = int(binary.BigEndian.Uint16(entry[24:26]))
			bitsPerSample = int(binary.BigEndian.Uint16(entry[26:28]))
			sampleRate = int(binary.BigEndian.Uint32(entry[32:36]) >> 16)
			// Walk child atoms for esds.
			avgBitrate = parseEsdsBitrate(entry[36:])
			return channels, sampleRate, bitsPerSample, avgBitrate, nil
		}
		pos += size
	}
	return 0, 0, 0, 0, errors.New("mp4: no audio sample entry")
}

// parseEsdsBitrate scans esds child atoms of a sample entry for the average
// bitrate in the DecoderConfigDescriptor (tag 0x04).
func parseEsdsBitrate(b []byte) int {
	pos := 0
	for pos+8 <= len(b) {
		size := int(binary.BigEndian.Uint32(b[pos : pos+4]))
		if size < 8 || pos+size > len(b) {
			return 0
		}
		if string(b[pos+4:pos+8]) == "esds" {
			payload := b[pos+8 : pos+size]
			if len(payload) < 4 {
				return 0
			}
			return esdsAvgBitrate(payload[4:]) // skip version/flags
		}
		pos += size
	}
	return 0
}

// esdsAvgBitrate walks the ES descriptor (tag 0x03 → DecoderConfigDescriptor
// tag 0x04) and returns its avgBitrate field.
func esdsAvgBitrate(b []byte) int {
	tag, body, ok := readDescriptor(b)
	if !ok || tag != 0x03 || len(body) < 3 {
		return 0
	}
	// ES_ID(2) + flags(1), then nested descriptors.
	rest := body[3:]
	for len(rest) > 0 {
		tag, body, ok = readDescriptor(rest)
		if !ok {
			return 0
		}
		if tag == 0x04 && len(body) >= 13 {
			return int(binary.BigEndian.Uint32(body[9:13]))
		}
		// Skip this descriptor's body (plus SLConfig etc. follow).
		rest = rest[descriptorLen(rest):]
	}
	return 0
}

// readDescriptor reads a DES tag and length (7-bit continuation encoding)
// from the front of b, returning the tag and the body slice.
func readDescriptor(b []byte) (tag byte, body []byte, ok bool) {
	if len(b) < 2 {
		return 0, nil, false
	}
	tag = b[0]
	length := 0
	i := 1
	for ; i < len(b) && i < 5; i++ {
		length = length<<7 | int(b[i]&0x7F)
		if b[i]&0x80 == 0 {
			break
		}
	}
	if i >= len(b) || length > len(b)-i-1 {
		return 0, nil, false
	}
	return tag, b[i+1 : i+1+length], true
}

// descriptorLen returns the total encoded length of the descriptor at the
// front of b (tag + length bytes + body), or len(b) if malformed.
func descriptorLen(b []byte) int {
	if len(b) < 2 {
		return len(b)
	}
	length := 0
	i := 1
	for ; i < len(b) && i < 5; i++ {
		length = length<<7 | int(b[i]&0x7F)
		if b[i]&0x80 == 0 {
			break
		}
	}
	total := i + length
	if total > len(b) {
		return len(b)
	}
	return total
}

// ---------------------------------------------------------------------- MP3

var (
	// bitrate tables in bps, indexed by MPEG header bitrate index.
	mp3Bitrates = [3][3][16]int{ // [version group][layer][index]
		{ // MPEG 1
			{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0}, // Layer I
			{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0},    // Layer II
			{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},     // Layer III
		},
		{ // MPEG 2
			{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0}, // Layer I
			{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},      // Layer II
			{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},      // Layer III
		},
		{ // MPEG 2.5
			{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0}, // Layer I
			{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},      // Layer II
			{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},      // Layer III
		},
	}
	mp3SampleRates = [3][3]int{ // [version group][rate index]
		{44100, 48000, 32000}, // MPEG 1
		{22050, 24000, 16000}, // MPEG 2
		{11025, 12000, 8000},  // MPEG 2.5
	}
)

// mp3FrameInfo is a parsed MPEG audio frame header.
type mp3FrameInfo struct {
	versionGroup int // 0 = MPEG1, 1 = MPEG2, 2 = MPEG2.5
	layer        int // 1..3
	bitrate      int // bps (0 = free format)
	sampleRate   int
	padding      int
	channels     int
	frameLen     int
	samples      int // samples per frame
}

// parseMP3FrameHeader validates b as a 4-byte MPEG audio frame header and
// decodes it. ok=false means b is not a valid frame header.
func parseMP3FrameHeader(b []byte) (fi mp3FrameInfo, ok bool) {
	if len(b) < 4 || b[0] != 0xFF || b[1]&0xE0 != 0xE0 {
		return fi, false
	}
	versionBits := (b[1] >> 3) & 0x03
	layerBits := (b[1] >> 1) & 0x03
	if versionBits == 1 || layerBits == 0 {
		return fi, false // reserved
	}
	fi.versionGroup = 0
	switch versionBits {
	case 3: // 00 → MPEG 2.5, 10 → MPEG 2, 11 → MPEG 1
		fi.versionGroup = 0
	case 2:
		fi.versionGroup = 1
	case 0:
		fi.versionGroup = 2
	}
	fi.layer = 4 - int(layerBits) // 01 → Layer III, 10 → II, 11 → I

	bitrateIdx := int(b[2] >> 4)
	rateIdx := int((b[2] >> 2) & 0x03)
	if bitrateIdx == 0 || bitrateIdx == 15 || rateIdx == 3 {
		return fi, false // free format / bad / reserved
	}
	fi.bitrate = mp3Bitrates[fi.versionGroup][fi.layer-1][bitrateIdx] * 1000 // table is kbps
	fi.sampleRate = mp3SampleRates[fi.versionGroup][rateIdx]
	fi.padding = int((b[2] >> 1) & 0x01)
	channelMode := (b[3] >> 6) & 0x03
	if channelMode == 3 {
		fi.channels = 1
	} else {
		fi.channels = 2
	}

	// Frame length and samples per frame.
	switch fi.layer {
	case 1:
		fi.frameLen = (12*fi.bitrate/fi.sampleRate + fi.padding) * 4
		fi.samples = 384
	case 2:
		fi.frameLen = 144 * fi.bitrate / fi.sampleRate
		fi.samples = 1152
	default: // Layer III
		if fi.versionGroup == 0 { // MPEG 1
			fi.frameLen = 144*fi.bitrate/fi.sampleRate + fi.padding
			fi.samples = 1152
		} else {
			fi.frameLen = 72*fi.bitrate/fi.sampleRate + fi.padding
			fi.samples = 576
		}
	}
	if fi.frameLen <= 0 {
		return fi, false
	}
	return fi, true
}

// mp3Properties scans an MP3 stream: skips an ID3v2 tag at the front and an
// ID3v1 tag at the end, finds the first frame, then uses a Xing/Info/VBRI
// VBR header when present and otherwise counts frames for an exact CBR
// duration.
func mp3Properties(f *os.File) (Properties, error) {
	var p Properties

	end, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return p, err
	}
	audioEnd := end
	if end >= 128 {
		tail := make([]byte, 3)
		if _, err := f.ReadAt(tail, end-128); err == nil && string(tail) == "TAG" {
			audioEnd -= 128 // trailing ID3v1 tag
		}
	}

	start := int64(0)
	head := make([]byte, 10)
	if _, err := f.ReadAt(head, 0); err == nil && string(head[0:3]) == "ID3" {
		size := int64(head[6]&0x7F)<<21 | int64(head[7]&0x7F)<<14 |
			int64(head[8]&0x7F)<<7 | int64(head[9]&0x7F)
		start = 10 + size
		if head[5]&0x10 != 0 { // v2.4 footer present
			start += 10
		}
	}
	if start >= audioEnd {
		return p, errors.New("mp3: no audio data")
	}

	// Locate the first frame header, allowing a resync window for garbage.
	first, ok := mp3FindFrame(f, start, audioEnd, 64*1024)
	if !ok {
		return p, errors.New("mp3: no frame sync found")
	}
	p.SampleRate = first.sampleRate
	p.Channels = first.channels

	// Xing/Info and VBRI VBR headers live in the first frame.
	if frames, bytes, vbr := mp3VBRHeader(f, first); vbr {
		duration := float64(frames) * float64(first.samples) / float64(first.sampleRate)
		p.Duration = duration
		if bytes > 0 && duration > 0 {
			p.Bitrate = int(float64(bytes) * 8 / duration)
		}
		return p, nil
	}

	// CBR: walk every frame for an exact duration (padding-aware).
	frames, _, err := mp3CountFrames(f, start, audioEnd, first)
	if err != nil {
		return p, err
	}
	if frames == 0 {
		return p, errors.New("mp3: no frames")
	}
	p.Duration = float64(frames) * float64(first.samples) / float64(first.sampleRate)
	// music-metadata reports the header (nominal) bitrate for CBR.
	p.Bitrate = first.bitrate
	return p, nil
}

// mp3FindFrame scans for the first valid frame header in [pos, limit) and
// returns its decoded header.
func mp3FindFrame(f *os.File, pos, limit int64, window int64) (mp3FrameInfo, bool) {
	if limit-pos > window {
		limit = pos + window
	}
	buf := make([]byte, 4)
	for pos+4 <= limit {
		if _, err := f.ReadAt(buf, pos); err != nil {
			return mp3FrameInfo{}, false
		}
		if fi, ok := parseMP3FrameHeader(buf); ok {
			return fi, true
		}
		pos++
	}
	return mp3FrameInfo{}, false
}

// mp3VBRHeader checks the first frame for a Xing/Info ("Xing"/"Info") or VBRI
// header and returns the declared frame and byte counts.
func mp3VBRHeader(f *os.File, first mp3FrameInfo) (frames, bytes int, ok bool) {
	// Side-info size between the frame header and the Xing offset.
	sideInfo := 32
	if first.layer != 3 {
		return 0, 0, false // VBR headers only apply to Layer III
	}
	if first.versionGroup == 0 { // MPEG 1
		if first.channels == 1 {
			sideInfo = 17
		}
	} else {
		sideInfo = 17
		if first.channels == 1 {
			sideInfo = 9
		}
	}
	xingOff := int64(4 + sideInfo)

	buf := make([]byte, 4)
	readU32 := func(off int64) (uint32, bool) {
		b := make([]byte, 4)
		if _, err := f.ReadAt(b, off); err != nil {
			return 0, false
		}
		return binary.BigEndian.Uint32(b), true
	}

	if _, err := f.ReadAt(buf, xingOff); err == nil && (string(buf) == "Xing" || string(buf) == "Info") {
		flags, ok := readU32(xingOff + 4)
		if !ok {
			return 0, 0, false
		}
		off := xingOff + 8
		var f, by uint32
		if flags&0x1 != 0 {
			if f, ok = readU32(off); !ok {
				return 0, 0, false
			}
			off += 4
		}
		if flags&0x2 != 0 {
			if by, ok = readU32(off); !ok {
				return 0, 0, false
			}
		}
		if f > 0 {
			return int(f), int(by), true
		}
		return 0, 0, false
	}

	// VBRI sits at a fixed offset of 36 bytes from the frame start.
	if _, err := f.ReadAt(buf, 36); err == nil && string(buf) == "VBRI" {
		by, ok1 := readU32(36 + 10)
		f, ok2 := readU32(36 + 14)
		if ok1 && ok2 && f > 0 {
			return int(f), int(by), true
		}
	}
	return 0, 0, false
}

// mp3CountFrames walks consecutive valid frames from the first sync, with a
// bounded resync over inter-frame garbage, and returns the frame count and
// total audio bytes.
func mp3CountFrames(f *os.File, start, audioEnd int64, first mp3FrameInfo) (frames int, audioBytes int64, err error) {
	pos := start
	fi := first
	const maxFrames = 1 << 20
	const resyncWindow = 4 * 1024
	b := make([]byte, 4)
	for frames < maxFrames && pos+4 <= audioEnd {
		if pos+int64(fi.frameLen) > audioEnd {
			break
		}
		frames++
		audioBytes += int64(fi.frameLen)
		pos += int64(fi.frameLen)

		if _, err := f.ReadAt(b, pos); err != nil {
			break
		}
		if next, ok := parseMP3FrameHeader(b); ok {
			fi = next
			continue
		}

		// Not a frame header: bounded resync for garbage between frames.
		syncPos, found := mp3FindFramePos(f, pos+1, audioEnd, resyncWindow)
		if !found {
			break
		}
		audioBytes += syncPos - pos
		pos = syncPos
		if _, err := f.ReadAt(b, pos); err != nil {
			break
		}
		fi, _ = parseMP3FrameHeader(b) // guaranteed by mp3FindFramePos
	}
	if frames == 0 {
		return 0, 0, errors.New("mp3: no valid frames")
	}
	return frames, audioBytes, nil
}

// mp3FindFramePos scans for the next valid frame header in
// [pos, pos+window) and returns its exact offset.
func mp3FindFramePos(f *os.File, pos, limit int64, window int64) (int64, bool) {
	if limit-pos > window {
		limit = pos + window
	}
	buf := make([]byte, 4)
	for pos+4 <= limit {
		if _, err := f.ReadAt(buf, pos); err != nil {
			return 0, false
		}
		if _, ok := parseMP3FrameHeader(buf); ok {
			return pos, true
		}
		pos++
	}
	return 0, false
}
