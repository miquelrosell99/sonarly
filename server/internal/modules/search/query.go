// Package search is the catalog search domain (P8): prefix full-text search
// over songs, albums and artists through the FTS5 indexes maintained by
// library.PersistSong, plus name-LIKE search over playlists. It replaces
// the old leading-wildcard LIKE scans (audit finding; plan/DR-2 prescribes
// FTS5).
//
// Deviations from the retired server, deliberate and documented:
//
//   - Songs match on title only. the retired server also matched the song's artist and album
//     names inside the songs category; with per-category indexes those
//     matches surface in their own categories instead, and the FTS table for
//     songs indexes title only (migration 0003).
//   - hideExplicit comes from the query string, not the stored user
//     preference. The Go server catalog endpoints follow the same convention; clients
//     that honor the preference pass it explicitly.
//   - The untyped "limit+1" trick that fed the old has-more indicators is gone:
//     limits clamp to [1, maxCategoryResults] and the response carries no
//     hasMore flags.
//   - An FTS syntax error (a query string of specials that survives
//     escaping) degrades to a LIKE prefix query instead of failing the
//     request; a query with no usable tokens returns empty categories.
//   - Playlist search matches the old visibility rule (owner, public, or
//     shared) — the same policy the playlists module enforces.
package search

import (
	"strings"
)

// maxCategoryResults caps every category the way the old MAX_CATEGORY_RESULTS
// did; without an explicit type the per-category default is defaultPerType.
const (
	maxCategoryResults = 250
	defaultPerType     = 5
)

// ftsQuery converts free text into a safe FTS5 MATCH expression: every
// whitespace-separated token becomes a quoted phrase (embedded quotes
// doubled, so FTS5 specials like ( ) : * are inert inside the quotes) and
// the LAST token gets the prefix star. It reports false when nothing
// tokenizable remains — the caller answers empty rather than MATCH '*',
// which would return the whole index.
func ftsQuery(input string) (string, bool) {
	parts := strings.Fields(input)
	tokens := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.Trim(p, `"`)
		if p == "" {
			continue
		}
		tokens = append(tokens, `"`+strings.ReplaceAll(p, `"`, `""`)+`"`)
	}
	if len(tokens) == 0 {
		return "", false
	}
	tokens[len(tokens)-1] += "*"
	return strings.Join(tokens, " "), true
}

// likeEscape escapes the two LIKE wildcards so user text matches literally;
// callers append their own % and add ESCAPE '\'.
func likeEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// likePrefixPattern is the old likePattern with the wildcard anchored at the
// end only: prefix matching, no leading scan.
func likePrefixPattern(query string) string {
	return likeEscape(query) + `%`
}
