// MP4/M4A extraction for the ReadMetadata facade. tagfork's Raw() keys are
// the raw atom names (©nam, ©ART, aART, ©alb, trkn, disk, ©gen, ©day, ©wrt,
// ©lyr, ©cmt, tmpo, cpil, covr, rtng — see tagfork/mp4.go atoms table); W1
// accumulates repeated atoms as []string, W2 exposes rtng and fixes tmpo.
// Freeform ---- atoms are keyed by their name ("MusicBrainz Track Id",
// "BARCODE", "PRODUCER", ...).

package audio

import (
	"strings"

	"github.com/miquelrosell99/sonarly/v2/internal/audio/tagfork"
)

func fillMP4(md *Metadata, tm tagfork.Metadata, raw map[string]interface{}) {
	md.Genres = flattenForKeys(raw, "\xa9gen")
	md.Composers = flattenForKeys(raw, "\xa9wrt")
	md.Producers = flattenForKeys(raw, "PRODUCER")
	md.Labels = flattenForKeys(raw, "LABEL")
	md.ISRCs = flattenForKeys(raw, "ISRC")

	md.MBIDRecording = firstForKeys(raw, "MusicBrainz Track Id")
	md.MBIDRelease = firstForKeys(raw, "MusicBrainz Album Id")
	md.MBIDReleaseGroup = firstForKeys(raw, "MusicBrainz Release Group Id")
	md.MBIDAlbumArtist = firstForKeys(raw, "MusicBrainz Album Artist Id")
	md.MBIDArtistIDs = flattenForKeys(raw, "MusicBrainz Artist Id")

	md.Barcode = firstForKeys(raw, "BARCODE")
	md.ASIN = firstForKeys(raw, "ASIN")
	md.ReleaseType = primaryReleaseType(flattenForKeys(raw, "MusicBrainz Album Type"))

	if v, ok := parseReplayGain(firstForKeys(raw, "replaygain_track_gain")); ok {
		md.ReplayGainTrack = v
	}
	if v, ok := parseReplayGain(firstForKeys(raw, "replaygain_album_gain")); ok {
		md.ReplayGainAlbum = v
	}

	// Synced lyrics via LRC-in-freeform (S1 row 26).
	for k, v := range raw {
		ku := strings.ToUpper(k)
		if strings.Contains(ku, "SYNCEDLYRICS") || strings.Contains(ku, "SYNCED_LYRICS") {
			if lines := parseLrc(firstString(rawValues(v))); len(lines) > 0 {
				md.SyncedLyrics = lines
				return
			}
		}
	}
}
