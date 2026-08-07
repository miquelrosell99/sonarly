# Sonarly API Reference

Sonarly exposes two HTTP APIs from a single Fastify process:

1. **Management REST API** at `/api/*` — used by the React web UI.
2. **OpenSubsonic API** at `/rest/*` — compatible with Subsonic clients.

The server also serves the built React SPA at `/*` in production.

---

## Authentication

### Management API (`/api/*`)

The management API uses cookie-based sessions (`@fastify/session`).

- Login via `POST /api/login`.
- Logout via `POST /api/logout`.
- The following endpoints are public (no session required):
  - `POST /api/login`
  - `POST /api/logout`
  - `GET /api/setup`
  - `POST /api/setup`
  - `GET /api/me`
  - `GET /api/avatars/:userId`
  - `GET /api/playlists/:id?shareToken=...` (share-token access)
- All other `/api/*` routes require a valid session cookie.
- Some routes additionally require the user to be an admin (`isAdmin === true`).

Session cookie attributes:

- `httpOnly: true`
- `sameSite: strict`
- `secure` controlled by `SESSION_COOKIE_SECURE` (default `false`)
- `maxAge: 7 days`

### OpenSubsonic API (`/rest/*`)

Subsonic clients can authenticate using any of the following methods (checked in order):

1. **API key** — pass `apiKey` query parameter or `X-Api-Key` header.
2. **Token authentication** — pass `u` (username), `t` (token), and `s` (salt). The token is derived from the user's Subsonic password.
3. **Password authentication** — pass `u` (username) and `p` (password). Legacy `enc:` hex encoding is supported.
4. **Session cookie** — if the caller already has a valid web UI session, it is reused.

The response format is selected with the `f` query parameter (`json` default, `xml` supported). All successful responses are wrapped in a `subsonic-response` envelope:

```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "type": "sonarly",
    "serverVersion": "0.1.0",
    "openSubsonic": true
  }
}
```

---

## Management REST API

### Authentication & setup

#### `POST /api/login`

Create a session.

**Body:**

```json
{
  "username": "string",
  "password": "string"
}
```

**Response:** `200 OK`

```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "isAdmin": true,
    "createdAt": "iso-date",
    "name?": "string",
    "surname?": "string",
    "email?": "string",
    "avatarUrl?": "/api/avatars/:userId"
  }
}
```

**Errors:** `401 Invalid credentials`

---

#### `POST /api/logout`

Destroy the current session.

**Response:** `200 OK` `{ "ok": true }`

---

#### `GET /api/me`

Return the currently authenticated user.

**Response:** `200 OK` `{ "user": { ... } }`  
**Errors:** `401 Unauthorized`

---

#### `GET /api/setup`

Check whether the server needs initial setup (no users exist).

**Response:** `200 OK` `{ "needsSetup": true | false }`

---

#### `POST /api/setup`

Create the first admin user. Only works when `users` is empty.

**Body:**

```json
{
  "username": "string",
  "password": "string",
  "name?": "string",
  "surname?": "string",
  "email?": "string"
}
```

**Response:** `201 Created` `{ "user": { ... } }`  
**Errors:** `403 Setup already completed`, `400 Username/password required`

---

### Current user profile

#### `PATCH /api/me`

Update the current user's profile (`name`, `surname`, `email`).

**Response:** `200 OK` `{ "user": { ... } }`

---

#### `POST /api/me/avatar`

Upload an avatar image for the current user.

- Allowed: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Max size: 2 MB

**Response:** `200 OK` `{ "user": { ... } }`

---

#### `GET /api/avatars/:userId`

Serve a user's avatar image.

---

### Users (admin)

#### `GET /api/admin/users`

**Admin only.** List all users.

**Response:** `200 OK` `{ "users": [ { id, username, isAdmin, createdAt, name?, surname?, email?, avatarUrl? } ] }`

---

#### `POST /api/admin/users`

**Admin only.** Create a new user.

**Body:**

```json
{
  "username": "string",
  "password": "string",
  "isAdmin?": false,
  "name?": "string",
  "surname?": "string",
  "email?": "string",
  "transcodeFormat?": "mp3 | aac | opus",
  "maxBitrateKbps?": 320
}
```

**Response:** `201 Created` `{ "ok": true }`  
**Errors:** `409 Username already exists`

---

#### `PUT /api/admin/users/:id`

