# Sonarly Database Schema

Sonarly uses **SQLite** (via `better-sqlite3`). The database file is created at `${DATA_DIR}/sonarly.db` (default `/data/sonarly.db`). Migrations run automatically on startup from `packages/server/src/db/migrations/`.

This document reflects the schema produced by migrations `001` through `046`.

## Conventions

- Primary keys are UUIDs stored as `TEXT` unless noted.
- Boolean flags are stored as `INTEGER` (`0` = false, `1` = true).
- Timestamps are stored as ISO-8601 `TEXT` (e.g., `datetime('now')`).
- File modification times (`mtime`) are Unix milliseconds stored as `INTEGER`.
- Soft deletion / "missing" detection uses the `active` flag on `songs`, `albums`, `artists`, and `genres`.

---

## Core entities

### `users`

Authenticated accounts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `username` | `TEXT` | Unique, case-sensitive |
| `password_hash` | `TEXT` | Bcrypt hash for web UI sessions |
| `subsonic_password_encrypted` | `TEXT` | Encrypted password used for Subsonic token derivation |
| `is_admin` | `INTEGER` | Default `0` |
| `name` | `TEXT` | Optional display name |
| `surname` | `TEXT` | Optional display surname |
| `email` | `TEXT` | Optional email |
| `avatar_path` | `TEXT` | Filename of the avatar stored in `${DATA_DIR}/avatars/` |
| `created_at` | `TEXT` | Default `datetime('now')` |

### `artists`

Music artists.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `name` | `TEXT` | `COLLATE NOCASE`, unique (case-insensitive) |
| `active` | `INTEGER` | Default `1`; set to `0` when no active songs reference the artist |
| `artist_image_url` | `TEXT` | Optional external artist image URL |
| `artist_image_local_path` | `TEXT` | Optional local cached artist image path |

**Indexes:**
- `idx_artists_name` on `name`
- `idx_artists_name_unique` unique on `name COLLATE NOCASE`
- `idx_artists_active` on `active`

### `song_artists`

Multi-value track artist links. Track artists are stored in the shared `artists` table.

| Column | Type | Notes |
|--------|------|-------|
| `song_id` | `TEXT` | FK → `songs(id)` `ON DELETE CASCADE` |
| `artist_id` | `TEXT` | FK → `artists(id)` `ON DELETE CASCADE` |
| `position` | `INTEGER` | Order within the song |

**Primary key:** (`song_id`, `artist_id`)

**Indexes:**
- `idx_song_artists_song` on `song_id`
- `idx_song_artists_artist` on `artist_id`

### `album_artists`

Multi-value album artist links. Album artists are stored in the shared `artists` table.

| Column | Type | Notes |
|--------|------|-------|
| `album_id` | `TEXT` | FK → `albums(id)` `ON DELETE CASCADE` |
| `artist_id` | `TEXT` | FK → `artists(id)` `ON DELETE CASCADE` |
| `position` | `INTEGER` | Order within the album |

**Primary key:** (`album_id`, `artist_id`)

**Indexes:**
- `idx_album_artists_album` on `album_id`
- `idx_album_artists_artist` on `artist_id`

### `albums`

Music albums.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `name` | `TEXT` | `COLLATE NOCASE` |
| `artist_id` | `TEXT` | FK → `artists(id)` `ON DELETE SET NULL` |
| `artist_name` | `TEXT` | Denormalized album artist name |
| `year` | `INTEGER` | Release year |
| `genre` | `TEXT` | Legacy text genre (kept for compatibility) |
| `genre_id` | `TEXT` | FK → `genres(id)` `ON DELETE SET NULL` |
| `album_type` | `TEXT` | Release type (album, ep, single, compilation, …); from the `RELEASETYPE` tag or the metadata editor |
| `cover_art_id` | `TEXT` | FK → `cover_arts(id)` |
| `active` | `INTEGER` | Default `1`; set to `0` when all songs become inactive |

