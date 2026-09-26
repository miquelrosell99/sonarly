## Security Considerations

- `SESSION_SECRET` must be at least 32 characters; the server refuses to start without it. It seals `users.subsonic_password_encrypted` (AES-GCM, key = SHA-256 of the secret) and signs session cookies — rotating it logs everyone out and breaks existing Subsonic client passwords.
- Session cookies are `httpOnly`, `sameSite: 'strict'`, and `secure` is controlled by `SESSION_COOKIE_SECURE` (default `false` so plain-HTTP self-hosted setups work; set `true` only behind HTTPS).
- Management API routes require a valid session (or API key) except for login/logout/setup/me and share-token playlist access.
- Per-user library assignment (`user_libraries`) is enforced on every content query and stream/download path — treat it as a security boundary, not a UI filter. Admins bypass; share tokens stay scoped to the linked playlist's songs.
- The container drops privileges at runtime to the `PUID`/`PGID` owner of bind mounts (entrypoint creates/adjusts the `sonarly` user, then `su-exec`).
- Health probes (`/health`, `/healthz`, `/ready`) are unauthenticated and leak no state — safe for container HEALTHCHECK and load balancers.
- All SQL is parameterized; the smart-playlist compiler is whitelisting (field list fixed, values bound, never interpolated).
