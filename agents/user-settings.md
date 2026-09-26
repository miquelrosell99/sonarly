## User Settings & Preferences Storage

Use three separate storage layers so UI config, content interactions, and server config do not mix:

1. **Global / admin settings** — `settings` key-value table (server module `v2/internal/modules/admin`, settings handlers).
   - Used for server-wide configuration: organize pattern, review retention days, etc.
   - Writable by admins only.
2. **Per-user UI preferences** — `user_preferences` table, one row per user (`user_id` primary key) with a JSON blob; served by `v2/internal/modules/users` (`preferences.go`).
   - Stores sidebar order/visibility, theme mode, accent color, default view modes, column visibility, card sizes, auto-dj settings, etc.
   - The stored blob is schemaless (unknown legacy keys ride along read-only), but **PATCH runs through an explicit allowlist** with per-key validators — unknown keys are rejected with 400. Defaults are merged under the stored blob; a missing row or corrupt blob yields the defaults.
3. **Per-user content interactions** — normalized relational tables.
   - `user_songs`, `user_albums`, `user_artists`, `user_playlists`.
   - Columns: `starred` (integer), `rating` (REAL — half ratings), `play_count` / `last_played` on `user_songs`.
   - These are queried for favorites, ratings, play history, and recommendations.

Front-end UI state (e.g., current modal, scroll position) belongs in Zustand or React state, not in persisted preferences.