**Indexes:**
- `idx_albums_artist` on `artist_id`
- `idx_albums_active` on `active`
- `idx_albums_genre_id` on `genre_id`
- `idx_albums_name` on `name`

### `labels`

Record labels. Uses the same schema shape as `artists` but lives in its own table because labels are organizations, not creators.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `name` | `TEXT` | `COLLATE NOCASE`, unique (case-insensitive) |
| `active` | `INTEGER` | Default `1`; set to `0` when no active albums reference the label |
| `label_image_url` | `TEXT` | Optional external label image URL |
| `label_image_local_path` | `TEXT` | Optional local cached label image path |
| `musicbrainz_label_ids` | `TEXT` | JSON array of MusicBrainz label IDs |
| `bio` | `TEXT` | Biography / description |
| `external_urls` | `TEXT` | JSON object of external links |

**Indexes:**
- `idx_labels_name` on `name`
- `idx_labels_name_unique` unique on `name COLLATE NOCASE`
- `idx_labels_active` on `active`

### `album_labels`

Multi-value label links for albums.

| Column | Type | Notes |
|--------|------|-------|
| `album_id` | `TEXT` | FK → `albums(id)` `ON DELETE CASCADE` |
| `label_id` | `TEXT` | FK → `labels(id)` `ON DELETE CASCADE` |
| `position` | `INTEGER` | Order within the album |

**Primary key:** (`album_id`, `label_id`)

**Indexes:**
- `idx_album_labels_album` on `album_id`
- `idx_album_labels_label` on `label_id`

### `songs`

Individual audio tracks.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `file_path` | `TEXT` | Unique absolute path to the audio file |
| `title` | `TEXT` | `COLLATE NOCASE` |
| `track_number` | `INTEGER` | Track number within the album |
| `disc_number` | `INTEGER` | Disc number |
| `duration` | `INTEGER` | Duration in seconds |
| `artist_id` | `TEXT` | FK → `artists(id)` `ON DELETE SET NULL` |
| `album_id` | `TEXT` | FK → `albums(id)` `ON DELETE SET NULL` |
| `genre` | `TEXT` | Legacy text genre (kept for compatibility) |
| `genre_id` | `TEXT` | FK → `genres(id)` `ON DELETE SET NULL` |
| `year` | `INTEGER` | Release year |
| `explicit` | `INTEGER` | Default `0`; explicit content flag |
| `cover_art_id` | `TEXT` | FK → `cover_arts(id)` |
| `cover_art_missing` | `INTEGER` | Default `0`; set to `1` when no embedded cover is found |
| `mtime` | `INTEGER` | File modification time (Unix ms) |
| `checksum` | `TEXT` | File checksum used for change detection |
| `active` | `INTEGER` | Default `1`; set to `0` when the file is missing during scan |
| `library_id` | `TEXT` | FK → `libraries(id)`; owning library for per-library scoping |
| `bit_rate` | `INTEGER` | Audio bitrate in bits per second (divide by 1000 for kbps) |
| `bits_per_sample` | `INTEGER` | Bit depth |
| `sample_rate` | `INTEGER` | Sample rate in Hz |
| `channels` | `INTEGER` | Channel count |
| `bpm` | `INTEGER` | Beats per minute |
| `music_brainz_id` | `TEXT` | MusicBrainz recording ID |
| `replay_gain` | `REAL` | ReplayGain value |
| `average_rating` | `REAL` | Average of all `user_songs.rating` entries |
| `comment` | `TEXT` | Comment tag |
| `sort_name` | `TEXT` | Sort title |
| `mood` | `TEXT` | Mood tag |
| `media_type` | `TEXT` | MIME type override |
| `original_release_date` | `TEXT` | Original release date |
| `release_date` | `TEXT` | Release date |
| `remix_of` | `TEXT` | Original track reference |
| `display_artist` | `TEXT` | Display artist override |
| `display_album_artist` | `TEXT` | Display album artist override |
| `lyrics` | `TEXT` | Plain lyrics |
| `synced_lyrics` | `TEXT` | LRC-format synced lyrics (stored as text/JSON) |

