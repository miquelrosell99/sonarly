# Sonarly Database Schema

Sonarly uses **SQLite** via `modernc.org/sqlite` (pure Go). The database file defaults to `${SONARLY_DATA_DIR}/sonarly.db` (`/data/db/sonarly.db` in the image). Migrations run automatically on startup from the embedded files in `server/internal/db/migrations/`.

This document reflects the schema produced by migrations **0001–0004**:

| Migration | What it does |
|---|---|
| `0001_baseline.sql` | Complete schema distilled from the old migration chain (001–049), with audit fixes (real FKs on `user_libraries`, unique `genres.name`, FK-child indexes) |
| `0002_job_payload.sql` | `scan_jobs.payload` (typed JSON job payloads) + `scan_jobs.created_at` (pending-visible job ordering) |
| `0003_search_fts.sql` | FTS5 virtual tables (`songs_fts`, `albums_fts`, `artists_fts`) + initial backfill |
| `0004_search_fts_backfill_fix.sql` | Idempotent full-corpus FTS re-backfill (re-asserts index↔corpus invariant on every database) |

## Conventions

- Primary keys are UUIDs stored as `TEXT` unless noted.
- Boolean flags are stored as `INTEGER` (`0` = false, `1` = true).
- Timestamps are stored as ISO-8601 `TEXT` (default `datetime('now')`).
- File modification times (`mtime`) are Unix milliseconds stored as `INTEGER`.
- Ratings are `REAL` (half-ratings supported).
- Soft deletion / "missing" detection uses the `active` flag on `songs`, `albums`, `artists`, `genres`, and `labels`.
- Applied migrations are recorded in the `schema_migrations` ledger (`filename`, `applied_at`); migrations are forward-only and never edited after shipping.

## Identity and settings

### `users`

Authenticated accounts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `username` | `TEXT` | Unique |
| `password_hash` | `TEXT` | Bcrypt hash for web UI sessions |
| `is_admin` | `INTEGER` | Default `0` |
| `created_at` | `TEXT` | Default `datetime('now')` |
| `subsonic_password_encrypted` | `TEXT` | AES-GCM-sealed password used for Subsonic token derivation (key derived from `SESSION_SECRET`) |
| `name` / `surname` / `email` | `TEXT` | Optional profile fields |
| `avatar_path` | `TEXT` | Filename of the avatar stored under `SONARLY_DATA_DIR/avatars/` |
| `max_bitrate_kbps` / `transcode_format` | `TEXT`/`INTEGER` | Per-user playback preferences |
| `hide_explicit` / `blur_explicit_titles` / `blur_explicit_covers` | `INTEGER` | Explicit-content preferences |

### `sessions` / `api_keys`

Session store (`sid`, `sess`, `expire`; index on `expire` for the periodic sweep) and API keys (`key_hash`, never the raw key; cascade on user delete).

### `settings` / `user_preferences`

Key-value server settings (`key`, `value`, `updated_at`) and per-user preference blobs (`preferences` JSON, PATCH allowlisted keys; one row per user).

## Catalog

### `artists`, `labels`

`id`, `name` (`COLLATE NOCASE`, unique case-insensitively), `active`, image URL/local path, `musicbrainz_*` ids, `bio`, `external_urls`. `genres` is the same minus images, plus `parent_id` (self-reference, `ON DELETE SET NULL`) for the genre tree.

### `cover_arts`

Embedded/cached artwork: `id`, `format`, `data` (BLOB), `hash` (indexed — dedupe), `created_at`.

### `albums`

| Column | Notes |
|--------|-------|
| `id`, `name` (`COLLATE NOCASE`) | |
| `artist_id` → `artists`, `artist_name` | Cached display name |
| `year`, `original_year` | |
| `genre`, `genre_id` → `genres` | Cached name + FK |
| `cover_art_id` → `cover_arts` | `ON DELETE NO ACTION` (unchanged from the old schema) |
| `active` | Missing-file detection |
| `catalog_numbers`, `barcode`, `asin` | Identifiers |
| `musicbrainz_album_id`, `musicbrainz_release_group_id`, `musicbrainz_album_artist_ids` | MusicBrainz linkage |
| `compilation`, `release_type` | |
| `total_tracks`, `total_discs` | `TEXT` (preserves "12/14"-style tags) |

Album-level metadata fields are only filled when empty, so user edits survive rescans.

### `songs`

The central table. Highlights:

