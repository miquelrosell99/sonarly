-- P4b: typed job payloads + pending-visible job ordering.
--
-- v1 smuggled the job payload (a bare path string) inside the stats JSON
-- column; one producer passed a library path where the ingest worker
-- expected a source path, importing files into the wrong library. v2 stores
-- a typed JSON payload per job in its own column. Nullable: rows created
-- before this migration simply have no payload.
ALTER TABLE scan_jobs ADD COLUMN payload TEXT;

-- v1 ordered scan status by started_at, which is NULL until a job runs, so
-- pending jobs sorted last and /api/scans/status hid queued work. created_at
-- is written explicitly by the queue (SQLite forbids non-constant ADD COLUMN
-- defaults) and status orders by COALESCE(started_at, created_at).
ALTER TABLE scan_jobs ADD COLUMN created_at TEXT;