**Indexes:**
- `idx_songs_album` on `album_id`
- `idx_songs_artist` on `artist_id`
- `idx_songs_active` on `active`
- `idx_songs_genre_id` on `genre_id`
- `idx_songs_checksum` on `checksum`
- `idx_songs_library_id` on `library_id`

### `song_composers`

Multi-value composer links for songs. Composers are stored in the shared `artists` table.

| Column | Type | Notes |
|--------|------|-------|
| `song_id` | `TEXT` | FK → `songs(id)` `ON DELETE CASCADE` |
| `artist_id` | `TEXT` | FK → `artists(id)` `ON DELETE CASCADE` |
| `position` | `INTEGER` | Order within the song |

**Primary key:** (`song_id`, `artist_id`)

**Indexes:**
- `idx_song_composers_song` on `song_id`
- `idx_song_composers_artist` on `artist_id`

### `genres`

Hierarchical genre taxonomy.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `name` | `TEXT` | `COLLATE NOCASE` |
| `parent_id` | `TEXT` | FK → `genres(id)` `ON DELETE SET NULL` |
| `active` | `INTEGER` | Default `1` |

**Indexes:**
- `idx_genres_name` on `name`
- `idx_genres_parent` on `parent_id`

### `cover_arts`

Cached cover art images extracted from audio files or uploaded via the UI.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `format` | `TEXT` | Image MIME type (e.g., `image/jpeg`) |
| `data` | `BLOB` | Raw image bytes |
| `hash` | `TEXT` | Content hash for deduplication |
| `created_at` | `TEXT` | Default `datetime('now')` |

**Indexes:**
- `idx_cover_arts_hash` on `hash`

---

## User content interactions

### `user_songs`

Per-user song interactions (favorite, rating, play count).

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `song_id` | `TEXT` | FK → `songs(id)` `ON DELETE CASCADE` |
| `starred` | `INTEGER` | Default `0` |
| `rating` | `INTEGER` | 0–5, nullable |
| `play_count` | `INTEGER` | Default `0` |
| `last_played` | `TEXT` | ISO timestamp |

**Primary key:** (`user_id`, `song_id`)

### `user_albums`

Per-user album favorites and ratings.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `album_id` | `TEXT` | FK → `albums(id)` `ON DELETE CASCADE` |
| `starred` | `INTEGER` | Default `0` |
| `rating` | `INTEGER` | 0–5, nullable |

**Primary key:** (`user_id`, `album_id`)

### `user_artists`

Per-user artist favorites and ratings.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `artist_id` | `TEXT` | FK → `artists(id)` `ON DELETE CASCADE` |
| `starred` | `INTEGER` | Default `0` |
| `rating` | `INTEGER` | 0–5, nullable |

**Primary key:** (`user_id`, `artist_id`)

### `user_playlists`

Per-user playlist favorites and ratings.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `playlist_id` | `TEXT` | FK → `playlists(id)` `ON DELETE CASCADE` |
| `starred` | `INTEGER` | Default `0` |
| `rating` | `INTEGER` | 0–5, nullable |

**Primary key:** (`user_id`, `playlist_id`)

---

## Playlists

### `playlists`

