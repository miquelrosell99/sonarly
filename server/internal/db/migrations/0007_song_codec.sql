-- 0007_song_codec
--
-- Song stream codec + Dolby Atmos flag. codec is the display codec the
-- hand-rolled properties probe derives from the container (FLAC/Vorbis/
-- Opus/MP3, or the MP4 stsd mapping: fLaC|flac/alac/ec-3/ac-3/Opus/mp4a-esds);
-- NULL means "not yet probed" (rows written before this migration, or a
-- probe failure). atmos marks true Dolby Atmos: E-AC-3 with the JOC
-- configuration (dec3 num_dep_sub > 0). Both are filled by any full
-- (re-)import through PersistSong; a deep scan re-reads untouched files so
-- existing rows backfill without waiting for an mtime change.
--
-- The schema_migrations ledger runs each file exactly once, which is the
-- idempotency guarantee (same convention as 0006's ALTER TABLE additions);
-- a fresh database gets the columns from this migration, never from 0001.

ALTER TABLE songs ADD COLUMN codec TEXT;

ALTER TABLE songs ADD COLUMN atmos INTEGER NOT NULL DEFAULT 0;
