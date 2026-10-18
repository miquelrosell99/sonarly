package library_test

import (
	"slices"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// AlbumArtistNames fallback ladder: tagged album artist wins; a file with
// several track artists and no album-artist tag is a compilation and groups
// under Various Artists; a single-artist file keeps the track-artist
// fallback so ordinary untagged-album-artist albums are unaffected.
func TestAlbumArtistNames(t *testing.T) {
	meta := func(albumArtists []string, albumArtist string, artists ...string) *audio.Metadata {
		return &audio.Metadata{AlbumArtists: albumArtists, AlbumArtist: albumArtist, Artists: artists}
	}
	cases := []struct {
		name string
		meta *audio.Metadata
		song []string
		want []string
	}{
		{"multi-value tag wins", meta([]string{"Tag A", "Tag B"}, "", "X", "Y"), []string{"X", "Y"}, []string{"Tag A", "Tag B"}},
		{"single tag wins", meta(nil, "Tag A", "X"), []string{"X"}, []string{"Tag A"}},
		{"multi-artist fallback is Various Artists", meta(nil, "", "X", "Y"), []string{"X", "Y"}, []string{library.VariousArtists}},
		{"single artist keeps track fallback", meta(nil, "", "X"), []string{"X"}, []string{"X"}},
		{"no artists at all", meta(nil, "", ""), nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := library.AlbumArtistNames(tc.meta, tc.song)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("AlbumArtistNames = %v, want %v", got, tc.want)
			}
		})
	}
}
