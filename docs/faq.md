# Frequently Asked Questions

## Which Subsonic clients work with Sonarly?

Any client that speaks the OpenSubsonic/Subsonic REST API. Tested in this project: Feishin (desktop), Symphonium (Android), and Music Assistant. DSub and Ultrasonic are expected to work; open an issue if a client doesn't. Point the client at `http://<host>:4533/rest` and use token auth (username + password — the client generates the token). Known gaps: the OpenSubsonic podcast/internet-radio endpoints return empty collections, and `getBookmarks` returns an empty list. See [api.md](api.md#opensubsonic-api-rest).

## Does Sonarly modify my music files?

No — not on its own. Scans are strictly read-only: the scanner never writes tags, never embeds artwork, never renames. The only writes to files are explicit actions you take: tag edits from the metadata editor (via the Mutagen-backed writer) and moves/renames from the ingest organize step or the organize tool. See [philosophy.md](philosophy.md).

## How do multiple users and libraries work?

An admin creates users and assigns each one one or more libraries. The assignment is enforced everywhere — browsing, search, streaming, downloads, and Subsonic clients only ever see assigned libraries. Favorites, ratings, play counts, history, and playlists are per-user. Admins bypass the library restriction and can see statistics per user. See [usage.md](usage.md#users-and-library-assignment).

## Can I migrate from Navidrome (or another Subsonic server)?

There is no automatic importer. Your files are the library, so migration is: point Sonarly's `LIBRARY_MUSIC` at the same music folder and scan — the catalog rebuilds itself. Listening history, ratings, and playlists don't transfer; the per-user data lives in Sonarly's own database. Subsonic clients can be repointed at Sonarly's `/rest` endpoint and re-sync their local caches.

## Why SQLite?

One process, one file, zero external services. SQLite with WAL mode handles a personal music server comfortably — scanning, FTS search, and concurrent streaming included — and it makes backup and restore as simple as copying a file while the built-in `.backup` command keeps snapshots consistent. It is also what lets the whole product run as a single container. See [philosophy.md](philosophy.md#boring-tech-operated-simply).

## Which audio formats are supported?

Scanning, ingest, and playback cover **MP3, FLAC, OGG, and M4A** (AAC/ALAC in an MP4 container). Metadata reading is pure Go (ID3v1/v2, Vorbis comments, MP4 atoms), including multi-value tags, ratings, and synced lyrics (LRC in tags). Other containers (WAV, WMA, …) are not scanned.

## How does transcoding work?

- If a client (or the per-user setting `max_bitrate_kbps` / `transcode_format`) asks for a lower bitrate or a different format than the stored file, Sonarly transcodes on the fly with ffmpeg (target codecs: MP3, AAC, or Opus). Otherwise the original file is streamed directly — no re-encode, no cache.
- Transcoding is capped server-wide at `SONARLY_TRANSCODE_CONCURRENCY` simultaneous ffmpeg processes (default 2). When the cap is reached, additional transcode requests get a 503 with a retry hint; direct streams are never blocked by it.
- Per-user caps set in the user profile (or requested by the client) win over the raw file: effective bitrate = min(requested, user cap).

## Can I run it without Docker?

Yes. The server is a single Go binary: `cd server && go build ./cmd/sonarly`, set `SESSION_SECRET` and `SONARLY_LIBRARY_PATH`, and run it; build the web client with pnpm and point `SONARLY_WEB_DIST` at the output, or run API-only. ffmpeg is needed for transcoding, python3 + Mutagen for tag writes. See [development.md](development.md).

## How do I back up?

Stop the container (or use the SQLite `.backup` command for a live consistent snapshot) and copy the data folder (`./config/sonarly/data` in the default compose layout) plus your music. The catalog itself never needs backup — a scan rebuilds it from the files. See [troubleshooting.md](troubleshooting.md#sqlite-database-is-locked-and-how-to-back-up) and [deployment.md](deployment.md#backup-and-rollback).

## Does playback gap across tracks work?

Yes. The web player preloads the next track (shuffle/repeat-aware) on a hidden audio element in the last 30 seconds of the current one, so consecutive tracks play without a gap. Direct streams serve the original bytes, so client-side gapless behavior in Subsonic apps (e.g. Symphonium) also works.

## What happens to files I delete from the library folder?

On the next scan they are marked inactive: they leave browsing, search, and client sync, but their database rows (and your history) are retained rather than destroyed. Re-adding the file reactivates it. This is why scanning is safe to run at any time.

## Is there podcast or internet-radio support?

No. The OpenSubsonic endpoints for podcasts and internet radio stations exist and return valid empty collections so clients that sync them don't error — there is no podcast download or radio management in Sonarly.
