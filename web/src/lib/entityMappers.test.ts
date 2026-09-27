import { describe, it, expect } from 'vitest';
import type { components } from '../contract/schema.js';
import { songFromPlaylistEntry, songFromSearchSong, playlistFromSearchPlaylist } from './entityMappers.js';

type PlaylistEntry = components['schemas']['PlaylistEntry'];
type SearchSong = components['schemas']['SearchSong'];
type SearchPlaylist = components['schemas']['SearchPlaylist'];

const entry = (partial: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  id: 'song-1',
  title: 'First Track',
  album: 'The Album',
  albumId: 'album-1',
  artist: 'The Artist',
  artistId: 'artist-1',
  artists: ['The Artist'],
  artistEntries: [{ id: 'artist-1', name: 'The Artist' }],
  track: 1,
  discNumber: 1,
  duration: 200,
  genre: 'Rock',
  year: 2020,
  explicit: false,
  coverArt: 'cover-1',
  albumCoverArt: 'cover-1',
  type: 'music',
  isDir: false,
  created: '2024-01-01T00:00:00.000Z',
  ...partial,
});

describe('songFromPlaylistEntry', () => {
  it('maps the row-level wire shape to a full Song', () => {
    const song = songFromPlaylistEntry(entry());
    expect(song).toMatchObject({
      id: 'song-1',
      title: 'First Track',
      artistName: 'The Artist',
      albumName: 'The Album',
      trackNumber: 1,
      discNumber: 1,
      duration: 200,
      explicit: false,
      coverArt: 'cover-1',
    });
  });

  it('defaults the fields a playlist row cannot know', () => {
    const song = songFromPlaylistEntry(entry());
    expect(song.active).toBe(true);
    expect(song.starred).toBe(false);
    expect(song.coverArtMissing).toBe(false);
    expect(song.gapless).toBe(false);
    expect(song.mtime).toBe(0);
  });

  it('coerces the nullable track/disc/duration fields to undefined', () => {
    const song = songFromPlaylistEntry(entry({ track: null, discNumber: null, duration: null }));
    expect(song.trackNumber).toBeUndefined();
    expect(song.discNumber).toBeUndefined();
    expect(song.duration).toBeUndefined();
  });

  it('does not leak the PlaylistEntry-only fields onto the Song', () => {
    const song = songFromPlaylistEntry(entry());
    expect(song).not.toHaveProperty('track');
    expect(song).not.toHaveProperty('artist');
    expect(song).not.toHaveProperty('album');
    expect(song).not.toHaveProperty('type');
    expect(song).not.toHaveProperty('isDir');
    expect(song).not.toHaveProperty('created');
  });
});

describe('songFromSearchSong', () => {
  const hit = (partial: Partial<SearchSong> = {}): SearchSong => ({
    id: 'song-1',
    title: 'Alpha Song',
    artistName: 'The Artist',
    albumName: 'The Album',
    duration: 180,
    explicit: false,
    mtime: 42,
    active: true,
    starred: true,
    ...partial,
  });

  it('keeps the search subset fields intact', () => {
    const song = songFromSearchSong(hit());
    expect(song).toMatchObject({
      id: 'song-1',
      title: 'Alpha Song',
      artistName: 'The Artist',
      albumName: 'The Album',
      duration: 180,
      mtime: 42,
      active: true,
      starred: true,
    });
  });

  it('fills only the two required booleans the subset omits', () => {
    const song = songFromSearchSong(hit());
    expect(song.coverArtMissing).toBe(false);
    expect(song.gapless).toBe(false);
  });
});

describe('playlistFromSearchPlaylist', () => {
  const hit = (partial: Partial<SearchPlaylist> = {}): SearchPlaylist => ({
    id: 'playlist-1',
    name: 'Mixtape',
    ownerId: 'user-1',
    ownerUsername: 'user-1',
    visibility: 'private',
    isSmart: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    songIds: [],
    songCount: 7,
    starred: false,
    ...partial,
  });

  it('keeps the search subset fields intact', () => {
    const playlist = playlistFromSearchPlaylist(hit());
    expect(playlist).toMatchObject({
      id: 'playlist-1',
      name: 'Mixtape',
      songCount: 7,
      starred: false,
    });
  });

  it('defaults the omitted resolveMode to the server-documented tracks mode', () => {
    const playlist = playlistFromSearchPlaylist(hit());
    expect(playlist.resolveMode).toBe('tracks');
  });
});
