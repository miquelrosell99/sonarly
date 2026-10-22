package opensubsonic

import (
	"bytes"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// Playlist mosaic: getCoverArt's playlist tier composites up to 4 distinct
// album covers into one square 2x2 grid (QUIRKS R7), mirroring the web UI's
// PlaylistCoverGrid — Feishin/Music Assistant display the single image the
// endpoint returns, so the grid has to be rendered server-side. Tiles cycle
// to always fill the 2x2 (2 covers → ABAB, 3 → ABCA), exactly like the SPA's
// fillCoverAlbums. Output is a 512x512 JPEG (4 x 256px tiles).

// mosaicTile is one quadrant's pixel size; the output is 2x2 tiles.
const mosaicTile = 256

// decodeCover decodes a cached cover blob. Stored format wins; unknown
// formats fall back to content sniffing so legacy rows still decode.
// webp needs golang.org/x/image (stdlib has no webp decoder).
func decodeCover(format string, data []byte) (image.Image, error) {
	img, err := decodeCoverFormat(format, data)
	if err == nil {
		return img, nil
	}
	if sniffed, ok := sniffImageFormat(data); ok {
		return decodeCoverFormat(sniffed, data)
	}
	return nil, err
}

func decodeCoverFormat(format string, data []byte) (image.Image, error) {
	r := bytes.NewReader(data)
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "image/jpeg", "image/jpg", "jpeg", "jpg":
		return jpeg.Decode(r)
	case "image/png", "png":
		return png.Decode(r)
	case "image/webp", "webp":
		return webp.Decode(r)
	case "image/gif", "gif":
		return gif.Decode(r)
	}
	return nil, image.ErrFormat
}

func sniffImageFormat(data []byte) (string, bool) {
	switch {
	case len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return "image/jpeg", true
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return "image/png", true
	case len(data) >= 12 && string(data[8:12]) == "WEBP":
		return "image/webp", true
	case len(data) >= 6 && string(data[:6]) == "GIF8":
		return "image/gif", true
	}
	return "", false
}

// squareTile center-crops src to a square and resamples it to mosaicTile.
func squareTile(src image.Image) *image.RGBA {
	b := src.Bounds()
	side := min(b.Dx(), b.Dy())
	x0 := b.Min.X + (b.Dx()-side)/2
	y0 := b.Min.Y + (b.Dy()-side)/2
	crop := image.NewRGBA(image.Rect(0, 0, side, side))
	draw.Draw(crop, crop.Bounds(), src, image.Pt(x0, y0), draw.Over)
	tile := image.NewRGBA(image.Rect(0, 0, mosaicTile, mosaicTile))
	draw.CatmullRom.Scale(tile, tile.Bounds(), crop, crop.Bounds(), draw.Over, nil)
	return tile
}

// renderMosaic composites tiles (1-4, cycled to fill) into a 2x2 square and
// encodes it as JPEG.
func renderMosaic(tiles []image.Image) ([]byte, error) {
	out := image.NewRGBA(image.Rect(0, 0, mosaicTile*2, mosaicTile*2))
	// Quadrant order matches the SPA grid: TL, TR, BL, BR.
	quadrants := [][2]int{{0, 0}, {mosaicTile, 0}, {0, mosaicTile}, {mosaicTile, mosaicTile}}
	for i, q := range quadrants {
		tile := squareTile(tiles[i%len(tiles)])
		draw.Draw(out, image.Rect(q[0], q[1], q[0]+mosaicTile, q[1]+mosaicTile), tile, image.Point{}, draw.Over)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
