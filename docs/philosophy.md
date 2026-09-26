# Sonarly's Philosophy

Sonarly is built around a few stubborn ideas about how a personal music server should behave. Everything in the product traces back to these principles.

## Your music stays on your disk, in your folder structure

Sonarly is **filesystem-authoritative**: the folders and files you already have are the library. There is no import step that copies your music into a hidden, app-managed store, and no proprietary database you need to keep your collection.

- The server indexes what is on disk; it does not appropriate it. Point `SONARLY_LIBRARY_PATH` at your existing music folder and that folder *is* the library.
- If you stop using Sonarly tomorrow, you have lost nothing: your files are exactly where you left them.
- Where to see it: the library is a plain bind mount (`/media/music` in the container); the admin panel shows and manages library *folders*, not blobs.

## The server indexes, never appropriates

The database is a cache of what is on disk, built to make browsing and searching fast. It can always be rebuilt from the files, and the code is written that way on purpose.

- Scanning, watching, and rescanning reconcile the catalog against the filesystem; nothing about the catalog is sacred.
- Files removed from disk disappear from the catalog on the next scan — and only from the catalog.
- Where to see it: [architecture.md](architecture.md) (the scanner reconciles filesystem ↔ DB) and [db-schema.md](db-schema.md) (SQLite holds metadata, not audio).

## Scans are read-only toward your files

A scan will never modify your audio files. Not to fix tags, not to embed cover art, not to "normalize" anything. The scanner deliberately avoids writing to your files because silent mutation is how music libraries get damaged.

- The one write path to file tags is explicit: the tag editor in the UI, which you invoke yourself. It goes through a separate, audited writer (Mutagen), never through the scanner.
- Organizing/renaming files is equally explicit: it runs only from the ingest pipeline or the organize tool, never as a side effect of playback or scanning.
- Where to see it: [usage.md](usage.md#library-scanning) and [usage.md](usage.md#ingest-review-and-runs).

## Library-first browsing

Your collection is browsed the way music collectors think: by album, artist, genre, year, label, composer — and by the shape of the folders you keep. Search and statistics sit on top of that catalog instead of replacing it.

- The home page surfaces your library back at you (recently added, featured albums); the catalog pages are the primary navigation, not an afterthought behind playlists.
- Multiple libraries are real boundaries: a user's home, search, and streams only ever touch the libraries they are assigned.
- Where to see it: [usage.md](usage.md#browsing) and [usage.md](usage.md#users-and-library-assignment).

## OpenSubsonic is a compatibility promise

Your music should play in the client you like, not just in our web UI. Sonarly implements the OpenSubsonic REST API at `/rest`, which means any Subsonic-compatible client — Feishin, Symphonium, Ultrasonic, DSub, and others — can talk to it.

- This is a contract, maintained deliberately: response envelopes, auth behavior, and per-endpoint quirks are pinned so clients keep working.
- Where to see it: [usage.md](usage.md#subsonic-clients) and [api.md](api.md).

## Boring tech, operated simply

One container, one process, one database file. No external database server, no message broker, no cluster, no plugin zoo.

- The server is a single Go binary with an embedded SQLite database; upgrades are "pull the new image, restart".
- Backups are copying a folder: the SQLite file plus your music. Restoring is copying it back.
- Where to see it: [installation.md](installation.md), [deployment.md](deployment.md), and [faq.md](faq.md#why-sqlite).

## Per-user libraries with real boundaries

Sonarly supports multiple people on one server, and library assignment is a security boundary, not a display filter.

- Every catalog query, search result, stream, and download is scoped to the libraries a user is assigned; admins bypass, everyone else is contained.
- Each user's favorites, ratings, play counts, history, and playlists are their own, keyed by user everywhere.
- Where to see it: [usage.md](usage.md#users-and-library-assignment) and [db-schema.md](db-schema.md).
