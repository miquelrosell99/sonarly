ALTER TABLE upload_sessions ADD COLUMN duplicate_strategy TEXT;
ALTER TABLE ingest_jobs ADD COLUMN duplicate INTEGER DEFAULT 0;
ALTER TABLE ingest_jobs ADD COLUMN duplicate_strategy TEXT;