**Admin only.** Update a user's role, profile, password, transcode settings, and explicit-content filters. Omit `password` to leave the current password unchanged. Demoting the last remaining admin returns `409`.

**Body:**

```json
{
  "isAdmin?": false,
  "name?": "string | null",
  "surname?": "string | null",
  "email?": "string | null",
  "password?": "string",
  "transcodeFormat?": "mp3 | aac | opus | null",
  "maxBitrateKbps?": 320,
  "hideExplicit?": false,
  "blurExplicitTitles?": false,
  "blurExplicitCovers?": false
}
```

**Response:** `200 OK` `{ "ok": true }`  
**Errors:** `404 User not found`, `409 Cannot remove the last admin`

---

#### `DELETE /api/admin/users/:id`

**Admin only.** Delete a user. Admins cannot delete their own account, and the last admin cannot be deleted.

**Response:** `200 OK` `{ "ok": true }`  
**Errors:** `404 User not found`, `409 Cannot delete your own account`, `409 Cannot delete the last admin`

---

### Libraries (admin)

Libraries are managed from `/admin/libraries`. Host folders are bind-mounted into the container (e.g. under `/media`) and then mapped to named libraries in Sonarly. The scanner and file watcher read from every configured library.

#### `GET /api/admin/libraries`

**Admin only.** List configured libraries.

**Response:** `200 OK`

```json
{
  "libraries": [
    { "id": "uuid", "name": "Music", "path": "/media/music", "createdAt": "iso-date", "updatedAt": "iso-date" }
  ]
}
```

---

#### `POST /api/admin/libraries`

**Admin only.** Create a library.

**Body:** `{ "name": "string", "path": "string" }`

**Response:** `201 Created` `{ "ok": true }`  
**Errors:** `409 Library path already exists`

---

#### `PUT /api/admin/libraries/:id`

**Admin only.** Update a library name or path.

**Body:** `{ "name?": "string", "path?": "string" }`

**Response:** `200 OK` `{ "ok": true }`  
**Errors:** `404 Library not found`, `409 Library path already exists`

---

#### `DELETE /api/admin/libraries/:id`

**Admin only.** Delete a library. Songs already in the database are not removed, but the path is no longer scanned.

**Response:** `200 OK` `{ "ok": true }`  
**Errors:** `404 Library not found`

---

### System tasks (admin)

#### `GET /api/admin/system-tasks`

**Admin only.** List background system tasks and their latest status.

**Response:** `200 OK`

```json
{
  "tasks": [
    {
      "id": "periodic_scan | review_cleanup | artist_images",
      "name": "string",
      "description": "string",
      "intervalMinutes": 60,
      "lastRunAt": "iso-date | null",
      "status": "pending | running | completed | failed | null"
    }
  ]
}
```

---

#### `POST /api/admin/system-tasks/:taskId/run`

**Admin only.** Queue a system task to run immediately.

**Response:** `202 Accepted` `{ "ok": true }`

---

#### `GET /api/admin/system-tasks/history`

**Admin only.** Paginated history of system task runs.

**Query:** `?page=1&limit=10`

**Response:** `200 OK`

```json
{
  "history": [ { "id", "task", "type", "status", "startedAt", "finishedAt", "stats?" } ],
  "page": 1,
  "limit": 10,
  "total": 0,
  "totalPages": 0
}
```

---

### Server status (admin)

#### `GET /api/admin/status`

**Admin only.** Return counts and latest ingest job status.

**Response:** `200 OK`

```json
{
  "counts": { "users": 0, "songs": 0, "albums": 0, "artists": 0 },
  "latestIngest": { "type", "status", "startedAt", "finishedAt", "stats?" } | null
}
```

---

### Missing entities (admin)

#### `GET /api/admin/missing`

**Admin only.** List inactive (`active = 0`) songs, albums, and artists.

**Response:** `200 OK` `{ "songs": [...], "albums": [...], "artists": [...] }`

---

#### `DELETE /api/admin/missing/songs/:id`

**Admin only.** Permanently delete an inactive song row.

**Response:** `200 OK` `{ "ok": true }`

---

#### `DELETE /api/admin/missing/albums/:id`

**Admin only.** Permanently delete an inactive album row.

**Response:** `200 OK` `{ "ok": true }`

---

#### `DELETE /api/admin/missing/artists/:id`

**Admin only.** Permanently delete an inactive artist row.

**Response:** `200 OK` `{ "ok": true }`

---

