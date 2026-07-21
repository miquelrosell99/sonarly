CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_name_unique ON artists(name COLLATE NOCASE);
