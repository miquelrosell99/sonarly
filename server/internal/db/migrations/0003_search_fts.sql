-- FTS5 search indexes (P8, plan/DR-2): replaces the pre-rewrite leading-wildcard LIKE
-- full scans with prefix-matchable full-text indexes.
--
-- The tables are REGULAR (self-contained) FTS5 tables keyed by the content
-- row's rowid. Two deliberate choices, spike-verified on modernc.org/sqlite:
--
--   * NOT external-content tables: on this FTS5 build, DELETE-by-rowid of a
--     row the index doesn't contain reports SQLITE_CORRUPT, and INSERT OR
--     REPLACE duplicates entries instead of replacing — both make
--     incremental maintenance unworkable. Regular tables take INSERT OR
--     REPLACE and no-op deletes correctly. The cost is a second copy of the
--     indexed text (title/name), trivial at music-library scale.
--   * Maintained by explicit statements in the transactions that write the
--     content rows: library.PersistSong syncs the song/album/artist rows it
--     touches, and the scanner's deactivation pass removes songs that leave
--     the catalog. Reactivation re-inserts through PersistSong's sync.

CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
  title,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS albums_fts USING fts5(
  name,
  artist_name,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS artists_fts USING fts5(
  name,
  tokenize='unicode61'
);

-- Backfill for databases that already hold a library. INSERT OR REPLACE
-- keyed by rowid is idempotent under re-runs (verified against the FTS5
-- build in use) and indexes only active rows.
INSERT OR REPLACE INTO songs_fts (rowid, title)
  SELECT rowid, title FROM songs WHERE active = 1;

INSERT OR REPLACE INTO albums_fts (rowid, name, artist_name)
  SELECT rowid, name, COALESCE(artist_name, '') FROM albums WHERE active = 1;

INSERT OR REPLACE INTO artists_fts (rowid, name)
  SELECT rowid, name FROM artists WHERE active = 1;