### Songs

#### `GET /api/songs`

List active songs.

**Query:** `?genre=<string>` (optional)

**Response:** `200 OK` `{ "songs": [Song] }` (max 500)

`Song` shape includes `id`, `filePath`, `title`, `trackNumber`, `discNumber`, `duration`, `artistId`, `albumId`, `genre`, `year`, `explicit`, `coverArt`, `mtime`, `checksum`, `active`, `artistName`, `albumName`, `albumArtistName`, `starred`, `rating`, `lyrics`, and many optional metadata fields.

---

#### `GET /api/songs/:id`

Get a single song.

**Response:** `200 OK` `{ "song": Song }`  
**Errors:** `404 Song not found`

---

#### `PUT /api/songs/:id/tags`

**Admin only.** Write metadata tags to the audio file and reorganize the file into the configured pattern.

**Body (SongTags):**

```json
{
  "title?": "string",
  "artist?": "string",
  "album?": "string",
  "albumArtist?": "string",
  "trackNumber?": 1,
  "discNumber?": 1,
  "genre?": "string",
  "year?": 2024,
  "explicit?": false,
  "lyrics?": "string"
}
```

**Response:** `200 OK` `{ "ok": true, "orphanedEntities?": [...] }`

---

#### `POST /api/songs/:id/scrobble`

Record a play event for the current user.

**Body (optional):**

```json
{
  "durationListened?": 120,
  "completion?": 0.5,
  "client?": "string",
  "source?": "string",
  "playedAt?": "iso-date"
}
```

**Response:** `200 OK` `{ "ok": true }`

---

#### `DELETE /api/songs/:id`

**Admin only.** Delete the audio file and remove the database row.

**Response:** `200 OK` `{ "ok": true }`

---

#### `POST /api/songs/:id/cover-art`

**Admin only.** Upload a cover art image for a song.

- Allowed: `image/jpeg`, `image/png`, `image/webp`
- Max size: 2 MB

**Response:** `200 OK` `{ "coverArt": "cover-art-id" }`

---

#### `DELETE /api/songs/:id/cover-art`

**Admin only.** Remove the cover art reference from a song.

**Response:** `200 OK` `{ "ok": true }`

---

### Song lyrics

#### `GET /api/songs/:id/lyrics`

Get plain and synced lyrics for a song.

**Response:** `200 OK`

```json
{
  "lyrics?": "string",
  "syncedLyrics?": [ { "time": 0, "text": "string" } ]
}
```

---

#### `PUT /api/songs/:id/lyrics`

**Admin only.** Write lyrics to the audio file.

**Body:**

```json
{
  "lyrics?": "string",
  "syncedLyrics?": [ { "time": 0, "text": "string" } ]
}
```

**Response:** `200 OK` `{ "ok": true }`

---

### Albums

#### `GET /api/albums`

List active albums.

**Response:** `200 OK` `{ "albums": [Album] }` (max 500)

`Album` shape includes `id`, `name`, `artistId`, `artistName`, `year`, `genre`, `coverArt`, `active`, `starred`, `rating`, `totalSongCount`, `shownSongCount`.

---

#### `GET /api/albums/:id`

Get an album with its songs.

**Response:** `200 OK`

```json
{
  "album": Album,
  "songs": [Song]
}
```

---

#### `PUT /api/albums/:id/tags`

**Admin only.** Write tags to all songs in the album and reorganize each file.

**Body:** Same as `SongTags`.

**Response:** `200 OK` `{ "updated": 10 }`

---

#### `DELETE /api/albums/:id`

**Admin only.** Delete all audio files in the album and remove the album row.

**Response:** `200 OK` `{ "ok": true }`

---

#### `POST /api/albums/:id/cover-art`

**Admin only.** Upload cover art for all songs in an album.

**Response:** `200 OK` `{ "coverArt": "cover-art-id" }`

---

#### `DELETE /api/albums/:id/cover-art`

**Admin only.** Remove the album cover art reference.

**Response:** `200 OK` `{ "ok": true }`

---

### Artists

#### `GET /api/artists`

List active artists.

**Response:** `200 OK` `{ "artists": [Artist] }`

`Artist` shape includes `id`, `name`, `active`, `starred`, `rating`.

---

#### `GET /api/artists/:id`

Get an artist with their albums.

**Response:** `200 OK`

