package testparity

// Normalization rules for the parity diff matrix. EVERY rule carries an ID
// and a comment naming the decision that justifies it (docs/v2-opensubsonic-
// quirks.md row for /rest deltas, docs/audits/2026-09-25-frontend-
// architecture-audit.md FF4 item for /api deltas, or an explicit P10
// decision recorded in the parity report). A delta with no covering rule is
// a BLOCKER: the case fails and the delta is listed in the report.
//
// All helpers here are pure functions over values decoded from JSON
// (map[string]any / []any / scalars); they never mutate their input.

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// Rule describes one accepted delta so the report can list them all.
type Rule struct {
	// ID is the stable rule name, e.g. "FF4a-song-drops-filePath".
	ID string
	// Why names the decision source (quirks row / FF4 item / P10 decision).
	Why string
}

// normRule pairs a rule with its transform: given the v1 value in place, the
// transform returns the value v1 should be compared against (usually a
// canonicalized copy). The transform is applied to the v1 response only.
type normRule struct {
	Rule
	apply func(v any) any
}

var normRules = map[string]normRule{}

// Concrete accepted-delta rules. Each is referenced by ID from the step
// matrix in parity_test.go; applying one records its ID+justification in
// the case result and the report.

// ruleRESTServerVersion drops the envelope's serverVersion: v1 hardcodes
// "0.1.0", v2 injects build info (quirks doc E2 — deliberate fix).
var ruleRESTServerVersion = normRule{
	Rule{"E2-serverVersion-buildinfo", "quirks E2: v2 serverVersion comes from build info instead of v1's hardcoded 0.1.0"},
	func(v any) any { return deleteKeysAt(v, "serverVersion") },
}

// ruleSongDropsFilePath deletes filePath/checksum that v2's Song DTO dropped
// (frontend audit FF4(a) — negotiated separately with the UI).
var ruleSongDropsFilePath = normRule{
	Rule{"FF4a-song-drops-filePath-checksum", "frontend audit FF4(a): v2 Song has no filePath/checksum"},
	func(v any) any { return deleteKeysAt(v, "filePath", "checksum") },
}

// ruleRESTLastModified zeroes getIndexes' lastModified: v1 emits Date.now()
// per request, v2 derives it from content (quirks doc B2 — deliberate fix).
var ruleRESTLastModified = normRule{
	Rule{"B2-lastModified-content-derived", "quirks B2: v1 lastModified is Date.now() per request; v2 derives it from content"},
	func(v any) any { return setKeyAt(v, "lastModified", float64(0)) },
}

// ruleGetUserFolder canonicalizes getUser's folder list: v1 hardcodes
// ["0"], v2 returns the caller's scoped real library ids (quirks doc S5 —
// deliberate fix). Folder COUNT stays comparable.
var ruleGetUserFolder = normRule{
	Rule{"S5-getUser-folder-scoped-ids", "quirks S5: v1 getUser.folder is hardcoded [\"0\"]; v2 returns real scoped library ids"},
	func(v any) any {
		return mapKeyAt(v, "folder", func(old any) any {
			if list, ok := old.([]any); ok {
				out := make([]any, len(list))
				for i := range list {
					out[i] = "FOLDER"
				}
				return out
			}
			return "FOLDER"
		})
	},
}

// ruleMusicFolderIDs canonicalizes getMusicFolders' positional-index ids:
// v1 ids are "0","1",…; v2 uses real library ids (quirks doc B1 — deliberate
// fix). Names and order stay comparable.
var ruleMusicFolderIDs = normRule{
	Rule{"B1-musicFolders-real-ids", "quirks B1: v1 folder ids are positional indexes; v2 uses real library ids"},
	func(v any) any {
		return mapKeyAt(v, "musicFolder", func(old any) any {
			list, ok := old.([]any)
			if !ok {
				return old
			}
			out := make([]any, len(list))
			for i, item := range list {
				if m, ok := item.(map[string]any); ok {
					c := clone(m).(map[string]any)
					c["id"] = fmt.Sprintf("F%d", i)
					out[i] = c
				} else {
					out[i] = item
				}
			}
			return out
		})
	},
}

