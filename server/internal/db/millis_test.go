package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMillisScan(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		src  any
		want Millis
	}{
		{"nil", nil, 0},
		{"integer", int64(1790354785324), Millis(1790354785324)},
		{"fractional real legacy mtimeMs", 1790354785324.7063, Millis(1790354785324)},
		{"real integral", float64(42), Millis(42)},
		{"text integer", []byte("1790354785324"), Millis(1790354785324)},
		{"text real", []byte("1790354785324.7063"), Millis(1790354785324)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var m Millis
			if err := m.Scan(tc.src); err != nil {
				t.Fatalf("Scan(%v): %v", tc.src, err)
			}
			if m != tc.want {
				t.Fatalf("Scan(%v) = %d, want %d", tc.src, m, tc.want)
			}
		})
	}
}

func TestMillisScanRejectsGarbage(t *testing.T) {
	t.Parallel()
	var m Millis
	if err := m.Scan("not-a-number"); err == nil {
		t.Fatal("expected error scanning garbage text")
	}
	if err := m.Scan(struct{}{}); err == nil {
		t.Fatal("expected error scanning unsupported type")
	}
}

func TestNullMillis(t *testing.T) {
	t.Parallel()
	var n NullMillis
	if err := n.Scan(nil); err != nil {
		t.Fatalf("Scan(nil): %v", err)
	}
	if n.Valid {
		t.Fatal("NULL must scan as Valid=false")
	}
	if err := n.Scan(1790354785324.7063); err != nil {
		t.Fatalf("Scan(real): %v", err)
	}
	v, ok := n.Value()
	if !ok || v != 1790354785324 {
		t.Fatalf("Int64() = %d,%v, want 1790354785324,true", v, ok)
	}
}

// TestMillisAgainstRealColumn reproduces the P10 parity-suite failure mode:
// a database created by the retired TypeScript server stores songs.mtime as fractional REALs (better-
// sqlite3 bound stat.mtimeMs, a JS float), and every song query used to
// fail with "converting driver.Value type float64 to a int64".
func TestMillisAgainstRealColumn(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	database, err := Open(ctx, filepath.Join(t.TempDir(), "millis.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer database.Close()

	if _, err := database.Exec(`CREATE TABLE songs (id TEXT PRIMARY KEY, mtime)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO songs VALUES ('a', 1790354785324.7063), ('b', 1790354785325), ('c', NULL)`); err != nil {
		t.Fatalf("insert: %v", err)
	}

	rows, err := database.QueryContext(ctx, `SELECT id, mtime FROM songs ORDER BY id`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	got := map[string]NullMillis{}
	for rows.Next() {
		var id string
		var m NullMillis
		if err := rows.Scan(&id, &m); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got[id] = m
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if v, _ := got["a"].Value(); v != 1790354785324 {
		t.Fatalf("fractional REAL = %d, want truncated 1790354785324", v)
	}
	if v, _ := got["b"].Value(); v != 1790354785325 {
		t.Fatalf("INTEGER = %d, want 1790354785325", v)
	}
	if got["c"].Valid {
		t.Fatal("NULL must stay invalid")
	}
}
