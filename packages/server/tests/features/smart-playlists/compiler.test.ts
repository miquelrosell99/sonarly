import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
import { getOrCreateGenreByName } from '../../../src/features/genres/repository.js';
import { compileSmartPlaylist } from '../../../src/features/smart-playlists/compiler.js';
import type { SmartPlaylistRules, User, Song, Album, Artist } from '@sonarly/shared';

describe('smart playlist compiler', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);

    createUser(db, {
      id: 'user-1',
      username: 'user',
      passwordHash: 'hash',
      subsonicPasswordEncrypted: 'encrypted',
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });

    const artist: Artist = {
      id: 'artist-1',
      name: 'Radiohead',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertArtist(db, artist);

    const album: Album = {
      id: 'album-1',
      name: 'OK Computer',
      artistId: 'artist-1',
      artistName: 'Radiohead',
      year: 1997,
      genre: 'Alternative Rock',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertAlbum(db, album);

    const songs: Song[] = [
      {
        id: 'song-1',
        filePath: '/data/library/song1.mp3',
        title: 'Airbag',
        artistId: 'artist-1',
        albumId: 'album-1',
        genre: 'Alternative Rock',
        year: 1997,
        duration: 180,
        mtime: Date.now(),
        checksum: 'c1',
      },
      {
        id: 'song-2',
        filePath: '/data/library/song2.mp3',
        title: 'Paranoid Android',
        artistId: 'artist-1',
        albumId: 'album-1',
        genre: 'Alternative Rock',
        year: 1997,
        duration: 240,
        mtime: Date.now(),
        checksum: 'c2',
      },
      {
        id: 'song-3',
        filePath: '/data/library/song3.mp3',
        title: 'Karma Police',
        artistId: 'artist-1',
        albumId: 'album-1',
        genre: 'Alternative Rock',
        year: 1997,
        duration: 210,
        mtime: Date.now(),
        checksum: 'c3',
      },
    ];
    for (const song of songs) {
      upsertSong(db, song);
    }

    const genreId = getOrCreateGenreByName(db, 'Alternative Rock');
    db.prepare('UPDATE songs SET genre_id = ? WHERE genre = ?').run(genreId, 'Alternative Rock');
    db.prepare('UPDATE albums SET genre_id = ? WHERE id = ?').run(genreId, 'album-1');

    db.prepare(`
      INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('user-1', 'song-1', 1, 5, 10, new Date().toISOString());

    db.prepare(`
      INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('user-1', 'song-2', 0, 3.5, 0, new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  it('returns all songs when rules are empty', () => {
    const compiled = compileSmartPlaylist(db, {}, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toHaveLength(3);
  });

  it('filters by title contains', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'title', operator: 'contains', value: 'Android' }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toEqual(['song-2']);
  });

  it('filters by album name', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'album', operator: 'is', value: 'OK Computer' }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toHaveLength(3);
  });

  it('filters by artist name', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'artist', operator: 'is', value: 'Radiohead' }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toHaveLength(3);
  });

  it('filters by year range', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'year', operator: 'inTheRange', value: [1990, 2000] }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toHaveLength(3);
  });

  it('filters by duration greater than', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'duration', operator: 'gt', value: 200 }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toEqual(['song-2', 'song-3']);
  });

  it('filters by loved tracks', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'loved', operator: 'is', value: true }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toEqual(['song-1']);
  });

  it('filters by rating', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'rating', operator: 'is', value: 5 }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toEqual(['song-1']);
  });

  it('filters by half-star rating', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'rating', operator: 'is', value: 3.5 }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toEqual(['song-2']);
  });

  it('filters by greater than or equal', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'rating', operator: 'gte', value: 3.5 }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toContain('song-1');
    expect(ids).toContain('song-2');
    expect(ids).not.toContain('song-3');
  });

  it('filters by less than or equal', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'rating', operator: 'lte', value: 4 }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toEqual(['song-2']);
  });

  it('filters by playcount greater than', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        all: [{ field: 'playcount', operator: 'gt', value: 5 }],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toEqual(['song-1']);
  });

  it('supports any rule group', () => {
    const rules: SmartPlaylistRules = {
      rules: {
        any: [
          { field: 'title', operator: 'is', value: 'Airbag' },
          { field: 'title', operator: 'is', value: 'Karma Police' },
        ],
      },
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toContain('song-1');
    expect(ids).toContain('song-3');
    expect(ids).not.toContain('song-2');
  });

  it('applies limit', () => {
    const rules: SmartPlaylistRules = {
      rules: {},
      limit: 2,
    };
    const compiled = compileSmartPlaylist(db, rules, 'user-1');
    const ids = db.prepare(compiled.sql).pluck().all(...compiled.params) as string[];
    expect(ids).toHaveLength(2);
  });
});