// ruleGetAvatar404 covers the getAvatar gap: v1 never registered the route
// (Fastify's default 404 JSON body), v2 answers a deliberate plain-text 404
// (quirks doc R10 — deliberate fix). Only the status code is compared.
var ruleGetAvatar404 = "R10-getAvatar-explicit-404: v1 had no getAvatar (Fastify default 404 JSON); v2 answers a plain-text 404 (quirks R10)"

// ruleYearsShape canonicalizes the deliberate v2 /api/years contract change:
// v2's spec (api/openapi.yaml listYears) returns [{year, songCount}] scoped
// to songs; v1 returned the bare sorted union of song and album years. Both
// sides are reduced to the sorted bare year set, which stays meaningful for
// the cutover (the web UI re-derives counts client-side per the FF4 list).
var ruleYearsShape = normRule{
	Rule{"SPEC-years-count-objects", "v2 spec (api/openapi.yaml listYears): /api/years returns {year, songCount} objects scoped to songs; v1 returned bare union years"},
	func(v any) any {
		m, ok := v.(map[string]any)
		if !ok {
			return v
		}
		list, ok := m["years"].([]any)
		if !ok {
			return v
		}
		out := make([]any, 0, len(list))
		for _, item := range list {
			if obj, ok := item.(map[string]any); ok {
				out = append(out, obj["year"]) // v2 shape → bare year
			} else {
				out = append(out, item) // v1 shape already bare
			}
		}
		sort.Slice(out, func(i, j int) bool { return fmt.Sprint(out[i]) < fmt.Sprint(out[j]) })
		m["years"] = out
		return m
	},
}

// deleteKeysUnderPath deletes key from every object whose slash path equals
// prefix or sits immediately under a list at prefix (pathPrefix/... only one
// level deep is enough for the adapter playlist payloads).
func deleteKeysUnderPath(v any, prefix, key string) any {
	out := clone(v)
	walk(out, "", func(path string, node any) {
		m, ok := node.(map[string]any)
		if !ok {
			return
		}
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			// Only exact playlist objects, not nested song children.
			if _, isPlaylist := m["owner"]; isPlaylist || m["songCount"] != nil {
				delete(m, key)
			}
		}
	})
	return out
}

// ruleAdapterPlaylistCoverArt drops the playlist-level coverArt that v2's
// adapter computes (first entry's album art) and v1 never emitted. Additive
// OpenSubsonic-standard field — client-beneficial, documented rather than
// removed; the song-level coverArt keys inside entries stay comparable.
var ruleAdapterPlaylistCoverArt = normRule{
	Rule{"P10-adapter-playlist-coverArt", "v2 adapter playlists carry a computed coverArt (first entry's album art); v1's adapter never emitted playlist coverArt — additive Subsonic-standard field, normalized for comparison"},
	func(v any) any {
		return deleteKeysUnderPath(v, "/subsonic-response/playlist", "coverArt")
	},
}

var ruleAdapterPlaylistCoverArtList = normRule{
	Rule{"P10-adapter-playlist-coverArt", "v2 adapter playlists carry a computed coverArt (first entry's album art); v1's adapter never emitted playlist coverArt — additive Subsonic-standard field, normalized for comparison"},
	func(v any) any {
		return deleteKeysUnderPath(v, "/subsonic-response/playlists", "coverArt")
	},
}

// noteInteractionsContract documents that the native interaction POSTs use
// each server's own contract (v1 {entityType, entityId} vs v2's spec'd
// {songId|albumId|artistId}) and asserts the resulting state via the
// read-after-write steps.
var noteInteractionsContract = Rule{"SPEC-interactions-id-keys", "v2 spec (api/openapi.yaml setFavorite/setRating): per-type id keys instead of v1's {entityType, entityId}; same user_* junction semantics — harness drives each contract and compares resulting state"}

// truncateKeyToInt truncates numeric `key` fields toward zero, for the
// duration contract below.
func truncateKeyToInt(v any, key string) any {
	out := clone(v)
	walk(out, "", func(_ string, node any) {
		m, ok := node.(map[string]any)
		if !ok {
			return
		}
		if f, ok := m[key].(float64); ok {
			m[key] = float64(int64(f))
		}
	})
	return out
}

