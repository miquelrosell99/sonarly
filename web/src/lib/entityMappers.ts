// Wire-to-domain mappers (audit F17, plan 10d). The generated OpenAPI schema
// is the source of truth for the wire; these adapters are the single,
// documented choke points where a *known-partial* wire shape (playlist entry,
// search hit) is widened to the full domain type. Every default a mapper
// invents is written down here instead of being scattered as `as unknown as`
// casts at the call sites — the same discipline as `normalizeSyncedLyrics`.
import type { components } from '../contract/schema.js';
import type { Playlist, Song } from '../types';

type PlaylistEntry = components['schemas']['PlaylistEntry'];
type SearchSong = components['schemas']['SearchSong'];
type SearchPlaylist = components['schemas']['SearchPlaylist'];

/**
 * Adapt a playlist-detail entry (`PlaylistEntry` wire shape — row-level
 * fields only, `track`/`duration` nullable, display names in `artist`/
 * `album`) to the full Song domain type. A playlist row is by definition an
 * active, library-resident track, so `active` is true and `starred` is false;
 * the entry carries no mtime/cover-missing/gapless data, so those take their
 * zero values (nothing reads them on the playlist-row path).
 */
export function songFromPlaylistEntry(entry: PlaylistEntry): Song {
  // Drop the PlaylistEntry-only fields (type/isDir/created ride along in the
  // wire shape for legacy clients; a Song has no use for them).
  const { track, discNumber, duration, artist, album, type: _type, isDir: _isDir, created: _created, ...rest } = entry;
  return {
    ...rest,
    trackNumber: track ?? undefined,
    discNumber: discNumber ?? undefined,
    duration: duration ?? undefined,
    artistName: artist,
    albumName: album,
    active: true,
    starred: false,
    coverArtMissing: false,
    gapless: false,
    mtime: 0,
  };
}

/**
 * Adapt a search hit (`SearchSong` — a display subset) to the full Song
 * domain type. The subset carries everything the player and editors read;
 * only the two required booleans the subset omits get defaults (`coverArt`
 * presence is a search-response non-concern; gapless defaults off, matching
 * the server DTO default).
 */
export function songFromSearchSong(hit: SearchSong): Song {
  return {
    ...hit,
    coverArtMissing: false,
    gapless: false,
  };
}

/**
 * Adapt a search hit (`SearchPlaylist`) to the playlist list-item type. The
 * search subset omits `resolveMode`; 'tracks' is the server-documented
 * default ("resolve against the owner's data"). `songIds` stays empty, as
 * the search schema already declares.
 */
export function playlistFromSearchPlaylist(hit: SearchPlaylist): Playlist {
  return { ...hit, resolveMode: 'tracks' };
}
