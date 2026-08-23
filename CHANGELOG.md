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
- Full anonymous access for link-shared playlists: `/playlists/:id?shareToken=…` renders a guest view (cover grid, track list, playback) without an account; cover-art and the new `/api/stream/:id` endpoint authorize the token scoped to the linked playlist's own songs.

### Changed

- Unified artists, composers, and labels into dedicated tables.
- Refreshed now-playing layout with favorite/rating controls and improved metadata links.
- Accessibility overhaul: focus trap in modals, keyboard support for star ratings/context menus/tabs, visible focus rings on sliders and inputs, `role="status"`/`role="alert"` page states via the upgraded `PageState`, touch-device reveal for hover-only actions (`.hover-reveal`), larger touch targets, per-theme `color-scheme`, and a global reduced-motion dampener.
- Semantic `danger`/`success`/`warning`/`info` colors are now Tailwind theme colors mapped to per-mode tokens (previously hardcoded or unreachable).
- Scrobbling now fires at a 50%/4-minute threshold instead of on play start; OpenSubsonic `scrobble.view` honors `submission=false`.
- OpenSubsonic XML responses now use attribute-based serialization matching the Subsonic schema; `getAlbumList` types order correctly; song `path` is library-relative.
- Transcode bitrate math corrected (stored bits/sec vs kbps comparisons).
- Web API client moved to `src/lib/api.ts`; all pages route loading/error/empty states through `PageState`.
- Statistics view redesigned: hero listening-time band with gradient display numeral and count-up, segmented range control, animated genre/year bars, interactive donut with synced legend hover, ranked top lists with proportional play-count bars, and staggered section reveals (all reduced-motion safe).
- Home carousel: cover size capped on narrow screens, album titles clamp to two lines with ellipsis (full name in tooltip), and slide boxes can no longer overflow into neighbors.
- Upload moved from the top bar into the user menu (between Statistics and Settings); the library selector collapses to an icon on narrow screens and the top-bar grid no longer squeezes the wordmark.
- Library selector moved from the top bar to the top of the sidebar (and the mobile nav drawer), ending the narrow-screen overlap; the top bar is now just logo, search, and user actions.
- Home carousel: "Featured albums" is now a section header above the carousel (matching ScrollRow headers), and the album text block top-aligns with the cover instead of bottom-aligning.
- Now Playing redesign: responsive hero layout (stacked, scrollable on narrow windows), cover scale-in transition, segmented Queue/Lyrics tabs, accent play button hierarchy, distance-faded synced lyrics, and narrow-safe queue modal.
- Synced lyrics editor rebuilt as a vertical waveform timeline: the song's waveform (decoded client-side) scrolls under a pinned center "now" line, lyric lines are pills tethered to their timestamp by a connector and dot, click a pill to edit its text in a modal, drag to retime, and an insert button adds a pill at the current position. Full-screen on phones; LRCLIB auto-fill kept.
- Playlist sharing reworked into a two-tab modal: Members (public toggle for read access by all users, per-user list with view/edit role dropdowns, add-user search) and Share links (generate/regenerate/revoke tokenized links). Share tokens now authorize independently of the visibility setting.
- Deep links into playback: `/now-playing/<playlist|album|genre>/<contextId>/<songId>` is a true overlay route — opening Now Playing pushes the URL (context + current track), the track id updates as songs change, closing returns to the context page, and refreshing or sharing the link resumes that song in its context. Now Playing shows a copy-link button when the queue's origin is known. Clicking a track in a playlist/album queues the whole context from that track instead of the single song. Guest share links support `/now-playing/playlist/<id>/<songId>?shareToken=…` (playback starts in the guest player bar).
- The Auto DJ toggle moved from the Now Playing tab header into the queue action row, beside Clear queue / Save as playlist.
- Gapless playback aid: the next track (shuffle/repeat aware) is preloaded on a hidden audio element in the last 30s so transitions are seamless; works for guest share-link streams too.
- Sleep timer in the player bar (5–60 minutes or end of track) with a live countdown; pauses and notifies when it fires.
- Save the current queue as a playlist from the queue panel or the player bar's new track-actions menu (go to album/artist, save queue).
- Sidebar playlists have right-click/long-press menus (play, shuffle, play next, add to queue, edit, share, delete with confirmation); track/album/artist menus gained go-to and shuffle actions.
- Auto DJ: sharpened modes (Similar / Random / Smart), new settings — exclude-recently-played window (24h/7d/30d), prefer favorites, and a familiar↔adventurous discovery dial; config changes refill the DJ queue immediately; DJ suggestions moved to a POST body.
- Anonymous share links now work for smart playlists too (token grants resolve smart rules, cached 30s).
- Playlist type is a Standard/Smart pill selector in the playlist modal: smart→standard keeps the current tracks as members (with confirmation), standard→smart clears members (with confirmation), and the query builder only shows in smart mode. Visibility was removed from edit modals — it's managed by sharing.

### Fixed

- Path traversal in chunked uploads (`fileId`/`relativePath` validation).
- Session expiry comparison bug that kept sessions valid up to ~24h past expiry.
- Library-scoped home and search queries binding parameters in the wrong order (500s/empty results).
- Smart playlists sorted by joined fields (album, artist, genre, …) failing with SQL errors.
- Duplicate-replace flow could overwrite an unrelated library file and delete the matched one.
- Scanner deactivating the whole library when a drive is unmounted; library path prefix matching (`/music` claiming `/music2`); dotfile ingestion of temp files.
- Tag writer: OGG cover art base64, duplicate MP3 APIC frames, m4a cover format, mutagen hang timeout.
- Search error state never displayed (infinite loading), Auto DJ stale-add race, empty-queue "Play next" stranding tracks.
- Listening time always showed 0m: web scrobbles never sent `durationListened`, so every `listening_history` row had NULL duration. The player now reports seconds listened + completion, and migration 047 backfills existing plays from song durations.
- Synced lyrics editor opened trapped inside the Now Playing panel (no portal), collapsing the waveform area so neither waveform nor existing pills rendered; it now portals to the body and opens scrolled to the first lyric line.

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
