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
