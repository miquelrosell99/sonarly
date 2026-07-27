-- Artist MusicBrainz identifiers (multi-value, stored as JSON array)
ALTER TABLE artists ADD COLUMN musicbrainz_artist_ids TEXT;

-- Multi-value track artists
CREATE TABLE IF NOT EXISTS song_artists (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (song_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_song_artists_song ON song_artists(song_id);
CREATE INDEX IF NOT EXISTS idx_song_artists_artist ON song_artists(artist_id);

-- Multi-value album artists
CREATE TABLE IF NOT EXISTS album_artists (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_album_artists_album ON album_artists(album_id);
CREATE INDEX IF NOT EXISTS idx_album_artists_artist ON album_artists(artist_id);

-- Song-level rich metadata
ALTER TABLE songs ADD COLUMN composers TEXT;
ALTER TABLE songs ADD COLUMN producers TEXT;
ALTER TABLE songs ADD COLUMN isrcs TEXT;
ALTER TABLE songs ADD COLUMN musicbrainz_track_id TEXT;
ALTER TABLE songs ADD COLUMN musicbrainz_work_id TEXT;
ALTER TABLE songs ADD COLUMN musicbrainz_disc_id TEXT;
ALTER TABLE songs ADD COLUMN original_year INTEGER;
ALTER TABLE songs ADD COLUMN original_artist TEXT;
ALTER TABLE songs ADD COLUMN gapless INTEGER;
ALTER TABLE songs ADD COLUMN total_tracks TEXT;
ALTER TABLE songs ADD COLUMN total_discs TEXT;

-- Album-level rich metadata
ALTER TABLE albums ADD COLUMN labels TEXT;
ALTER TABLE albums ADD COLUMN catalog_numbers TEXT;
ALTER TABLE albums ADD COLUMN barcode TEXT;
ALTER TABLE albums ADD COLUMN asin TEXT;
ALTER TABLE albums ADD COLUMN musicbrainz_album_id TEXT;
ALTER TABLE albums ADD COLUMN musicbrainz_release_group_id TEXT;
ALTER TABLE albums ADD COLUMN musicbrainz_album_artist_ids TEXT;
ALTER TABLE albums ADD COLUMN original_year INTEGER;
ALTER TABLE albums ADD COLUMN compilation INTEGER;
ALTER TABLE albums ADD COLUMN total_tracks TEXT;
ALTER TABLE albums ADD COLUMN total_discs TEXT;

-- Seed junction tables from existing single-valued artist relationships
INSERT INTO song_artists (song_id, artist_id, position)
SELECT id, artist_id, 0 FROM songs WHERE artist_id IS NOT NULL
ON CONFLICT(song_id, artist_id) DO NOTHING;

INSERT INTO album_artists (album_id, artist_id, position)
SELECT id, artist_id, 0 FROM albums WHERE artist_id IS NOT NULL
ON CONFLICT(album_id, artist_id) DO NOTHING;
