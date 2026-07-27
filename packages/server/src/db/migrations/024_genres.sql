CREATE TABLE IF NOT EXISTS genres (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  parent_id TEXT REFERENCES genres(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_genres_name ON genres(name);
CREATE INDEX IF NOT EXISTS idx_genres_parent ON genres(parent_id);

ALTER TABLE songs ADD COLUMN genre_id TEXT REFERENCES genres(id) ON DELETE SET NULL;
ALTER TABLE albums ADD COLUMN genre_id TEXT REFERENCES genres(id) ON DELETE SET NULL;

-- Migrate existing text genres into the new relational table.
INSERT INTO genres (id, name, active)
SELECT lower(hex(randomblob(16))), TRIM(genre), 1
FROM (
  SELECT DISTINCT genre FROM songs WHERE genre IS NOT NULL AND genre <> ''
  UNION
  SELECT DISTINCT genre FROM albums WHERE genre IS NOT NULL AND genre <> ''
)
WHERE NOT EXISTS (SELECT 1 FROM genres WHERE name = TRIM(genre) COLLATE NOCASE);

UPDATE songs SET genre_id = (
  SELECT id FROM genres WHERE name = songs.genre COLLATE NOCASE
) WHERE genre IS NOT NULL AND genre <> '';

UPDATE albums SET genre_id = (
  SELECT id FROM genres WHERE name = albums.genre COLLATE NOCASE
) WHERE genre IS NOT NULL AND genre <> '';

CREATE INDEX IF NOT EXISTS idx_songs_genre_id ON songs(genre_id);
CREATE INDEX IF NOT EXISTS idx_albums_genre_id ON albums(genre_id);
