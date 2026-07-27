-- Split existing artists whose names contain semicolons into separate artist rows.
-- This fixes data created before the tag reader started splitting multi-value
-- artist tags reliably. New scans already split on semicolons.

CREATE TABLE _split_artist_parts (
  old_artist_id TEXT NOT NULL,
  new_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (old_artist_id, position)
);

-- Recursively split artist names on semicolons.
WITH RECURSIVE split(old_id, part, rest, pos) AS (
  SELECT id, '', name || ';', 0 FROM artists WHERE name LIKE '%;%'
  UNION ALL
  SELECT
    old_id,
    TRIM(SUBSTR(rest, 1, INSTR(rest, ';') - 1)),
    SUBSTR(rest, INSTR(rest, ';') + 1),
    pos + 1
  FROM split
  WHERE rest <> ''
)
INSERT INTO _split_artist_parts (old_artist_id, new_name, position)
SELECT old_id, part, pos FROM split WHERE part <> '';

-- Create new artists for split parts that do not already exist.
INSERT INTO artists (id, name, active, musicbrainz_artist_ids)
SELECT lower(hex(randomblob(16))), sap.new_name, 1, old.musicbrainz_artist_ids
FROM _split_artist_parts sap
JOIN artists old ON old.id = sap.old_artist_id
WHERE NOT EXISTS (
  SELECT 1 FROM artists a WHERE a.name = sap.new_name COLLATE NOCASE
);

-- Map each old artist to the IDs of its split parts, preserving order.
CREATE TABLE _split_artist_mapping (
  old_artist_id TEXT NOT NULL,
  new_artist_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (old_artist_id, position)
);

INSERT INTO _split_artist_mapping (old_artist_id, new_artist_id, position)
SELECT sap.old_artist_id, a.id, sap.position
FROM _split_artist_parts sap
JOIN artists a ON a.name = sap.new_name COLLATE NOCASE;

-- Update song artist links.
DELETE FROM song_artists
WHERE artist_id IN (SELECT old_artist_id FROM _split_artist_mapping);

INSERT INTO song_artists (song_id, artist_id, position)
SELECT s.id, sam.new_artist_id, sam.position
FROM songs s
JOIN _split_artist_mapping sam ON sam.old_artist_id = s.artist_id;

UPDATE songs
SET artist_id = (
  SELECT new_artist_id FROM _split_artist_mapping
  WHERE old_artist_id = songs.artist_id
  ORDER BY position LIMIT 1
)
WHERE artist_id IN (SELECT old_artist_id FROM _split_artist_mapping);

-- Update album artist links.
DELETE FROM album_artists
WHERE artist_id IN (SELECT old_artist_id FROM _split_artist_mapping);

INSERT INTO album_artists (album_id, artist_id, position)
SELECT a.id, sam.new_artist_id, sam.position
FROM albums a
JOIN _split_artist_mapping sam ON sam.old_artist_id = a.artist_id;

UPDATE albums
SET
  artist_id = (
    SELECT new_artist_id FROM _split_artist_mapping
    WHERE old_artist_id = albums.artist_id
    ORDER BY position LIMIT 1
  ),
  artist_name = (
    SELECT group_concat(new_name, ' / ')
    FROM (SELECT new_name FROM _split_artist_parts WHERE old_artist_id = albums.artist_id ORDER BY position)
  )
WHERE artist_id IN (SELECT old_artist_id FROM _split_artist_mapping);

-- Remove the old combined artists.
DELETE FROM artists
WHERE id IN (SELECT old_artist_id FROM _split_artist_mapping);

-- Clean up helper tables.
DROP TABLE _split_artist_parts;
DROP TABLE _split_artist_mapping;
