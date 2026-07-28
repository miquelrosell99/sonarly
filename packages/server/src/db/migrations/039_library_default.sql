ALTER TABLE libraries ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

-- Make the first existing library the default if any exist.
UPDATE libraries
SET is_default = 1
WHERE id = (
  SELECT id FROM libraries ORDER BY created_at ASC, rowid ASC LIMIT 1
);
