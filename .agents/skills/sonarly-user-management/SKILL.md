---
name: sonarly-user-management
description: Operate and modify Sonarly's auth and user subsystem — sessions, passwords, API keys, admin gates, profiles, preferences, and multi-user scoping
type: prompt
whenToUse: When working on authentication, sessions, login, user CRUD, admin routes, roles/permissions, avatars, preferences, or multi-user data scoping
---

# Sonarly User Management

## Map of the subsystem

- `server/internal/modules/auth/` — `store.go` (SQLite session store), `cookie.go` (signed cookie, wire-compatible with the previous format so existing sessions survived the cutover), `throttle.go` (login throttling), `secret.go` (AES-256-GCM for `users.subsonic_password_encrypted`; key = SHA-256 of `SESSION_SECRET`), `apikeys.go` (SHA-256 key verification — **no management routes yet**, still half-built), `middleware.go` (session resolution).
- `server/internal/modules/users/` — `service.go` (user CRUD, bcrypt cost 12, last-admin protections, session invalidation on role/password change), `routes.go` (login/logout/setup/me, profile, admin routes), `repository.go`, `preferences.go` (allowlisted PATCH keys, defaults merged under stored blob), `avatar.go` (file-backed avatars).
- Auth wiring: `internal/httpserver` mounts the session middleware; the OpenAPI spec marks the public routes (login/logout/setup/me, share-token playlist access). Everything else requires a session cookie or `X-API-Key`.

## Session facts

- Cookie: `httpOnly`, `sameSite=strict` (CSRF-safe by construction), `secure` from `SESSION_COOKIE_SECURE` (default false), 7-day absolute lifetime, **no rolling renewal**.
- Session regeneration on login and setup (fixation-safe).
- Sessions are invalidated on role change, password change/reset, and user deletion.
- Login throttle: in-memory, keyed by client; lockout window enforced in `throttle.go`.

## Multi-user scoping model

- Per-user interaction state is real and always keyed by user id: `user_songs`/`user_albums`/`user_artists`/`user_playlists` (starred, rating REAL, play_count, last_played), `user_preferences`, `listening_history`, `bookmarks`.
- Per-user *content* scoping (`user_libraries`) is **enforced in every read/stream path** — every catalog query filters by assigned libraries; songs with `library_id IS NULL` are admin-only. Treat any bypass as a security bug (an accepted boundary decision — the Go server enforces it from the start and the scoping tests keep it closed).
- Statistics `/me` variants are self-scoped; `/users/:id` variants are admin-gated.

## Invariants to preserve

- `SESSION_SECRET` must be ≥ 32 chars, no default; the server refuses to start without it. It seals Subsonic passwords and signs cookies — never log it, never pass it to subprocesses that don't need it.
- bcrypt before entering DB transactions (async gap — don't hold a tx across the hash).
- Last-admin protections on demote/delete; self-delete blocked; setup gated on zero users.
- Preferences PATCH runs through the explicit key allowlist (`preferences.go`); unknown keys → 400. The stored blob stays schemaless read-only for legacy keys.
- Public routes are a security decision, not a convenience — extending the unauthenticated set needs the same scrutiny as the security audit applied.
- Tests: `*_test.go` in `auth/` and `users/` (cookie interop, throttle, scoping matrix, preferences allowlist, admin gates). Run `go test ./... -count=1` from `server/`.
