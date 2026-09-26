-- 0005_normalize_legacy_numerics
--
-- Normalize numeric columns written by the retired TypeScript server, which
-- persisted raw JS numbers: fractional REAL mtimes (mtimeMs), durations,
-- and bitrates, string-typed track/disc totals, and percent fractions in
-- listening_history.completion (the old web client sent a 0..1 fraction
-- against a 0..100 percent contract, so legacy rows hold e.g. 0.93 for a
-- 93% play). Current schema semantics are integers (ms, seconds, bps) and
-- percent 0..100.
--
-- typeof() guards keep every statement idempotent and make the migration a
-- no-op on fresh databases and on re-application. Fractions are truncated
-- (CAST rounds toward zero), matching the integer-second / integer-milli
-- semantics the Go server writes.
--
-- replay_gain and the user_* rating columns are legitimately fractional
-- and are intentionally untouched.

UPDATE songs
SET mtime = CAST(mtime AS INTEGER)
WHERE typeof(mtime) = 'real';

UPDATE songs
SET duration = CAST(duration AS INTEGER)
WHERE typeof(duration) = 'real';

UPDATE songs
SET bit_rate = CAST(bit_rate AS INTEGER)
WHERE typeof(bit_rate) = 'real';

-- total_tracks / total_discs are TEXT by schema design (the wire contract
-- carries them as strings) — intentionally not converted.

UPDATE listening_history
SET duration_listened = CAST(duration_listened AS INTEGER)
WHERE typeof(duration_listened) = 'real';

-- Completion: every legacy row is <= 1.0 (verified across production
-- copies), so the fraction era is unambiguous here; rows written after
-- this migration use the percent contract and are never re-touched (the
-- ledger runs this file once).
UPDATE listening_history
SET completion = ROUND(completion * 100, 2)
WHERE typeof(completion) = 'real' AND completion <= 1;
