---
name: sonarly-user-management
description: Operate and modify Sonarly's auth and user subsystem — sessions, passwords, API keys, admin gates, profiles, and multi-user scoping
type: prompt
whenToUse: When working on authentication, sessions, login, user CRUD, admin routes, roles/permissions, avatars, preferences, or multi-user data scoping
---

# Sonarly User Management

## Map of the subsystem

- `packages/server/src/features/auth/` — `session.ts` (SQLite-backed `@fastify/session` store, ISO-expiry sweep), `password.ts` (bcrypt cost 12), `token.ts` (Subsonic `t = md5(password+salt)`, `timingSafeEqual`), `encryption.ts` (AES-256-GCM for `users.subsonic_password_encrypted`; key = SHA-256 of `SESSION_SECRET`), `api-keys.ts` (SHA-256 key hashes; **no management routes exist** — half-built feature).
- `packages/server/src/features/users/` — `auth-routes.ts` (login/logout/setup/me), `admin-routes.ts` (23 admin endpoints; `requireAdmin` re-reads `is_admin` from DB), `profile-routes.ts`, `lookup-routes.ts` (username enumeration by design, for playlist sharing).
- Global auth hook: `app.ts:195-216` guards all `/api/*` except exempt prefixes `/api/login`, `/api/logout`, `/api/setup`, `/api/me`, `/api/avatars`, `/api/libraries` + a narrow shareToken bypass (handlers re-verify).

## Session facts

- Cookie: `httpOnly`, `sameSite: 'strict'` (CSRF-safe by construction), `secure` from `SESSION_COOKIE_SECURE` (default false), 7-day absolute lifetime, **no rolling renewal**.
- `session.regenerate()` on login and setup (fixation-safe).
- ~14 other route modules use the `session.isAdmin` flag instead of the DB re-check — only safe because role changes delete the user's sessions.
- Sessions are invalidated on role change and user deletion — but **not on password reset** (known gap; fix when touching `admin-routes.ts`).

## Multi-user scoping model

- Per-user interaction state is real: `user_songs`/`user_albums`/`user_artists`/`user_playlists` (starred, rating, play_count, last_played), `user_preferences`, `listening_history`, `bookmarks` — always keyed by `session.userId`.
- Per-user *content* scoping (`user_libraries` table) exists in schema + admin CRUD but is **not enforced in any read/stream path** — every authenticated user can access every library's content. Treat this as an open product decision, not a pattern to copy.
- Statistics `/me` variants are self-scoped; `/users/:id` variants are admin-gated.

## Invariants to preserve

- `SESSION_SECRET` is zod-enforced `min(32)` with no default; the worker thread deliberately never receives it.
- bcrypt before entering DB transactions (async gap comment in `admin-routes.ts`).
- Last-admin protections on demote/delete; self-delete blocked; setup gated on zero users (known TOCTOU — don't widen it).
- Login throttle: in-memory Map keyed `ip:username`, 15-min lockout; `trustProxy` is unset so IP is the proxy IP.
- Tests: `tests/features/users/` (40 admin tests incl. 42 total 403 assertions across the suite), `tests/features/auth/token.test.ts`. Test helpers mock `node:worker_threads` in route tests.
