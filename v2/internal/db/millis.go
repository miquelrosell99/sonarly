package db

import (
	"fmt"
	"strconv"
)

// Int64 is an int64 that tolerates v1-written fractional REAL values. v1's
// scanner stored raw JS floats via better-sqlite3 — stat.mtimeMs (fractional
// milliseconds), music-metadata's duration (fractional seconds) and, in
// principle, any format integer — which SQLite persisted as REALs. v2 reads
// with modernc.org/sqlite, which returns REALs as float64 and refuses to
// convert them into int64, so a v1-created database made numeric scans fail
// with "converting driver.Value type float64 ... invalid syntax". Truncating
// the fraction matches v2's own integer-second/integer-milli semantics and
// loses nothing the scanners compare.
type Int64 int64

// Scan implements sql.Scanner.
func (n *Int64) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*n = 0
	case int64:
		*n = Int64(v)
	case float64:
		*n = Int64(v)
	case []byte:
		f, err := strconv.ParseFloat(string(v), 64)
		if err != nil {
			return fmt.Errorf("db: cannot scan %q into Int64: %w", string(v), err)
		}
		*n = Int64(f)
	default:
		return fmt.Errorf("db: cannot scan %T into Int64", src)
	}
	return nil
}

// NullInt64 is the nullable companion for nullable numeric columns.
type NullInt64 struct {
	Int64 Int64
	Valid bool
}

// Scan implements sql.Scanner.
func (n *NullInt64) Scan(src any) error {
	if src == nil {
		n.Int64, n.Valid = 0, false
		return nil
	}
	n.Valid = true
	return n.Int64.Scan(src)
}

// Value returns the truncated value and whether the column was non-NULL.
func (n NullInt64) Value() (int64, bool) {
	return int64(n.Int64), n.Valid
}

// Millis is Int64 at millisecond-unit call sites (mtimes): the truncation
// matches Go's time.Time.UnixMilli.
type Millis = Int64

// NullMillis is NullInt64 at millisecond-unit call sites.
type NullMillis = NullInt64
