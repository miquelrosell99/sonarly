# Changelog

All notable changes to Sonarly are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-value artist and genre support with pill-list editing.
- MusicBrainz metadata lookup in the edit and fetch-metadata modals.
- LRC library integration for fetching synced lyrics.
- Album-level cover art management and propagation to songs.
- Auto DJ toggle in the now-playing view.
- Explicit content filtering with per-user blur/title preferences.
- Album type support: `albums.album_type` column (migration 045), populated from the `RELEASETYPE` tag on scan, editable in the metadata editor with a suggestion dropdown (`/api/suggestions?field=albumType`), and shown on the album page.
- Playlist sharing modal: visibility cards (private / specific users / public / link), shareable link with copy button, and per-user shares with view/edit roles (`GET /api/users/lookup`, owner-only shares list on the playlist detail response).
- Media Session API integration: OS/keyboard media keys and lock-screen metadata for the web player.
- Composer and label detail pages (`/composers/:name`, `/labels/:name`) backed by new `composer`/`label` filters on `/api/songs` and a `label` filter on `/api/albums`.
- Mobile navigation drawer, mobile search affordance, responsive player bar, and a skip-to-content link.
- Login throttling against brute force, session regeneration on login/setup, session invalidation on user delete/demote, and a periodic expired-session sweep.
- Performance indexes (migration 044): `songs(checksum)`, `songs(library_id)`, `albums(name)`.

### Changed

- Unified artists, composers, and labels into dedicated tables.
- Refreshed now-playing layout with favorite/rating controls and improved metadata links.
- Accessibility overhaul: focus trap in modals, keyboard support for star ratings/context menus/tabs, visible focus rings on sliders and inputs, `role="status"`/`role="alert"` page states via the upgraded `PageState`, touch-device reveal for hover-only actions (`.hover-reveal`), larger touch targets, per-theme `color-scheme`, and a global reduced-motion dampener.
- Semantic `danger`/`success`/`warning`/`info` colors are now Tailwind theme colors mapped to per-mode tokens (previously hardcoded or unreachable).
- Scrobbling now fires at a 50%/4-minute threshold instead of on play start; OpenSubsonic `scrobble.view` honors `submission=false`.
- OpenSubsonic XML responses now use attribute-based serialization matching the Subsonic schema; `getAlbumList` types order correctly; song `path` is library-relative.
- Transcode bitrate math corrected (stored bits/sec vs kbps comparisons).
- Web API client moved to `src/lib/api.ts`; all pages route loading/error/empty states through `PageState`.

### Fixed

- Path traversal in chunked uploads (`fileId`/`relativePath` validation).
- Session expiry comparison bug that kept sessions valid up to ~24h past expiry.
- Library-scoped home and search queries binding parameters in the wrong order (500s/empty results).
- Smart playlists sorted by joined fields (album, artist, genre, …) failing with SQL errors.
- Duplicate-replace flow could overwrite an unrelated library file and delete the matched one.
- Scanner deactivating the whole library when a drive is unmounted; library path prefix matching (`/music` claiming `/music2`); dotfile ingestion of temp files.
- Tag writer: OGG cover art base64, duplicate MP3 APIC frames, m4a cover format, mutagen hang timeout.
- Search error state never displayed (infinite loading), Auto DJ stale-add race, empty-queue "Play next" stranding tracks.

### Removed

- Dropped the inline insecure-connection warning from login and setup pages.
- Legacy Subsonic plaintext/`enc:` password authentication (use token/salt or API keys).
- Dead `cover_art` text columns on `songs`/`albums` (migration 046), dead code paths (`api-keys` generators, scan-repository helpers, `listening-stats` repository, `readTags` alias), the duplicate `/songs` page, and the unimplemented Album Types nav entry.

## [0.1.0] - 2026-07-27

### Added

- Initial self-hosted music server with OpenSubsonic-compatible `/rest` API.
- React + Vite + Tailwind web management UI.
- User accounts with admin/regular roles and cookie-based sessions.
- Library management, file watching, and periodic background scans.
- Ingest/review workflow for importing new music.
- Auto-organization of files into a configurable path pattern.
- Playlist support (manual and smart) with sharing and visibility controls.
- Favorites, ratings, and listening history.
- Cover art and artist image caching.
- Genre hierarchy and year-based discovery.
- Lyrics display and editing (plain and synced).
- Duplicate detection and resolution.
- Settings for retention, artist image sync, and organization pattern.

[Unreleased]: https://github.com/miquelrosell99/sonarly/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/miquelrosell99/sonarly/releases/tag/v0.1.0
