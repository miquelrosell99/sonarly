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
	// Keep the one connection pooled forever: with MaxOpenConns(1) there is
	// never a second connection to reclaim, and for the in-memory test
	// database a fresh connection would be an empty database.
	database.SetMaxIdleConns(1)
	return database, nil
}

// OpenInMemory opens a private, migrated, in-memory database. It exists for
// tests, which get a throwaway schema in microseconds without touching disk.
// Callers own closing the handle.
func OpenInMemory(ctx context.Context) (*sql.DB, error) {
	database, err := Open(ctx, ":memory:")
	if err != nil {
		return nil, err
	}
	if err := Migrate(ctx, database); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}
