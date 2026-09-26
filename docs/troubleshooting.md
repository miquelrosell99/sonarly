# Troubleshooting

Problem → cause → fix, ordered by how often each comes up in self-hosted setups.

## Container unhealthy or keeps restarting

- **Cause:** invalid configuration — the server exits at boot when `SESSION_SECRET` is missing/shorter than 32 characters or `SONARLY_LIBRARY_PATH` is unset.
- **Fix:** `docker logs sonarly` shows the exact complaint (`invalid configuration: SESSION_SECRET must be set and at least 32 characters`). Generate a secret with `openssl rand -hex 32`, set `LIBRARY_MUSIC`, and recreate the container (`docker compose up -d`).
- **Cause:** the healthcheck fails while migrations run on first boot of a large database.
- **Fix:** the check has a 15 s start period and retries; give first boot a minute. `curl -f http://localhost:4533/healthz` should return 200 once up (`/ready` also exists).

## Library stays empty after adding files

- **Cause:** the files landed outside the library folder. Only `SONARLY_LIBRARY_PATH` is scanned; the ingest folder is *not* part of the library.
- **Fix:** put files in the library folder (or a per-library subfolder of the ingest folder, or use the upload dialog), then wait for the watcher (default poll every 5 s) or trigger a scan: Admin → System tasks → run the scan task, or `curl -X POST -H "Cookie: <session>" http://localhost:4533/api/scans`.
- **Cause:** the library is a network share (NFS/SMB) where modification times and directory listings are unreliable, so the watcher misses changes.
- **Fix:** raise `SONARLY_WATCH_POLL_INTERVAL` (e.g. 30–60 s) and rely on the periodic full scan (`SONARLY_SCAN_INTERVAL_MINUTES`); polling is used precisely because it works where inotify does not.
- **Cause:** the wrong host path is mounted.
- **Fix:** compare `LIBRARY_MUSIC` on the host with the container's view: `docker exec sonarly ls /media/music | head`.

## Subsonic client can't connect

- **Cause:** the wrong URL. Clients must point at `/rest` (e.g. `http://host:4533/rest`), not the server root.
- **Cause:** legacy plaintext-password auth. Sonarly only accepts token+salt (`u`/`t`/`s`) or API keys — the same mechanism mainstream clients use when you enter username + password in their "Subsonic" auth mode. There is no `p=` password mode.
- **Fix:** in the client, select token auth (often labeled just "Subsonic"), use your Sonarly username/password, and disable any "legacy password" option.
- **Cause:** `SESSION_SECRET` was rotated. The secret seals each user's stored Subsonic password; changing it makes every stored password undecryptable, so token derivation fails even with the right username/password.
- **Fix:** re-enter the password in the client (which re-registers the sealed password), or better: avoid rotating the secret; treat it like a root key (see [configuration.md](configuration.md)).
- **Cause:** the user has no library assigned. Streams and catalog are scoped to assigned libraries; with none assigned the client sees an empty server.
- **Fix:** Admin → Users → assign at least one library.

## SQLite: "database is locked", and how to back up

- **Cause:** another process opened the database file while the server runs (copying it live, or a second container pointing at the same `sonarly.db`).
- **Fix:** only one Sonarly instance per database file. For backups, don't copy the raw files while the server writes — use the SQLite online backup so WAL state is included:
  - `docker exec sonarly wget -qO- http://localhost:3000/healthz >/dev/null` first, then
  - `sqlite3 /path/to/data/sonarly.db ".backup '/path/to/backups/sonarly-$(date +%F).db'"` (the `.backup` command checkpoints the WAL and copies a consistent snapshot).
  - Alternatively stop the container and copy the whole data folder.
- **Fix (temp pressure):** the server runs a single writer with `busy_timeout`; "locked" errors under normal operation indicate the backup/second-accessor case above, not tuning.

## Artwork is missing

- **Cause:** the files have no embedded cover art, and no `cover.jpg`/`folder.jpg` in the album folder. Sonarly reads embedded art and cached covers; it does not guess artwork from filenames beyond the standard companion-image scan.
- **Fix:** embed art in the tags (the tag editor can set album cover art, which propagates to its songs), or add a companion image to the album folder and rescan.
- **Cause:** artist images are missing for obscure artists.
- **Fix:** artist images come from an external metadata provider during the artist-image sync (Admin → System tasks); if the artist is not found there, no image is shown. The sync is rate-limited by design.

## Files park in `review/` and never import

- **Cause:** the file failed ingest validation: unknown/unsupported extension, unparseable tags, or missing required tags (title, artist, album).
- **Fix:** the ingest-runs dashboard (Admin) lists each rejected file and why. Fix the tags (a tag editor on your desktop, or fix in place and re-drop), move the file back into the ingest folder, and the next sweep imports it. Files in `review/` are auto-deleted after the retention period (default 30 days, see [configuration.md](configuration.md)) — don't treat it as long-term storage.

## Duplicate uploads behave unexpectedly

- **Cause:** the duplicate strategy does something different than expected. On a checksum/tag match (same title + album + artist), the strategy decides what survives:
  - `skip` — keep the existing file, drop the upload.
  - `replace_file_and_metadata` — the uploaded file overwrites the existing one.
  - `keep_file_replace_metadata` — keep the existing file, overwrite its tags with the upload's (default).
  - `replace_file_aggregate_metadata` / `keep_file_aggregate_metadata` — same, but merge multi-value metadata instead of replacing.
- **Fix:** pick the strategy per upload in the upload dialog (it defaults to the server setting). If a file was already replaced and you preferred the old one, restore from your backups — replacements are real file operations.

## Performance with large libraries

- **Symptoms:** slow first scan, slow first search, heavy initial page load.
- **Fixes:**
  - First scan of a large library is one-time; rescans use fast paths (mtime + checksum). Schedule it (`SONARLY_SCAN_INTERVAL_MINUTES`) for quiet hours.
  - Keep the database on local disk, not a network share — SQLite on NFS/SMB is the single biggest slowdown.
  - Long lists and grids are virtualized; if the UI feels heavy on an old device, the per-route lazy loading already limits what downloads — check browser dev tools for slow cover-art responses before blaming the app.
  - Transcodes are capped at `SONARLY_TRANSCODE_CONCURRENCY` (default 2) to protect the CPU; clients that request a bitrate cap get ffmpeg, others stream the original file directly (see [faq.md](faq.md#how-does-transcoding-work)).
