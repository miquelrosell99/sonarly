CREATE TABLE IF NOT EXISTS user_albums (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  PRIMARY KEY (user_id, album_id)
);

CREATE TABLE IF NOT EXISTS user_artists (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  PRIMARY KEY (user_id, artist_id)
);

CREATE TABLE IF NOT EXISTS user_playlists (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  PRIMARY KEY (user_id, playlist_id)
);
