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

### Changed

- Unified artists, composers, and labels into dedicated tables.
- Refreshed now-playing layout with favorite/rating controls and improved metadata links.

### Removed

- Dropped the inline insecure-connection warning from login and setup pages.

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
