ALTER TABLE ingest_jobs RENAME TO ingest_jobs_old;

CREATE TABLE ingest_jobs (
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

INSERT INTO ingest_jobs (
  id, run_id, source_path, status, target_path, error,
  created_at, updated_at, duplicate, duplicate_strategy
)
SELECT
  id, NULL, source_path, status, target_path, error,
  created_at, updated_at, duplicate, duplicate_strategy
FROM ingest_jobs_old;

DROP TABLE ingest_jobs_old;

CREATE INDEX idx_ingest_jobs_run_id ON ingest_jobs(run_id);
