-- Baseline schema distilled from the pre-rewrite migration chain 001–049 (see docs/audits/2026-09-24-backend-architecture-audit.md)
-- plus audit schema fixes: FKs on user_libraries, UNIQUE genres.name, FK-child indexes.
--
-- Notes on distillation choices:
--   * Data-only migrations (021/024/025/026/028 splits/032/033/037/039/041/047/049 rewrites)
--     carry no structural residue and are intentionally absent.
--   * ingest_jobs keeps the post-038 shape: source_path is NOT NULL but no longer UNIQUE
--     (038's rebuild dropped it; the pre-rewrite ingest repository inserted plain rows across runs).
--   * albums/songs cover_art_id FKs had no ON DELETE action pre-rewrite (NO ACTION); written
--     explicitly here with identical semantics.
--   * rating columns are REAL (042 half-ratings rebuild), not INTEGER.

-- ---------------------------------------------------------------------------
-- Identity, sessions, settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  subsonic_password_encrypted TEXT,
  name TEXT,
  surname TEXT,
  email TEXT,
  avatar_path TEXT,
  max_bitrate_kbps INTEGER,
  transcode_format TEXT,
  hide_explicit INTEGER NOT NULL DEFAULT 0,
  blur_explicit_titles INTEGER NOT NULL DEFAULT 0,
  blur_explicit_covers INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferences TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Music metadata
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  artist_image_url TEXT,
  artist_image_local_path TEXT,
  musicbrainz_artist_ids TEXT,
  bio TEXT,
  external_urls TEXT
);

CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_name_unique ON artists(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_artists_active ON artists(active);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  label_image_url TEXT,
  label_image_local_path TEXT,
  musicbrainz_label_ids TEXT,
  bio TEXT,
  external_urls TEXT
);

