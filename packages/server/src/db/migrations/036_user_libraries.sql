CREATE TABLE IF NOT EXISTS user_libraries (
  user_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, library_id)
);

CREATE INDEX IF NOT EXISTS idx_user_libraries_library_id ON user_libraries(library_id);
