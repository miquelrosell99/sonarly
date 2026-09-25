// Copyright 2015, David Howden
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package tagfork

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

func newMetadataVorbis() *metadataVorbis {
	return &metadataVorbis{
		c: make(map[string][]string),
	}
}

// SONARLY(W1): comments are stored multi-value (map[string][]string) so
// repeated vorbis comments (ARTIST, GENRE, MUSICBRAINZ_ARTISTID, ...) keep
// every value instead of last-wins.
type metadataVorbis struct {
	c map[string][]string // the vorbis comments
	p *Picture
}

// first returns the first value of a multi-value comment ("" when absent).
func (m *metadataVorbis) first(k string) string {
	if v, ok := m.c[k]; ok && len(v) > 0 {
		return v[0]
	}
	return ""
}

func (m *metadataVorbis) readVorbisComment(r io.Reader) error {
	vendorLen, err := readUint32LittleEndian(r)
	if err != nil {
		return err
	}

	vendor, err := readString(r, uint(vendorLen))
	if err != nil {
		return err
	}
	m.c["vendor"] = []string{vendor}

	commentsLen, err := readUint32LittleEndian(r)
	if err != nil {
		return err
	}

	for i := uint32(0); i < commentsLen; i++ {
		l, err := readUint32LittleEndian(r)
		if err != nil {
			return err
		}
		s, err := readString(r, uint(l))
		if err != nil {
			return err
		}
		k, v, err := parseComment(s)
		if err != nil {
			return err
		}
		k = strings.ToLower(k)
		m.c[k] = append(m.c[k], v) // SONARLY(W1): accumulate multi-value comments
	}

	if b64, ok := m.c["metadata_block_picture"]; ok && len(b64) > 0 {
		data, err := base64.StdEncoding.DecodeString(b64[0])
		if err != nil {
			return err
		}
		m.readPictureBlock(bytes.NewReader(data))
	}

	return nil
}

func (m *metadataVorbis) readPictureBlock(r io.Reader) error {
	b, err := readInt(r, 4)
	if err != nil {
		return err
	}
	pictureType, ok := pictureTypes[byte(b)]
	if !ok {
		return fmt.Errorf("invalid picture type: %v", b)
	}
	mimeLen, err := readUint(r, 4)
	if err != nil {
		return err
	}
	mime, err := readString(r, mimeLen)
	if err != nil {
		return err
	}

	ext := ""
	switch mime {
	case "image/jpeg":
		ext = "jpg"
	case "image/png":
		ext = "png"
	case "image/gif":
		ext = "gif"
	}

	descLen, err := readUint(r, 4)
	if err != nil {
		return err
	}
	desc, err := readString(r, descLen)
	if err != nil {
		return err
	}

	// We skip width <32>, height <32>, colorDepth <32>, coloresUsed <32>
	_, err = readInt(r, 4) // width
	if err != nil {
		return err
	}
	_, err = readInt(r, 4) // height
	if err != nil {
		return err
	}
	_, err = readInt(r, 4) // color depth
	if err != nil {
		return err
	}
	_, err = readInt(r, 4) // colors used
	if err != nil {
		return err
	}

	dataLen, err := readInt(r, 4)
	if err != nil {
		return err
	}
	data := make([]byte, dataLen)
	_, err = io.ReadFull(r, data)
	if err != nil {
		return err
	}

	m.p = &Picture{
		Ext:         ext,
		MIMEType:    mime,
		Type:        pictureType,
		Description: desc,
		Data:        data,
	}
	return nil
}

func parseComment(c string) (k, v string, err error) {
	kv := strings.SplitN(c, "=", 2)
	if len(kv) != 2 {
		err = errors.New("vorbis comment must contain '='")
		return
	}
	k = kv[0]
	v = kv[1]
	return
}

func (m *metadataVorbis) Format() Format {
	return VORBIS
}

func (m *metadataVorbis) Raw() map[string]interface{} {
	raw := make(map[string]interface{}, len(m.c))
	for k, v := range m.c {
		raw[k] = v // SONARLY(W1): values are []string (multi-value)
	}
	return raw
}

func (m *metadataVorbis) Title() string {
	return m.first("title")
}

func (m *metadataVorbis) Artist() string {
	// ARTIST
	// The artist generally considered responsible for the work. In popular music
	// this is usually the performing band or singer. For classical music it would
	// be the composer. For an audio book it would be the author of the original text.
	return m.first("artist")
}

func (m *metadataVorbis) Album() string {
	return m.first("album")
}

func (m *metadataVorbis) AlbumArtist() string {
	// This field isn't actually included in the standard, though
	// it is commonly assigned to albumartist.
	return m.first("albumartist")
}

func (m *metadataVorbis) Composer() string {
	if v := m.first("composer"); v != "" {
		return v
	}
	// PERFORMER
	// The artist(s) who performed the work. In classical music this would be the
	// conductor, orchestra, soloists. In an audio book it would be the actor who
	// did the reading. In popular music this is typically the same as the ARTIST
	// and is omitted.
	if v := m.first("performer"); v != "" {
		return v
	}
	return m.first("artist")
}

func (m *metadataVorbis) Genre() string {
	return m.first("genre")
}

func (m *metadataVorbis) Year() int {
	var dateFormat string

	// The date need to follow the international standard https://en.wikipedia.org/wiki/ISO_8601
	// and obviously the VorbisComment standard https://wiki.xiph.org/VorbisComment#Date_and_time
	switch len(m.first("date")) {
	case 0:
		// Fallback on year tag as some files use that.
		if m.first("year") != "" {
			year, err := strconv.Atoi(m.first("year"))
			if err == nil {
				return year
			}
		}
		return 0
	case 4:
		dateFormat = "2006"
	case 7:
		dateFormat = "2006-01"
	case 10:
		dateFormat = "2006-01-02"
	}

	t, _ := time.Parse(dateFormat, m.first("date"))
	return t.Year()
}

func (m *metadataVorbis) Track() (int, int) {
	x, _ := strconv.Atoi(m.first("tracknumber"))
	// https://wiki.xiph.org/Field_names
	n, _ := strconv.Atoi(m.first("tracktotal"))
	return x, n
}

func (m *metadataVorbis) Disc() (int, int) {
	// https://wiki.xiph.org/Field_names
	x, _ := strconv.Atoi(m.first("discnumber"))
	n, _ := strconv.Atoi(m.first("disctotal"))
	return x, n
}

func (m *metadataVorbis) Lyrics() string {
	return m.first("lyrics")
}

func (m *metadataVorbis) Comment() string {
	if v := m.first("comment"); v != "" {
		return v
	}
	return m.first("description")
}

func (m *metadataVorbis) Picture() *Picture {
	return m.p
}
