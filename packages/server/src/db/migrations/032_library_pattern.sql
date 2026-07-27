ALTER TABLE libraries ADD COLUMN organize_pattern TEXT NOT NULL DEFAULT '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}';

UPDATE libraries
SET organize_pattern = COALESCE(
  (SELECT value FROM settings WHERE key = 'organize_pattern'),
  '{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}'
);