CREATE INDEX IF NOT EXISTS idx_labels_name ON labels(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_name_unique ON labels(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_labels_active ON labels(active);

CREATE TABLE IF NOT EXISTS genres (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  parent_id TEXT REFERENCES genres(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_genres_name ON genres(name);
-- Audit fix: genres.name UNIQUE (NOCASE), matching artists.name / labels.name style.
CREATE UNIQUE INDEX IF NOT EXISTS idx_genres_name_unique ON genres(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_genres_parent ON genres(parent_id);

CREATE TABLE IF NOT EXISTS cover_arts (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  data BLOB NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cover_arts_hash ON cover_arts(hash);

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
  artist_name TEXT,
  year INTEGER,
  genre TEXT,
  genre_id TEXT REFERENCES genres(id) ON DELETE SET NULL,
  cover_art_id TEXT REFERENCES cover_arts(id) ON DELETE NO ACTION,
  active INTEGER NOT NULL DEFAULT 1,
  catalog_numbers TEXT,
  barcode TEXT,
  asin TEXT,
  musicbrainz_album_id TEXT,
  musicbrainz_release_group_id TEXT,
  musicbrainz_album_artist_ids TEXT,
  original_year INTEGER,
  compilation INTEGER,
  total_tracks TEXT,
  total_discs TEXT,
  release_type TEXT
);

CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_active ON albums(active);
CREATE INDEX IF NOT EXISTS idx_albums_genre_id ON albums(genre_id);
CREATE INDEX IF NOT EXISTS idx_albums_name ON albums(name);

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  file_path TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL COLLATE NOCASE,
  track_number INTEGER,
  disc_number INTEGER,
  duration INTEGER,
  artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
  album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
  genre TEXT,
  genre_id TEXT REFERENCES genres(id) ON DELETE SET NULL,
  year INTEGER,
  mtime INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  explicit INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  cover_art_id TEXT REFERENCES cover_arts(id) ON DELETE NO ACTION,
  cover_art_missing INTEGER NOT NULL DEFAULT 0,
  bit_rate INTEGER,
  bits_per_sample INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  bpm INTEGER,
  music_brainz_id TEXT,
  replay_gain REAL,
  average_rating REAL,
  comment TEXT,
  sort_name TEXT,
  mood TEXT,
  media_type TEXT,
  original_release_date TEXT,
  release_date TEXT,
  remix_of TEXT,
  display_artist TEXT,
  display_album_artist TEXT,
  lyrics TEXT,
  synced_lyrics TEXT,
  producers TEXT,
  isrcs TEXT,
  musicbrainz_track_id TEXT,
  musicbrainz_work_id TEXT,
  musicbrainz_disc_id TEXT,
  original_year INTEGER,
  original_artist TEXT,
  gapless INTEGER,
  total_tracks TEXT,
  total_discs TEXT,
  library_id TEXT REFERENCES libraries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_id);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_active ON songs(active);
CREATE INDEX IF NOT EXISTS idx_songs_genre_id ON songs(genre_id);
CREATE INDEX IF NOT EXISTS idx_songs_checksum ON songs(checksum);
CREATE INDEX IF NOT EXISTS idx_songs_library_id ON songs(library_id);

-- ---------------------------------------------------------------------------
-- Junction tables (multi-value artists / genres / composers / labels)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS song_artists (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (song_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_song_artists_song ON song_artists(song_id);
CREATE INDEX IF NOT EXISTS idx_song_artists_artist ON song_artists(artist_id);

CREATE TABLE IF NOT EXISTS album_artists (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_album_artists_album ON album_artists(album_id);
CREATE INDEX IF NOT EXISTS idx_album_artists_artist ON album_artists(artist_id);

CREATE TABLE IF NOT EXISTS song_genres (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  genre_id TEXT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (song_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_song_genres_song ON song_genres(song_id);
CREATE INDEX IF NOT EXISTS idx_song_genres_genre ON song_genres(genre_id);

CREATE TABLE IF NOT EXISTS album_genres (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  genre_id TEXT NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_album_genres_album ON album_genres(album_id);
CREATE INDEX IF NOT EXISTS idx_album_genres_genre ON album_genres(genre_id);

CREATE TABLE IF NOT EXISTS song_composers (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (song_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_song_composers_song ON song_composers(song_id);
CREATE INDEX IF NOT EXISTS idx_song_composers_artist ON song_composers(artist_id);

CREATE TABLE IF NOT EXISTS album_labels (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_album_labels_album ON album_labels(album_id);
CREATE INDEX IF NOT EXISTS idx_album_labels_label ON album_labels(label_id);

-- ---------------------------------------------------------------------------
-- Libraries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  organize_pattern TEXT NOT NULL DEFAULT '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}',
  is_default INTEGER NOT NULL DEFAULT 0
);

-- Audit fix: real FKs on user_libraries (the pre-rewrite schema had none, orphaning rows on delete).
CREATE TABLE IF NOT EXISTS user_libraries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, library_id)
);

CREATE INDEX IF NOT EXISTS idx_user_libraries_library_id ON user_libraries(library_id);

-- ---------------------------------------------------------------------------
-- Per-user interaction state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_songs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  PRIMARY KEY (user_id, song_id)
);

-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_user_songs_song ON user_songs(song_id);

CREATE TABLE IF NOT EXISTS user_albums (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  PRIMARY KEY (user_id, album_id)
);

-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_user_albums_album ON user_albums(album_id);

CREATE TABLE IF NOT EXISTS user_artists (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  PRIMARY KEY (user_id, artist_id)
);

-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_user_artists_artist ON user_artists(artist_id);

CREATE TABLE IF NOT EXISTS user_playlists (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  PRIMARY KEY (user_id, playlist_id)
);

-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_user_playlists_playlist ON user_playlists(playlist_id);

-- ---------------------------------------------------------------------------
-- Playlists
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'private',
  share_token TEXT UNIQUE,
  is_smart INTEGER NOT NULL DEFAULT 0,
  rules_json TEXT,
  description TEXT,
  resolve_mode TEXT NOT NULL DEFAULT 'tracks',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, song_id)
);

-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_playlist_songs_song ON playlist_songs(song_id);

CREATE TABLE IF NOT EXISTS playlist_shares (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, user_id)
);

-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_playlist_shares_user ON playlist_shares(user_id);

-- ---------------------------------------------------------------------------
-- Listening history and bookmarks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listening_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  played_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_listened INTEGER,
  completion REAL,
  client TEXT,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_listening_history_user_played_at ON listening_history(user_id, played_at);
CREATE INDEX IF NOT EXISTS idx_listening_history_song ON listening_history(song_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
-- Audit fix: index FK-cascade child column (the pre-rewrite schema lacked it).
CREATE INDEX IF NOT EXISTS idx_bookmarks_song ON bookmarks(song_id);

-- ---------------------------------------------------------------------------
-- Background jobs and uploads
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scan_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  finished_at TEXT,
  stats TEXT,
  error TEXT
);

-- Post-038 shape: run_id batches; source_path intentionally NOT UNIQUE (see header note).
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  target_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  duplicate INTEGER DEFAULT 0,
  duplicate_strategy TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_run_id ON ingest_jobs(run_id);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  duplicate_strategy TEXT
);