// ruleDurationSeconds truncates fractional duration values on both sides:
// v2's spec (api/openapi.yaml Song.duration) is integer seconds, while v1
// stored music-metadata's float seconds (3.134…) and returned them verbatim
// on the native API. v2 truncates at scan time; the compare truncates v1.
var ruleDurationSeconds = normRule{
	Rule{"SPEC-duration-integer-seconds", "v2 spec (api/openapi.yaml Song.duration): integer seconds; v1 stored music-metadata float seconds (3.134…) — v1 value truncated toward zero for the comparison"},
	func(v any) any { return truncateKeyToInt(v, "duration") },
}

// v1NativeSongTrimKeys are the fields v1's native rowToSong serializer
// (songs/routes.ts) never emits on /api/songs and /api/songs/:id — its list
// AND detail share one trimmed projection. v2's spec'd Song DTO is a
// superset (it returns the full row plus relations). Deleting them on both
// sides keeps every shared field strictly compared.
var v1NativeSongTrimKeys = []string{
	"bitRate", "bitsPerSample", "sampleRate", "channels", "bpm",
	"musicBrainzId", "replayGain", "averageRating", "comment", "sortName",
	"mood", "mediaType", "originalReleaseDate", "releaseDate", "remixOf",
	"displayArtist", "displayAlbumArtist", "genreId", "libraryId",
	"coverArtMissing",
}

var ruleSongV1Trim = normRule{
	Rule{"P10-v1-native-song-trim", "v1's native /api/songs list+detail share one trimmed rowToSong projection (no bitRate/sampleRate/lyrics-adjacent technical fields); v2's spec'd Song DTO is a documented superset — trimmed on both sides, all shared fields still compared"},
	func(v any) any { return deleteKeysAt(v, v1NativeSongTrimKeys...) },
}

// ruleScanStampMtime canonicalizes mtime-derived timestamps: v1's scanner
// writes album cover art INTO audio files (syncSongCoverWithAlbum →
// writeCoverArt), so file mtimes move to scan time and re-imports dance
// around v1's own stamping; v2's scanner is deliberately file-read-only
// (P4b decision). The stored/derived values therefore legitimately differ
// by sub-second (and occasionally whole-second) stamp offsets. created on
// /rest song/album payloads and native mtime are scan-derivatives, not
// catalog facts — canonicalized to a constant; cover-art BYTES still compare
// exactly elsewhere.
var ruleScanStampMtime = normRule{
	Rule{"P10-v1-scan-stamps-files", "v1's scan writes album cover art into the audio files (scanner.ts syncSongCoverWithAlbum), moving mtimes to scan time; v2's scanner is file-read-only — mtime-derived fields (native mtime, /rest created) are canonicalized, cover-art bytes still compared exactly"},
	func(v any) any {
		out := clone(v)
		walk(out, "", func(_ string, node any) {
			m, ok := node.(map[string]any)
			if !ok {
				return
			}
			if _, ok := m["mtime"]; ok {
				m["mtime"] = "SCAN-TIME"
			}
			if s, ok := m["created"].(string); ok && strings.HasPrefix(s, "20") {
				m["created"] = "SCAN-TIME"
			}
		})
		return out
	},
}

// ruleArtistSongsTrim covers v1's /api/artists/:id/songs, which selects an
// even narrower projection than its /api/songs list (no albumArtistName or
// albumName).
var ruleArtistSongsTrim = normRule{
	Rule{"P10-v1-artist-songs-trim", "v1's /api/artists/:id/songs projection omits albumArtistName, albumName and artistName (unlike its /api/songs list); v2 returns the standard song card — trimmed for comparison"},
	func(v any) any { return deleteKeysAt(v, "albumArtistName", "albumName", "artistName") },
}

