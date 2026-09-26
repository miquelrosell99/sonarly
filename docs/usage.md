# Using Sonarly

This guide covers the day-to-day: getting set up, adding music, browsing, playing, playlists, and administration. For installing the server itself, see [installation.md](installation.md); for the interface itself (layout, themes, keyboard behavior), see [ux.md](ux.md).

## First run and setup

1. Start the container (see [installation.md](installation.md)) and open the web UI at `http://<host>:4533`.
2. The first visit redirects to `/setup`: create the admin account (username + password). This account is the server administrator.
3. Log in. The library folder you mounted (`LIBRARY_MUSIC`) is already registered as the default library, and the first scan starts automatically.
4. (Optional) Open Settings (Profile / Appearance / Playback / Sidebar) to adjust the theme, accent color, and player defaults.

## Adding music

There are three ways to get files into the library:

- **Drop files directly into the library folder.** Copy music into the library folder on disk (the host path mounted at `/media/music`). The watcher or the next scan picks it up. Nothing is copied or converted; the file stays where you put it.
- **Drop files into the ingest folder.** Copy files into the per-library subfolder of the ingest folder (`<SONARLY_INGEST_PATH>/<libraryId>/`). The periodic ingest sweep validates, organizes (renames into the library's organize pattern), and imports them. This is the way to add music when you want Sonarly to tidy the folder layout for you.
- **Upload from the browser.** Upload lives in the user menu (between Statistics and Settings). Uploads are chunked, land in the ingest pipeline of the selected library, and go through the same validation and duplicate handling as ingest.

**The review quarantine.** Files that fail validation during ingest (unparseable or missing required tags — title, artist, album) are not imported and not deleted: they are moved to a `review/` folder at the top of the library's folder. Fix the tags there and drop them back into ingest, or delete them. Review files are kept for a retention period (default 30 days, configurable; see [configuration.md](configuration.md)) and then swept automatically.

## Library scanning

The catalog is kept in sync with disk three ways, all read-only toward your files:

- **Watcher:** a filesystem poll (every `SONARLY_WATCH_POLL_INTERVAL` seconds, default 5) detects changes and queues a coalesced resync. Polling (rather than OS file notifications) means it also works on network drives.
- **Periodic scan:** a full reconciliation runs every `SONARLY_SCAN_INTERVAL_MINUTES` (default 60).
- **Manual trigger:** admins can trigger a scan from the admin dashboard (System tasks → run, or `POST /api/scans`).

Scanning never edits your files. Files that disappear from disk are marked inactive (they leave search and browsing) rather than deleted; play history and user data are kept.

## Browsing

The sidebar is the front door:

- **Home** — a hero of featured albums plus rows: most played, random albums, recently added, recently played.
- **Albums / Tracks** — the full catalog as cards or a sortable list.
- **Album Artists / Artists** — album-artist view and track-artist view (with bios and images where available).
- **Genres** — the genre tree, including sub-genres.
- **Years** — browse by release year.
- **Composers / Labels** — for classical and electronic collections.

Everything you see is scoped to the libraries assigned to you (see [admin: users](#users-and-library-assignment)). If the library has more than one folder, the library selector at the top of the sidebar switches your view.

## Search

The search box in the top bar searches titles, albums, and artists (full-text, prefix matching). Results are grouped (songs, albums, artists) and scoped to your libraries.

## The player

- **Queue.** Clicking a track in a playlist, album, or genre queues that whole context from the clicked track. The Now Playing view (player bar → expand, or the now-playing route) shows the queue with Queue / Lyrics tabs, and can shuffle, clear, save the queue as a playlist, or refill it with Auto DJ.
- **Gapless.** The next track (shuffle/repeat-aware) is preloaded on a hidden audio element in the last 30 seconds of the current track, so album transitions play seamlessly.
- **Shuffle and repeat.** Shuffle reorders the queue; repeat has off / all / one.
- **Media Session and keyboard.** The player registers with the browser Media Session API: OS media keys, headphone buttons, and lock-screen controls work (play, pause, previous/next track, seek, ±10 s). See [ux.md](ux.md#keyboard-access) for the interface's keyboard behavior.
- **Scrobbling rules.** A play is recorded when you listen past 50% of the track or 4 minutes, whichever comes first (Subsonic convention). Listening time and play counts feed Statistics.
- **Sleep timer.** The player bar's sleep timer (5–60 minutes or end of track) pauses playback and notifies you when it fires.
- **Bookmarks and resume.** The API stores playback-position bookmarks (`/api/bookmarks`); the OpenSubsonic bookmark endpoints are not surfaced to Subsonic clients yet (`getBookmarks` returns an empty list). The web player currently starts tracks from the beginning.
- **Auto DJ.** From the queue panel, Auto DJ refills the queue when it runs out, with modes (Similar / Random / Smart) and settings: exclude recently played (24 h / 7 d / 30 d), prefer favorites, and a familiar↔adventurous dial.

## Playlists

- **Static playlists** are manual track lists: create from the sidebar or save the current queue.
- **Smart playlists** are rules that resolve to tracks at request time — the list updates as the library changes. Rules cover library facts (title, album, artist, genre, release type, year, duration, bit depth) and your personal data (loved, rating, play count, last played), with sorts, limits, and randomization. See [smart-playlists.md](smart-playlists.md) for the rule model.
- **Resolve modes** matter for shared smart playlists: *Shared track list* resolves your rules against your data (every viewer gets the same list); *Live query* re-resolves against each viewer's own data.
- **Sharing.** A playlist can be private, shared with specific users (view or edit role), public to all users on the server, or shared by link. Share links carry a token and open a guest view — cover grid, track list, and playback — without an account. See [smart-playlists.md](smart-playlists.md#resolve-modes) and [api.md](api.md).

## Favorites and ratings

Star (favorite) and rate songs, albums, artists, and playlists from their cards, rows, or detail pages — controls sit on the artwork (hover on desktop, always visible on touch). Ratings run 0–5 in half-star steps. These are per-user: your ratings are yours, and smart playlists can use them.

## Statistics

The Statistics page (user menu) shows your listening time, play counts over time, top tracks/albums/artists/genres, and animated breakdowns by genre and year. Admins can view per-user statistics from the admin dashboard.

## Admin

Admin pages live under `/admin` (Status, Libraries, Media, Users, System tasks, Genres).

### Users and library assignment

Admins create and manage accounts. Each user is assigned one or more libraries, and assignment is a real boundary: every browse, search, stream, and download is limited to the assigned libraries. Assign at least one library or the user sees nothing.

### Libraries

The default library is seeded from `SONARLY_LIBRARY_PATH` on first boot. Additional libraries are folders added in the admin panel (mount more host folders under `/media/...` and register them); each has its own organize pattern and its own ingest subfolder.

### Settings (media)

Retention for the review folder, artist-image sync, and the organize pattern.

### Ingest review and runs

The ingest-runs dashboard lists every processed file (imported, skipped, needs review, failed) so you can see exactly what happened to a dropped file.

### Organize

The organize tool renames the whole library (or a selection) into the configured pattern, with a preview before anything moves.

### Duplicate strategies on upload/ingest

When an incoming file matches one already in the library (same title + album + artist), the chosen strategy decides: skip, replace the file, replace metadata, or aggregate (keep the file and merge metadata). The default keeps the existing file and replaces its metadata; per-upload overrides are available in the upload dialog.

### Missing files and system tasks

The dashboard surfaces files that vanished from disk, and System tasks lists the background jobs (scans, ingest sweeps, artist-image sync, review cleanup) with history; most can be run on demand.

## Subsonic clients

Point any Subsonic/OpenSubsonic client at `http://<host>:4533/rest` and log in with your Sonarly username and password using **token authentication** (the client's default "Subsonic" auth mode; username + password, client generates token+salt). Clients tested include Feishin, Symphonium, and Music Assistant; see [api.md](api.md#opensubsonic-api-rest) for the endpoint surface and known gaps.

Two things to know:

- Each user only sees the libraries assigned to them — the same boundary as the web UI.
- Rotating `SESSION_SECRET` invalidates every stored Subsonic password (it seals them); clients must be re-authenticated after a secret change. See [troubleshooting.md](troubleshooting.md).
