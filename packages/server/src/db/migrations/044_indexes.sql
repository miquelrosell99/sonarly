CREATE INDEX IF NOT EXISTS idx_songs_checksum ON songs(checksum);
CREATE INDEX IF NOT EXISTS idx_songs_library_id ON songs(library_id);
CREATE INDEX IF NOT EXISTS idx_albums_name ON albums(name);
