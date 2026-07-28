-- Support half-star ratings (0.5 increments) by changing rating columns from INTEGER to REAL.
-- SQLite does not support ALTER COLUMN, so recreate the four user_* interaction tables.

CREATE TABLE _user_songs_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  PRIMARY KEY (user_id, song_id)
);

INSERT INTO _user_songs_new SELECT user_id, song_id, starred, rating, play_count, last_played FROM user_songs;

DROP TABLE user_songs;
ALTER TABLE _user_songs_new RENAME TO user_songs;

CREATE TABLE _user_albums_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  PRIMARY KEY (user_id, album_id)
);

INSERT INTO _user_albums_new SELECT user_id, album_id, starred, rating FROM user_albums;

DROP TABLE user_albums;
ALTER TABLE _user_albums_new RENAME TO user_albums;

CREATE TABLE _user_artists_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  PRIMARY KEY (user_id, artist_id)
);

INSERT INTO _user_artists_new SELECT user_id, artist_id, starred, rating FROM user_artists;

DROP TABLE user_artists;
ALTER TABLE _user_artists_new RENAME TO user_artists;

CREATE TABLE _user_playlists_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  PRIMARY KEY (user_id, playlist_id)
);

INSERT INTO _user_playlists_new SELECT user_id, playlist_id, starred, rating FROM user_playlists;

DROP TABLE user_playlists;
ALTER TABLE _user_playlists_new RENAME TO user_playlists;
