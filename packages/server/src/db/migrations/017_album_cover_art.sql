CREATE TABLE IF NOT EXISTS cover_arts (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  data BLOB NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cover_arts_hash ON cover_arts(hash);

ALTER TABLE albums ADD COLUMN cover_art_id TEXT REFERENCES cover_arts(id);
ALTER TABLE songs ADD COLUMN cover_art_id TEXT REFERENCES cover_arts(id);

-- Reset old cover art references so the new full-cycle sync can repopulate them.
UPDATE albums SET cover_art_id = NULL;
UPDATE songs SET cover_art_id = NULL;
