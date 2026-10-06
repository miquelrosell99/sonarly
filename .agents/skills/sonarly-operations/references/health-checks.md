# Health checks

Canonical: `docs/deployment.md`.

## Endpoints (app port 3000; host `${SONARLY_PORT:-4533}`)

- `GET /health` and `GET /healthz` — identical aliases, unauthenticated,
  `{"status":"ok"}`, no state leak. This is the container+compose healthcheck.
- `GET /ready` — pings the database; 503 "database not ready" when SQLite
  isn't open. Use it to distinguish "process up" from "usable".
- Image `HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3`
  via `wget -qO- http://127.0.0.1:3000/healthz`; the live compose mirrors it.

## Post-deploy matrix

```sh
docker compose ps                                          # (healthy)
curl -fsS http://127.0.0.1:4533/healthz                    # liveness
curl -fsS http://127.0.0.1:4533/ready                      # DB up
curl -fsS -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:4533/                                   # SPA served
```

Then a real login round-trip in the browser (setup wizard at `/setup` only
exists while zero users — a 404 there after first boot is normal).

## Grace periods

First boot of a big restored DB: migrations run before the server accepts
traffic — `unhealthy` inside the first minute is usually migrations, not
failure. Check `docker logs sonarly` for the migration ledger before
intervening.
