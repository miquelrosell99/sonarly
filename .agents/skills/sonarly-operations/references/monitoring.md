# Monitoring

No Prometheus/metrics/alerting integration exists — the built-in surface is:

- **Container healthcheck** (`wget /healthz`, 30 s interval) +
  `docker compose ps`; `/ready` distinguishes process-up from DB-usable.
- **Admin status dashboard** — `/api/admin/status`: missing files, ingest
  runs, system tasks with history. The operator's first stop for "is the
  library healthy".
- **Job watch** (direct DB read):

  ```sh
  sqlite3 ./config/sonarly/data/sonarly.db \
    "select id,type,status,started_at,finished_at from scan_jobs order by rowid desc limit 10"
  ```

- **SSE feed** `/api/events` (30 s heartbeat, `library:changed`) — the same
  signal the web UI uses; `curl -N` it to watch live catalog changes.
- **Log watch** for crashes: `docker logs -f sonarly | grep -iE 'error|panic|client error report'`.

If a real metrics/alerting stack is added, wire it per the
`deployment-runbook` skill's monitoring section and record the setup in
`docs/deployment.md` + this reference in the same pass.