// ruleGenreAlbumsTrim covers v1's /api/genres/:id/albums projection, which
// omits the explicit flag and genreId that v2's album cards carry.
var ruleGenreAlbumsTrim = normRule{
	Rule{"P10-v1-genre-albums-trim", "v1's /api/genres/:id/albums projection omits the album explicit flag, genreId, shownSongCount, totalSongCount and starred; v2's album card includes them — trimmed for comparison"},
	func(v any) any {
		return deleteKeysAt(v, "explicit", "genreId", "shownSongCount", "totalSongCount", "starred")
	},
}

// ruleNativeLyrics covers v1's plain-lyrics reader quirk: extractPlainLyrics
// takes common.lyrics[0], which is the SYLT entry on SYLT-bearing files, so
// the plain USLT text never reaches v1's DB for those files (v2 reads both).
var ruleNativeLyrics = normRule{
	Rule{"P10-v1-lyrics-first-entry", "v1's reader takes common.lyrics[0] — the SYLT frame on SYLT-bearing files — and drops the plain USLT text (tags/reader.ts extractPlainLyrics; verified against music-metadata's parse in P10); v2 reads both — lyrics keys trimmed on both sides"},
	func(v any) any { return deleteKeysAt(v, "lyrics") },
}

// rulePlaylistWriteTrim: v1's native create/update responses return the
// playlist WITHOUT entries (the detail GET carries them); v2 returns the
// full Detail. The entry-list parity is covered by the detail cases.
var rulePlaylistWriteTrim = normRule{
	Rule{"P10-v1-playlist-write-response", "v1's native playlist create/update responses omit the entries list, songCount, ownerUsername, shares, and carry a flat songIds list v2's spec'd Detail replaces with entries (api/openapi.yaml PlaylistDetail has no songIds); v2 returns the full Detail — trimmed in write responses, compared in detail cases"},
	func(v any) any {
		return deleteKeysAt(v, "entries", "ownerUsername", "songCount", "shares", "songIds", "starred")
	},
}

// rulePlaylistDetailTrim: v1's native playlist DETAIL lacks ownerUsername
// (the list shape has it); v2's Detail carries it uniformly.
var rulePlaylistDetailTrim = normRule{
	Rule{"P10-v1-playlist-detail-trim", "v1's native playlist detail omits ownerUsername (the list projection has it) and includes a flat songIds list alongside entries; v2's Detail carries ownerUsername and no songIds — both trimmed for comparison"},
	func(v any) any { return deleteKeysAt(v, "ownerUsername", "songIds") },
}

// ruleSearchTrim: v1's native /api/search song hits do not attach the
// multi-value genres array (only the scalar genre string); v2 attaches both.
var ruleSearchTrim = normRule{
	Rule{"P10-v1-search-trim", "v1's native search song hits carry no genres array and no syncedLyrics (search/routes.ts attaches artist entries only); v2's search DTO carries both — trimmed on both sides"},
	func(v any) any { return deleteKeysAt(v, "genres", "syncedLyrics") },
}

// noteHomeGenres documents v2's deliberate home-genres deviation (recorded
// in internal/modules/home/service.go): ranked {name, songCount} objects
// instead of v1's alphabetical name union.
var noteHomeGenres = Rule{"P8-home-genres-ranked-objects", "v2 home genres are ranked {name, songCount} objects scoped to in-scope songs (documented deviation in internal/modules/home/service.go); v1 returned the alphabetical name union — compared as name sets"}

// ---------------------------------------------------------------------------
// Canonicalization (applied to BOTH sides — not deltas, just ordering and
// per-run write-time values).
// ---------------------------------------------------------------------------

// sortListsByID sorts every list of objects with an "id" by that id, so
// order differences that carry no meaning do not mask real deltas.
func sortListsByID(v any) any {
	out := clone(v)
	walk(out, "", func(_ string, node any) {
		list, ok := node.([]any)
		if !ok {
			return
		}
		sort.SliceStable(list, func(i, j int) bool {
			mi, oki := list[i].(map[string]any)
			mj, okj := list[j].(map[string]any)
			if !oki || !okj {
				return false
			}
			si, _ := mi["id"].(string)
			sj, _ := mj["id"].(string)
			return si < sj
		})
	})
	return out
}

