-- 0006_share_download
--
-- Link-share download permission. playlists.share_download gates whether a
-- playlist's share token may fetch binaries: the ZIP pack endpoint
-- (POST /api/download?shareToken=...) and single-track downloads
-- (GET /api/stream/:id?download=1&share=...). Off by default so every
-- existing link keeps its stream-only access; owners opt in per link.
--
-- The schema_migrations ledger runs each file exactly once, which is the
-- idempotency guarantee (same convention as 0002's ALTER TABLE additions);
-- a fresh database gets the column from this migration, never from 0001.

ALTER TABLE playlists ADD COLUMN share_download INTEGER NOT NULL DEFAULT 0;
