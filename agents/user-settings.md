## User Settings & Preferences Storage

Use three separate storage layers so UI config, content interactions, and server config do not mix:

1. **Global / admin settings** — `settings` key-value table (`packages/server/src/features/settings/`).
   - Used for server-wide configuration: organize pattern, review retention days, etc.
   - Writable by admins only.
2. **Per-user UI preferences** — `user_preferences` table, one row per user (`user_id` primary key) with a JSON blob.
   - Stores sidebar order/visibility, theme mode, accent color, default view modes, column visibility, card sizes, etc.
   - Validated on write with Zod, but kept schemaless in SQLite so the UI can evolve without migrations.
3. **Per-user content interactions** — normalized relational tables.
   - `user_songs`, `user_albums`, `user_artists`, `user_playlists`.
   - Columns: `starred` (integer), `rating` (integer), `play_count` (integer), `last_played` (text).
   - These are queried for favorites, ratings, play history, and recommendations.

Front-end UI state (e.g., current modal, scroll position) belongs in Zustand or React state, not in persisted preferences.