// canonicalTimestamps replaces write-time timestamp values with "TS" for the
// named keys, anywhere in the tree. Write-time timestamps are generated
// independently per server run and are not part of the parity contract
// (P10 decision; cf. quirks P9b-7 for playlist created/changed formats).
func canonicalTimestamps(keys ...string) func(any) any {
	return func(v any) any {
		out := clone(v)
		walk(out, "", func(_ string, node any) {
			m, ok := node.(map[string]any)
			if !ok {
				return
			}
			for _, k := range keys {
				if _, exists := m[k]; exists {
					m[k] = "TS"
				}
			}
		})
		return out
	}
}

// roundFloats rounds every JSON number to 3 decimals (statistics epsilon,
// P10 decision: allow small float differences in aggregate math).
func roundFloats(v any) any {
	out := clone(v)
	walk(out, "", func(_ string, node any) {
		switch t := node.(type) {
		case map[string]any:
			for k, val := range t {
				if f, ok := val.(float64); ok {
					t[k] = math.Round(f*1000) / 1000
				}
			}
		case []any:
			for i, val := range t {
				if f, ok := val.(float64); ok {
					t[i] = math.Round(f*1000) / 1000
				}
			}
		}
	})
	return out
}

// unwrapSubsonic extracts the "subsonic-response" payload for custom compares.
func unwrapSubsonic(v any) map[string]any {
	m, _ := v.(map[string]any)
	inner, _ := m["subsonic-response"].(map[string]any)
	return inner
}

// ---------------------------------------------------------------------------
// Generic JSON-tree helpers (values are encoding/json shapes).
// ---------------------------------------------------------------------------

// clone deep-copies a JSON value.
func clone(v any) any {
	switch t := v.(type) {
	case map[string]any:
		m := make(map[string]any, len(t))
		for k, val := range t {
			m[k] = clone(val)
		}
		return m
	case []any:
		s := make([]any, len(t))
		for i, val := range t {
			s[i] = clone(val)
		}
		return s
	default:
		return v
	}
}

// walk visits every node of the JSON tree with its slash-separated path.
func walk(v any, path string, visit func(path string, v any)) {
	visit(path, v)
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			walk(t[k], path+"/"+k, visit)
		}
	case []any:
		for i, val := range t {
			walk(val, fmt.Sprintf("%s/%d", path, i), visit)
		}
	}
}

// deleteKeysAt removes the named keys from every object whose path matches
// basePath ("" = root) or which sits under basePath.
func deleteKeysAt(v any, keys ...string) any {
	out := clone(v)
	walk(out, "", func(_ string, node any) {
		m, ok := node.(map[string]any)
		if !ok {
			return
		}
		for _, k := range keys {
			delete(m, k)
		}
	})
	return out
}

// setKeyAt sets key=val on every object in the tree (used to canonicalize
// fields that are allowed to differ, e.g. lastModified).
func setKeyAt(v any, key string, val any) any {
	out := clone(v)
	walk(out, "", func(_ string, node any) {
		if m, ok := node.(map[string]any); ok {
			m[key] = val
		}
	})
	return out
}

// mapKeyAt rewrites key's value through fn on every object in the tree.
func mapKeyAt(v any, key string, fn func(any) any) any {
	out := clone(v)
	walk(out, "", func(_ string, node any) {
		if m, ok := node.(map[string]any); ok {
			if old, ok := m[key]; ok {
				m[key] = fn(old)
			}
		}
	})
	return out
}

// collectKey returns the values of key at every level of the tree, in walk
// order.
func collectKey(v any, key string) []any {
	var out []any
	walk(v, "", func(_ string, node any) {
		if m, ok := node.(map[string]any); ok {
			if val, ok := m[key]; ok {
				out = append(out, val)
			}
		}
	})
	return out
}

// ---------------------------------------------------------------------------
// Deep diff with readable output.
// ---------------------------------------------------------------------------

