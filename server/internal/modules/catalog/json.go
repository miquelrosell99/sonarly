package catalog

import (
	"database/sql"
	"encoding/json"
)

// JSON column parsing is defensive per audit Q6: the old row mappers called
// JSON.parse directly, so one malformed column 500'd the whole list. Here a
// malformed JSON column yields the zero value and false — the caller omits
// the field from the DTO and the row still serializes.

// parseStringArrayColumn parses a JSON text column holding an array of
// strings (producers, isrcs, catalog_numbers, ...).
func parseStringArrayColumn(raw sql.NullString) ([]string, bool) {
	if !raw.Valid || raw.String == "" {
		return nil, false
	}
	var out []string
	if err := json.Unmarshal([]byte(raw.String), &out); err != nil {
		return nil, false
	}
	return out, true
}

// parseAnyColumn parses a JSON text column of arbitrary shape (synced
// lyrics, external_urls, ...).
func parseAnyColumn(raw sql.NullString) (any, bool) {
	if !raw.Valid || raw.String == "" {
		return nil, false
	}
	var out any
	if err := json.Unmarshal([]byte(raw.String), &out); err != nil {
		return nil, false
	}
	return out, true
}