- **Files**: `file_path` (UNIQUE), `mtime` (Unix ms), `checksum` (indexed), `library_id` → `libraries` (indexed).
- **Identity**: `title` (`COLLATE NOCASE`), `track_number`, `disc_number`, `artist_id` → `artists`, `album_id` → `albums`, `genre`/`genre_id`, `year`.
- **Technical**: `duration`, `bit_rate`, `bits_per_sample`, `sample_rate`, `channels`, `bpm`, `replay_gain` (REAL), `media_type`, `gapless`.
- **Display**: `display_artist`, `display_album_artist`, `sort_name`, `comment`, `mood`, `explicit`, `cover_art_missing`.
- **MusicBrainz**: `music_brainz_id`, `musicbrainz_track_id`, `musicbrainz_work_id`, `musicbrainz_disc_id`.
- **Dates**: `original_release_date`, `release_date`, `original_year`.
- **Relations**: `remix_of`, `original_artist`, `producers`, `isrcs`, `total_tracks`, `total_discs`.
- **Lyrics**: `lyrics`, `synced_lyrics`.
- **Aggregates**: `average_rating` (denormalized across users).

### Junction tables

Multi-value relations, all `(owner_id, value_id, position)` with composite PKs, cascading deletes, and both directions indexed:

`song_artists`, `album_artists`, `song_genres`, `album_genres`, `song_composers`, `album_labels`.

## Libraries

### `libraries`

Admin-managed folders: `id`, `name`, `path` (UNIQUE), `organize_pattern` (default `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`), `is_default`, timestamps. A default library is seeded from `SONARLY_LIBRARY_PATH` on first start.

### `user_libraries`

Per-user library assignment — **a security boundary**, enforced on every content query and stream/download path. Composite PK `(user_id, library_id)` with real cascading FKs (audit fix; the old schema had none).

## Per-user interaction state

`user_songs`, `user_albums`, `user_artists`, `user_playlists` — star/rating rows per entity (ratings are `REAL`; `user_songs` also carries `play_count`/`last_played`). Composite PKs, cascading FKs, child-column indexes.

## Playlists

### `playlists`

`id`, `name`, `owner_id` → `users` (cascade), `visibility` (`private`/`shared`/`public`/`link`), `share_token` (UNIQUE, minted iff visibility=link), `is_smart`, `rules_json` (smart-playlist rules), `resolve_mode` (`tracks` = owner's data / `query` = live per-viewer), `description`, timestamps.

### `playlist_songs` / `playlist_shares`

Members (`position` ordered) and per-user shares with `can_edit`. Both cascade on delete, both directions indexed.

## Listening history and bookmarks

- `listening_history`: `id`, `user_id`, `song_id`, `played_at`, `duration_listened` (seconds), `completion` (REAL), `client`, `source`; indexed on `(user_id, played_at)` and `song_id`.
- `bookmarks`: PK `(user_id, song_id)`, `position`, `comment`, timestamps.

## Background jobs and uploads

- `scan_jobs`: `id`, `type`, `status` (`pending`/`running`/`done`/`error`), `started_at`, `finished_at`, `stats`, `error`, plus from 0002: `payload` (typed JSON) and `created_at` (status orders by `COALESCE(started_at, created_at)` so queued work is visible).
- `ingest_jobs`: `id`, `run_id` (batch), `source_path` (NOT NULL, deliberately not UNIQUE), `status`, `target_path`, `error`, duplicate flags, timestamps.
- `upload_sessions`: `id`, `library_id` → `libraries` (cascade), `created_at`, `duplicate_strategy`. Chunks are staged on disk, not in the DB.

## Full-text search (0003 + 0004)

Three **regular** (self-contained) FTS5 virtual tables, keyed by the content row's rowid:

- `songs_fts(title)` — tokenized `unicode61`
- `albums_fts(name, artist_name)`
- `artists_fts(name)`

Regular tables were chosen deliberately: on this FTS5 build, external-content tables misbehave (DELETE of an absent rowid reports `SQLITE_CORRUPT`; INSERT OR REPLACE duplicates). The cost is a second copy of the indexed text — trivial at music-library scale.

The indexes are maintained by explicit statements **inside the transactions that write the content rows** (`library.PersistSong` syncs the rows it touches; the scanner's deactivation pass removes songs leaving the catalog). Migration 0004 re-backfills all three tables so the invariant "indexes mirror the active corpus" holds on every database.