User-created playlists (manual or smart).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `name` | `TEXT` | Playlist name |
| `description` | `TEXT` | Optional playlist description |
| `owner_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `visibility` | `TEXT` | `private` (default), `shared`, `public`, or `link` |
| `share_token` | `TEXT` | Unique token for `link` visibility |
| `is_smart` | `INTEGER` | Default `0`; `1` for smart playlists |
| `rules_json` | `TEXT` | JSON smart-playlist rules |
| `created_at` | `TEXT` | Default `datetime('now')` |
| `updated_at` | `TEXT` | Default `datetime('now')` |

### `playlist_songs`

Manual playlist entries (position-based). Smart playlists do not populate this table.

| Column | Type | Notes |
|--------|------|-------|
| `playlist_id` | `TEXT` | FK → `playlists(id)` `ON DELETE CASCADE` |
| `song_id` | `TEXT` | FK → `songs(id)` `ON DELETE CASCADE` |
| `position` | `INTEGER` | Zero-based position |

**Primary key:** (`playlist_id`, `song_id`)

### `playlist_shares`

Shares between users for collaborative playlists.

| Column | Type | Notes |
|--------|------|-------|
| `playlist_id` | `TEXT` | FK → `playlists(id)` `ON DELETE CASCADE` |
| `user_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `can_edit` | `INTEGER` | Default `0`; `1` grants edit permission |

**Primary key:** (`playlist_id`, `user_id`)

---

## Preferences and settings

### `user_preferences`

Per-user UI preferences stored as a JSON blob.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `TEXT` | PK, FK → `users(id)` `ON DELETE CASCADE` |
| `preferences` | `TEXT` | JSON object (default `'{}'`) |
| `updated_at` | `TEXT` | Default `datetime('now')` |

Common preference keys include `hideExplicit`, `themeMode`, `accentColor`, `sidebarConfig`, and `viewOptions`.

### `settings`

Server-wide admin settings as key-value pairs.

| Column | Type | Notes |
|--------|------|-------|
| `key` | `TEXT` | Primary key |
| `value` | `TEXT` | Setting value |
| `updated_at` | `TEXT` | Default `datetime('now')` |

Currently used keys:
- `organize_pattern` — file organization pattern template
- `review_retention_days` — days to keep files in the ingest review folder
- `last_review_cleanup` / `last_artist_image_sync` — last-run timestamps for background tasks

---

## Jobs and processing

### `scan_jobs`

Background worker jobs for scanning, resyncing, organizing, cleanup, and artist image sync.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `type` | `TEXT` | `scan`, `resync`, `ingest`, `organize`, `cleanup_review`, or `artist_images` |
| `status` | `TEXT` | `pending`, `running`, `completed`, or `failed` (default `pending`) |
| `started_at` | `TEXT` | ISO timestamp |
| `finished_at` | `TEXT` | ISO timestamp |
| `stats` | `TEXT` | JSON stats blob |

### `ingest_jobs`

Tracks files dropped into the ingest folder awaiting review / import.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `source_path` | `TEXT` | Unique source path |
| `status` | `TEXT` | Default `pending` |
| `target_path` | `TEXT` | Organized destination path |
| `error` | `TEXT` | Error message on failure |
| `created_at` | `TEXT` | Default `datetime('now')` |
| `updated_at` | `TEXT` | Default `datetime('now')` |

---

## Listening history

### `listening_history`

Per-user play events.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `user_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `song_id` | `TEXT` | FK → `songs(id)` `ON DELETE CASCADE` |
| `played_at` | `TEXT` | Default `datetime('now')` |
| `duration_listened` | `INTEGER` | Seconds listened |
| `completion` | `REAL` | Completion ratio (0–1) |
| `client` | `TEXT` | Client identifier |
| `source` | `TEXT` | Playback source |

**Indexes:**
- `idx_listening_history_user_played_at` on (`user_id`, `played_at`)
- `idx_listening_history_song` on `song_id`

---

## Sessions and keys

### `sessions`

Server-side cookie sessions.

| Column | Type | Notes |
|--------|------|-------|
| `sid` | `TEXT` | Primary key (session ID) |
| `sess` | `TEXT` | JSON session data |
| `expire` | `TEXT` | Expiration timestamp |

**Indexes:**
- `idx_sessions_expire` on `expire`

### `api_keys`

API keys for external clients (e.g., Subsonic apps).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | Primary key (UUID) |
| `user_id` | `TEXT` | FK → `users(id)` `ON DELETE CASCADE` |
| `key_hash` | `TEXT` | Hashed API key |
| `created_at` | `TEXT` | Default `datetime('now')` |
