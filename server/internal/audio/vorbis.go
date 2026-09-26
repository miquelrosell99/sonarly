// Vorbis-comment (FLAC / Ogg) extraction for the ReadMetadata facade.
// Raw() keys are lowercased single words (W1-patched tagfork stores
// multi-value comments as []string).

package audio

import (
	"strings"
)

func fillVorbis(md *Metadata, raw map[string]interface{}) {
	md.Genres = flattenForKeys(raw, "genre")
	md.Composers = flattenForKeys(raw, "composer")
	md.Producers = flattenForKeys(raw, "producer")
	md.Labels = flattenForKeys(raw, "label", "organization")
	md.ISRCs = flattenForKeys(raw, "isrc")

	md.ReleaseType = primaryReleaseType(flattenForKeys(raw, "releasetype"))
	md.MBIDRecording = firstForKeys(raw, "musicbrainz_trackid")
	md.MBIDRelease = firstForKeys(raw, "musicbrainz_albumid")
	md.MBIDReleaseGroup = firstForKeys(raw, "musicbrainz_releasegroupid")
	md.MBIDAlbumArtist = firstForKeys(raw, "musicbrainz_albumartistid")
	md.MBIDArtistIDs = flattenForKeys(raw, "musicbrainz_artistid")

	md.Barcode = firstForKeys(raw, "barcode")
	md.ASIN = firstForKeys(raw, "asin")

	if v, ok := parseReplayGain(firstForKeys(raw, "replaygain_track_gain")); ok {
		md.ReplayGainTrack = v
	}
	if v, ok := parseReplayGain(firstForKeys(raw, "replaygain_album_gain")); ok {
		md.ReplayGainAlbum = v
	}

	// Synced lyrics via LRC-in-comment (S1 row 26).
	for _, k := range []string{"syncedlyrics", "synced_lyrics"} {
		if v, ok := raw[k]; ok {
			if lines := parseLrc(firstString(rawValues(v))); len(lines) > 0 {
				md.SyncedLyrics = lines
				return
			}
		}
	}
	// v1 also sniffs LRC payloads in any *LYRICS-named tag.
	for k, v := range raw {
		ku := strings.ToUpper(k)
		if !strings.Contains(ku, "LYRICS") || ku == "LYRICS" {
			continue
		}
		s := firstString(rawValues(v))
		if s == "" || !strings.Contains(s, "[") {
			continue
		}
		if lines := parseLrc(s); len(lines) > 0 {
			md.SyncedLyrics = lines
			return
		}
	}
}
