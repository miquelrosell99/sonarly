ALTER TABLE albums RENAME COLUMN album_type TO release_type;

-- Smart playlist rules are stored as JSON with the field name inline;
-- rewrite saved rules/sorts that reference the old field name.
UPDATE playlists
SET rules_json = REPLACE(rules_json, '"field":"albumType"', '"field":"releaseType"')
WHERE is_smart = 1 AND rules_json LIKE '%"field":"albumType"%';
