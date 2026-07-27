## Security Considerations

- `SESSION_SECRET` must be at least 32 characters; the container refuses to start without it.
- Session cookies are `httpOnly`, `sameSite: 'strict'`, and `secure` is controlled by `SESSION_COOKIE_SECURE`.
- `SESSION_COOKIE_SECURE` defaults to `false` so the app works over plain HTTP in self-hosted setups. Set to `true` only behind HTTPS.
- Management API routes require a valid session except for login/logout/setup/me endpoints.
- The container drops privileges at runtime to the `PUID`/`PGID` owner of bind mounts.
