ALTER TABLE songs ADD COLUMN library_id TEXT REFERENCES libraries(id) ON DELETE SET NULL;

UPDATE songs
SET library_id = (
  SELECT id
  FROM libraries
  WHERE substr(songs.file_path, 1, length(libraries.path)) = libraries.path
  ORDER BY length(libraries.path) DESC
  LIMIT 1
);
