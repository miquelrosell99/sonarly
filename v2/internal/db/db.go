// Package db owns the SQLite connection and schema migrations.
package db

import (
	"context"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open opens the SQLite database and applies the pragmas Sonarly relies on:
// WAL journaling, foreign keys enforced, a busy timeout so the API and any
// background worker tolerate write collisions, and memory-mapped I/O.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=mmap_size(268435456)", path)
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := database.PingContext(ctx); err != nil {
		database.Close()
		return nil, err
	}
	// SQLite allows one writer; a single connection avoids SQLITE_BUSY
	// surprises between statements of one logical operation.
	database.SetMaxOpenConns(1)
	return database, nil
}
