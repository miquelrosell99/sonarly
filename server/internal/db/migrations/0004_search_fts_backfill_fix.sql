-- P10b follow-up: idempotent full-corpus FTS backfill.
--
-- 0003's initial backfill populates fresh-migrated legacy databases correctly
-- (verified against the production snapshot), but it ran while 0003 was
-- applied, and databases that already recorded 0003 never re-run it. Any
-- catalog rows that reached the database with the FTS sync bypassed (raw
-- inserts, test seeding, a future writer bug) therefore stay invisible to
-- /api/search until something re-persists them. This migration re-asserts
-- the invariant "the indexes mirror the active corpus" on every database:
-- existing dev databases get it from the ledger, fresh ones run it right
-- after 0003's backfill.
--
-- INSERT OR REPLACE keyed by rowid over the active rows only is idempotent
-- under re-runs (spike-verified on the modernc.org/sqlite FTS5 build; the
-- tables are regular, self-contained FTS5 tables, not external-content) and
-- tolerates legacy-shaped data: the indexed columns are all TEXT and the album
-- projection COALESCEs the nullable denormalized artist_name. Removals stay
-- the writers' job — the scanner deletes index rows on deactivation — so a
-- re-run never re-adds a deactivated row; it only (re)writes active ones.
INSERT OR REPLACE INTO songs_fts (rowid, title)
  SELECT rowid, title FROM songs WHERE active = 1;

INSERT OR REPLACE INTO albums_fts (rowid, name, artist_name)
  SELECT rowid, name, COALESCE(artist_name, '') FROM albums WHERE active = 1;

INSERT OR REPLACE INTO artists_fts (rowid, name)
  SELECT rowid, name FROM artists WHERE active = 1;
