# Database migrations

Canonical: `docs/db-schema.md` (schema reference — update it when migrations
change).

## Mechanism (operator view)

- `server/internal/db/migrate.go` embeds `server/internal/db/migrations/*.sql`
  (`//go:embed`); files apply in filename order (`NNNN_name.sql`), **one
  transaction per file**, recorded in the `schema_migrations(filename,
  applied_at)` ledger.
- They run **automatically at container start** — the operator does nothing on
  upgrade beyond taking a backup first. Idempotent by ledger.
- Conventions: `IF NOT EXISTS`, explicit FKs with actions, indexes per
  observed query pattern, UUID TEXT PKs, INTEGER booleans, ISO-8601 TEXT
  timestamps, REAL ratings, `active` flag for missing-file detection.
- Current set: `0001_baseline … 0006_share_download`.

## Laws

- **Never edit a shipped migration — fix forward** with the next number.
- SQLite is opened WAL + `foreign_keys(1)` + `busy_timeout(5000)` +
  `synchronous(NORMAL)` + `mmap_size(256MB)` + **`SetMaxOpenConns(1)`**
  (single writer). Multi-write operations happen inside transactions, so
  "migration hung" almost always means the DB file is unreachable/slow (it
  must be on local disk) or a second process holds it.
- **One instance per DB file, ever.** A migration running under two
  containers racing the same file is how ledgers get torn.

## Ops checklist on upgrade

1. Backup (`references/backups.md`) — the DB is the only state that matters.
2. Pull + `up -d`; migrations apply at start.
3. Confirm `docker logs sonarly` shows a clean start and
   `curl /ready` returns ok.
4. Spot-check: `sqlite3 ./config/sonarly/data/sonarly.db "select filename from schema_migrations order by filename"` — the newest file is present.

Downgrade = restore the pre-upgrade DB + previous image tag
(`references/rollback.md`).