```json
{
  "artist": {
    "id": "uuid",
    "name": "string",
    "active": true,
    "starred": false,
    "rating?": 5,
    "artistImageUrl?": "/api/artist-images/:id",
    "albums": [Album]
  }
}
```

---

#### `GET /api/artists/:id/songs`

Get all active songs by an artist.

**Response:** `200 OK` `{ "songs": [Song] }`

---

#### `GET /api/artist-images/:id`

Serve a locally cached artist image.

**Response:** image binary  
**Errors:** `404 Artist image not found`

---

#### `DELETE /api/artists/:id`

**Admin only.** Delete an artist only if they have no active songs. Empty albums belonging to the artist are also removed.

**Response:** `200 OK` `{ "ok": true, "deletedAlbums": 0 }`  
**Errors:** `409 Cannot delete artist with active songs`

---

### Genres

#### `GET /api/genres`

List all genres with their full hierarchical path.

**Response:** `200 OK`

```json
{
  "genres": [
    { "id": "uuid", "name": "string", "parentId?": "uuid", "path": "Parent > Child", "active": true }
  ]
}
```

---

#### `GET /api/genres/tree`

Return genres as a nested tree.

**Response:** `200 OK` `{ "tree": [GenreNode] }`

---

#### `POST /api/genres`

**Admin only.** Create a genre.

**Body:** `{ "name": "string", "parentId?": "uuid" }`

**Response:** `201 Created` `{ "genre": { ... } }`

---

#### `PUT /api/genres/:id`

**Admin only.** Update a genre name or parent.

**Body:** `{ "name?": "string", "parentId?": "uuid | null" }`

**Response:** `200 OK` `{ "genre": { ... } }`

---

#### `DELETE /api/genres/:id`

**Admin only.** Delete a genre. Must have no active children. Referenced songs/albums get `genre_id` set to `NULL`.

**Response:** `200 OK` `{ "ok": true }`  
**Errors:** `409 Cannot delete genre with children`

---

### Years

#### `GET /api/years`

Return all distinct years present in songs and albums.

**Response:** `200 OK` `{ "years": [2024, 2023, ...] }`

---

### Playlists

#### `GET /api/playlists`

List playlists visible to the current user.

**Response:** `200 OK`

```json
{
  "playlists": [
    {
      "id": "uuid",
      "name": "string",
      "ownerId": "uuid",
      "ownerUsername": "string",
      "visibility": "private | shared | public | link",
      "shareToken?": "string",
      "isSmart": false,
      "songCount": 0,
      "createdAt": "iso-date",
      "updatedAt": "iso-date",
      "starred": false,
      "rating?": 5
    }
  ]
}
```

---

#### `GET /api/playlists/:id`

Get a playlist and its entries. Public/shared/link playlists can be accessed by other users; link playlists require the matching `shareToken`.

**Query:** `?shareToken=string` (required for `link` visibility when not owner)

**Response:** `200 OK`

```json
{
  "playlist": {
    ...Playlist,
    "songCount": 0,
    "entries": [SongEntry],
    "starred": false,
    "rating?": 5
  }
}
```

---

#### `POST /api/playlists`

Create a playlist.

**Body:**

```json
{
  "name": "string",
  "visibility?": "private | shared | public | link",
  "songIds?": ["uuid"],
  "isSmart?": false,
  "rules?": SmartPlaylistRules
}
```

**Response:** `201 Created` `{ "playlist": Playlist }`

---

#### `PUT /api/playlists/:id`

Update a playlist. Owners or users with `can_edit` share can modify.

**Body:**

```json
{
  "name?": "string",
  "visibility?": "private | shared | public | link",
  "songIds?": ["uuid"],
  "rules?": SmartPlaylistRules,
  "isSmart?": false
}
```

**Response:** `200 OK` `{ "playlist": Playlist }`

Smart playlists:
- Cannot manually edit `songIds`.
- Converting a smart playlist to manual (`isSmart: false`) freezes the current resolved song list.

---

#### `DELETE /api/playlists/:id`

Delete a playlist. Only the owner can delete.

**Response:** `200 OK` `{ "ok": true }`

---

#### `POST /api/playlists/:id/share`

Share a playlist with another user.

**Body:** `{ "userId": "uuid", "canEdit?": false }`

**Response:** `200 OK` `{ "ok": true }`

---

#### `DELETE /api/playlists/:id/share/:userId`

Revoke a share.

**Response:** `200 OK` `{ "ok": true }`

---

### Favorites and ratings

