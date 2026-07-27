-- Multi-value track genres
CREATE TABLE IF NOT EXISTS song_genres (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  genre_id TEXT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (song_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_song_genres_song ON song_genres(song_id);
CREATE INDEX IF NOT EXISTS idx_song_genres_genre ON song_genres(genre_id);

-- Multi-value album genres
CREATE TABLE IF NOT EXISTS album_genres (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  genre_id TEXT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_album_genres_album ON album_genres(album_id);
CREATE INDEX IF NOT EXISTS idx_album_genres_genre ON album_genres(genre_id);

-- Seed junction tables from existing single-valued genre relationships
INSERT INTO song_genres (song_id, genre_id, position)
SELECT id, genre_id, 0 FROM songs WHERE genre_id IS NOT NULL
ON CONFLICT(song_id, genre_id) DO NOTHING;

INSERT INTO album_genres (album_id, genre_id, position)
SELECT id, genre_id, 0 FROM albums WHERE genre_id IS NOT NULL
ON CONFLICT(album_id, genre_id) DO NOTHING;
