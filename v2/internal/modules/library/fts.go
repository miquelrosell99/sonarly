// FTS index maintenance. The FTS5 tables (migration 0003) are regular
// (self-contained) FTS5 tables keyed by the content row's rowid, so keeping
// them in step with the catalog is a matter of rewriting the touched rows'
// index entries in the same transaction that writes the rows. Every writer
// goes through persistSongTx (scanner and ingest share it — the one data
// path), so the song/album/artist rows a persist touches get synced there;
// the scanner's deactivation pass removes the index rows for songs that
// leave the catalog. All writes are INSERT OR REPLACE / DELETE keyed by
// rowid: idempotent and cheap to re-run.
package library

import (
	"context"
	"fmt"
)

// rowidByID resolves the integer rowid of a content row. The FTS tables
// index by rowid, not by the TEXT primary key.
func rowidByID(ctx context.Context, ex execer, table, id string) (int64, error) {
	var rowid int64
	if err := ex.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT rowid FROM %s WHERE id = ?`, table), id).Scan(&rowid); err != nil {
		return 0, fmt.Errorf("resolve %s rowid: %w", table, err)
	}
	return rowid, nil
}

// syncSongFTS rewrites the search index entry for one song. Called from
// persistSongTx with the row's final title, so re-scans, renames-by-rescan
// and reactivations all converge on the same INSERT OR REPLACE.
func syncSongFTS(ctx context.Context, ex execer, songID, title string) error {
	rowid, err := rowidByID(ctx, ex, "songs", songID)
	if err != nil {
		return err
	}
	if _, err := ex.ExecContext(ctx,
		`INSERT OR REPLACE INTO songs_fts (rowid, title) VALUES (?, ?)`, rowid, title); err != nil {
		return fmt.Errorf("sync song fts: %w", err)
	}
	return nil
}

// syncAlbumFTS rewrites the album's index entry (name + denormalized album
// artist text — the persist tx knows both).
func syncAlbumFTS(ctx context.Context, ex execer, albumID, name, artistName string) error {
	rowid, err := rowidByID(ctx, ex, "albums", albumID)
	if err != nil {
		return err
	}
	if _, err := ex.ExecContext(ctx,
		`INSERT OR REPLACE INTO albums_fts (rowid, name, artist_name) VALUES (?, ?, ?)`,
		rowid, name, artistName); err != nil {
		return fmt.Errorf("sync album fts: %w", err)
	}
	return nil
}

// syncArtistFTS rewrites the artist's index entry.
func syncArtistFTS(ctx context.Context, ex execer, artistID, name string) error {
	rowid, err := rowidByID(ctx, ex, "artists", artistID)
	if err != nil {
		return err
	}
	if _, err := ex.ExecContext(ctx,
		`INSERT OR REPLACE INTO artists_fts (rowid, name) VALUES (?, ?)`, rowid, name); err != nil {
		return fmt.Errorf("sync artist fts: %w", err)
	}
	return nil
}

// DeleteSongFTS removes a song from the search index. Called from the
// scanner's deactivation transaction for every song that leaves the catalog
// (a file that vanished): the search index stays sized to the live library
// instead of accumulating dead rows across rescans. Deleting a rowid the
// index lacks is a no-op on this FTS5 build.
func DeleteSongFTS(ctx context.Context, ex execer, songRowID int64) error {
	if _, err := ex.ExecContext(ctx,
		`DELETE FROM songs_fts WHERE rowid = ?`, songRowID); err != nil {
		return fmt.Errorf("delete song fts: %w", err)
	}
	return nil
}