#### `POST /api/favorites`

Toggle the starred state of a song, album, artist, or playlist.

**Body:**

```json
{
  "entityType": "song | album | artist | playlist",
  "entityId": "uuid",
  "starred": true
}
```

**Response:** `200 OK` `{ "ok": true }`

---

#### `POST /api/ratings`

Set a 0–5 rating for a song, album, artist, or playlist.

**Body:**

```json
{
  "entityType": "song | album | artist | playlist",
  "entityId": "uuid",
  "rating?": 5
}
```

**Response:** `200 OK` `{ "ok": true }`

---

### Search

#### `GET /api/search?q=<query>`

Search songs, albums, artists, and playlists visible to the current user.

**Response:** `200 OK`

```json
{
  "songs": [Song],
  "albums": [Album],
  "artists": [Artist],
  "playlists": [Playlist]
}
```

Each list is capped at 50 results.

---

### Home / discovery

#### `GET /api/home`

Return discovery rows for the home page.

**Response:** `200 OK`

```json
{
  "genres": ["Rock", "Pop", ...],
  "mostPlayed": [Album],
  "random": [Album],
  "recentlyAdded": [Album],
  "recentlyPlayed": [Album]
}
```

Each album list is capped at 10.

---

### Cover art

#### `GET /api/cover-art/:id`

Serve a cached cover art image by `cover_art_id`.

**Response:** image binary  
**Errors:** `404 Not found`

---

### Library scan

#### `POST /api/scans`

**Admin only.** Trigger a full library scan.

**Response:** `200 OK` `{ "ok": true }`

---

#### `GET /api/scans/status`

Return the latest scan/resync job.

**Response:** `200 OK` `{ "job": ScanJob | null }`

---

### Ingest

#### `GET /api/ingest`

**Admin only.** List recent ingest jobs.

**Response:** `200 OK` `{ "jobs": [IngestJob] }`

---

#### `POST /api/ingest/trigger`

**Admin only.** Queue an ingest job.

**Response:** `200 OK` `{ "ok": true }`

---

### Library organization (admin)

#### `POST /api/organize`

**Admin only.** Run library organization immediately and return stats.

**Response:** `200 OK` `{ "stats": { ... } }`

---

#### `POST /api/organize/job`

**Admin only.** Queue an organize job.

**Response:** `200 OK` `{ "jobId": "uuid" }`

---

#### `GET /api/organize/preview`

Return the currently configured organization pattern.

**Response:** `200 OK` `{ "pattern": "{albumArtist}/({year}) {album}/..." }`

---

#### `GET /api/organize/status/:jobId`

**Admin only.** Get status of a queued organize job.

**Response:** `200 OK` `{ "job": OrganizeJobStatus }`

---

### Settings (admin)

#### `GET /api/settings/media`

**Admin only.** Return the current organize pattern and built-in templates.

**Response:** `200 OK`

```json
{
  "organizePattern": "string",
  "templates": [ { "label": "string", "value": "string" } ]
}
```

---

#### `PATCH /api/settings/media`

**Admin only.** Update the organize pattern.

**Body:** `{ "organizePattern": "string" }`

The pattern must be relative and must not contain `..` or null bytes.

**Response:** `200 OK` `{ "organizePattern": "string" }`

---

### Conflicts (admin)

#### `GET /api/conflicts`

**Admin only.** List songs whose file paths look like collision duplicates (e.g., `Title (2).mp3`).

**Response:** `200 OK`

```json
{
  "conflicts": [
    { "id": "uuid", "filePath": "string", "title": "string", "artistName?": "string", "albumName?": "string" }
  ]
}
```

---

### Suggestions (admin)

#### `GET /api/suggestions?field=artist&q=<query>&limit=20`

**Admin only.** Autocomplete suggestions for metadata editing.

Supported `field` values: `artist`, `album`, `albumArtist`, `genre`.

**Response:** `200 OK` `{ "suggestions": ["string"] }`

---

### User preferences

#### `GET /api/me/preferences`

Return the current user's UI preferences.

**Response:** `200 OK` `{ "preferences": UserPreferences }`

---

#### `PATCH /api/me/preferences`

Update the current user's UI preferences. Partial updates are merged.

**Response:** `200 OK` `{ "preferences": UserPreferences }`

---

### Players

#### `GET /api/players`

Return active playback sessions for the current user.

**Response:** `200 OK` `{ "players": [PlayerInfo] }`