// diff returns a human-readable list of deltas between two JSON values,
// capped at max entries. An empty result means equal.
func diff(a, b any, max int) []string {
	var out []string
	var rec func(pa, pb string, va, vb any)
	rec = func(pa, pb string, va, vb any) {
		if len(out) >= max {
			return
		}
		switch ta := va.(type) {
		case map[string]any:
			tb, ok := vb.(map[string]any)
			if !ok {
				out = append(out, fmt.Sprintf("%s: type %T vs %T (%v vs %v)", pa, va, vb, va, vb))
				return
			}
			keys := map[string]bool{}
			for k := range ta {
				keys[k] = true
			}
			for k := range tb {
				keys[k] = true
			}
			sorted := make([]string, 0, len(keys))
			for k := range keys {
				sorted = append(sorted, k)
			}
			sort.Strings(sorted)
			for _, k := range sorted {
				ca, oka := ta[k]
				cb, okb := tb[k]
				switch {
				case !oka:
					out = append(out, fmt.Sprintf("%s/%s: missing in v1 (v2=%v)", pa, k, cb))
				case !okb:
					out = append(out, fmt.Sprintf("%s/%s: missing in v2 (v1=%v)", pa, k, ca))
				default:
					rec(pa+"/"+k, pb+"/"+k, ca, cb)
				}
			}
		case []any:
			tb, ok := vb.([]any)
			if !ok {
				out = append(out, fmt.Sprintf("%s: array vs %T (%v vs %v)", pa, vb, va, vb))
				return
			}
			if len(ta) != len(tb) {
				out = append(out, fmt.Sprintf("%s: length %d vs %d", pa, len(ta), len(tb)))
			}
			n := len(ta)
			if len(tb) < n {
				n = len(tb)
			}
			for i := 0; i < n; i++ {
				rec(fmt.Sprintf("%s/%d", pa, i), fmt.Sprintf("%s/%d", pb, i), ta[i], tb[i])
			}
		default:
			if !scalarEqual(va, vb) {
				out = append(out, fmt.Sprintf("%s: %v vs %v", pa, va, vb))
			}
		}
	}
	rec("", "", a, b)
	return out
}

// scalarEqual compares two JSON scalars; numbers compare by float value
// (JSON decoding produces float64 for both sides).
func scalarEqual(a, b any) bool {
	fa, aok := a.(float64)
	fb, bok := b.(float64)
	if aok && bok {
		return fa == fb
	}
	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

// ---------------------------------------------------------------------------
// Id-set extraction (search3, home, lists whose ORDER may differ).
// ---------------------------------------------------------------------------

// idSet extracts the sorted set of string ids from a list of objects.
func idSet(v any) []string {
	list, ok := v.([]any)
	if !ok {
		return nil
	}
	var ids []string
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			if id, ok := m["id"].(string); ok {
				ids = append(ids, id)
			}
		}
	}
	sort.Strings(ids)
	return ids
}

// idSetReport describes how two id sets relate: the sorted union, the
// intersection size and the Jaccard ratio.
type idSetReport struct {
	V1Only              []string `json:"v1Only"`
	V2Only              []string `json:"v2Only"`
	Intersection        int      `json:"intersection"`
	IntersectionRatioV1 float64  `json:"intersectionRatioV1"`
}

func compareIDSets(a, b []string) idSetReport {
	setA := map[string]bool{}
	for _, id := range a {
		setA[id] = true
	}
	setB := map[string]bool{}
	for _, id := range b {
		setB[id] = true
	}
	rep := idSetReport{}
	for _, id := range a {
		if setB[id] {
			rep.Intersection++
		} else {
			rep.V1Only = append(rep.V1Only, id)
		}
	}
	for _, id := range b {
		if !setA[id] {
			rep.V2Only = append(rep.V2Only, id)
		}
	}
	if len(a) > 0 {
		rep.IntersectionRatioV1 = float64(rep.Intersection) / float64(len(a))
	}
	sort.Strings(rep.V1Only)
	sort.Strings(rep.V2Only)
	return rep
}

func keysOf(v any) []string {
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func summary(v any) string {
	switch t := v.(type) {
	case map[string]any:
		return "{" + strings.Join(keysOf(v), ",") + "}"
	case []any:
		return fmt.Sprintf("list[%d]", len(t))
	case nil:
		return "null"
	case string:
		if len(t) > 60 {
			return t[:60] + "…"
		}
		return t
	default:
		return fmt.Sprintf("%v", t)
	}
}