---

## OpenSubsonic API

All endpoints are `GET` and require authentication as described above.

### System

| Endpoint | Description |
|----------|-------------|
| `GET /rest/ping.view` | Health check |
| `GET /rest/getLicense.view` | Returns `{ license: { valid: true } }` |
| `GET /rest/getOpenSubsonicExtensions.view` | Returns empty extensions list |
| `GET /rest/getUser.view` | Returns current user capabilities |

### Browsing

| Endpoint | Description |
|----------|-------------|
| `GET /rest/getMusicFolders.view` | Returns configured library folders |
| `GET /rest/getIndexes.view` | Artist index |
| `GET /rest/getArtists.view` | All artists |
| `GET /rest/getArtist.view?id=<artistId>` | Artist with albums |
| `GET /rest/getAlbum.view?id=<albumId>` | Album with songs |
| `GET /rest/getSong.view?id=<songId>` | Single song |
| `GET /rest/getAlbumList.view?type=<type>&size=20&offset=0&genre=&fromYear=&toYear=` | Album list (legacy) |
| `GET /rest/getAlbumList2.view?type=<type>&size=20&offset=0&genre=&fromYear=&toYear=` | Album list |
| `GET /rest/getSongsByGenre.view?genre=<genre>&count=10&offset=0` | Songs by genre |
| `GET /rest/getRandomSongs.view?size=10&genre=&fromYear=&toYear=` | Random songs |
| `GET /rest/getGenres.view` | Genre list with counts |
| `GET /rest/getArtistInfo2.view?id=<artistId>&count=20` | Artist biography / similar artists |
| `GET /rest/getAlbumInfo2.view?id=<albumId>` | Album notes / similar albums |
| `GET /rest/getSimilarSongs2.view?id=<artistId>&count=50` | Similar songs for an artist |
| `GET /rest/getTopSongs.view?artist=<name>&count=50` | Top songs for an artist name |
| `GET /rest/search3.view?query=<term>&artistCount=20&artistOffset=0&albumCount=20&albumOffset=0&songCount=20&songOffset=0` | Search 2.0 |

Supported `getAlbumList` / `getAlbumList2` types: `alphabeticalByName`, `alphabeticalByArtist`, `newest`, `recent`, `frequent`, `random`, `byYear`, `byGenre`.

### Retrieval

| Endpoint | Description |
|----------|-------------|
| `GET /rest/stream.view?id=<songId>` | Stream audio (supports `Range` requests) |
| `GET /rest/download.view?id=<songId>` | Download original file |
| `GET /rest/getCoverArt.view?id=<id>` | Cover art (accepts song, album, or `cover_art_id`) |
| `GET /rest/getLyrics.view?id=<songId>` | Plain lyrics for a song |

### Playlists

| Endpoint | Description |
|----------|-------------|
| `GET /rest/getPlaylists.view` | List visible playlists |
| `GET /rest/getPlaylist.view?id=<id>&shareToken=<token>` | Playlist entries |
| `GET /rest/createPlaylist.view?name=&songId=&visibility=` | Create a playlist |
| `GET /rest/updatePlaylist.view?playlistId=&name=&songId=&songIdToAdd=&songIndexToRemove=&visibility=` | Update a playlist |
| `GET /rest/deletePlaylist.view?id=<id>` | Delete a playlist |

### Starring, rating, scrobbling

| Endpoint | Description |
|----------|-------------|
| `GET /rest/getStarred2.view?artistCount=20&albumCount=20&songCount=20` | Starred artists, albums, and songs |
| `GET /rest/star.view?id=&albumId=&artistId=` | Star entities |
| `GET /rest/unstar.view?id=&albumId=&artistId=` | Unstar entities |
| `GET /rest/setRating.view?id=<songId>&rating=5` | Rate a song |
| `GET /rest/scrobble.view?id=<songId>` | Scrobble a play |

### Bookmarks

| Endpoint | Description |
|----------|-------------|
| `GET /rest/getBookmarks.view` | List playback position bookmarks for the authenticated user |
| `GET /rest/createBookmark.view?id=<songId>&position=<ms>&comment=<text>` | Create or update a bookmark |
| `GET /rest/deleteBookmark.view?id=<songId>` | Delete a bookmark |

### Activity

| Endpoint | Description |
|----------|-------------|
| `GET /rest/getNowPlaying.view` | Recently played tracks across users |

