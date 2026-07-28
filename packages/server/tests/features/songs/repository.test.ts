import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import {
  upsertSong,
  getSongByPath,
  listCollisionSongs,
  setSongArtists,
  getSongArtistNames,
  setSongComposers,
  getSongComposerNames,
  getSongComposerEntries,
} from '../../../src/features/songs/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';

describe('song repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and retrieves a song', () => {
    const song = {
      id: 's1',
      filePath: '/music/A/B/track.mp3',
      title: 'Track One',
      mtime: 1234567890,
      checksum: 'abc123',
    };
    upsertSong(db, song);
    const found = getSongByPath(db, '/music/A/B/track.mp3');
    expect(found).toMatchObject(song);
    expect(found?.explicit).toBe(false);
  });

  it('lists only collision-suffixed songs', () => {
    upsertSong(db, {
      id: 's1',
      filePath: '/music/A/B/track.mp3',
      title: 'Track One',
      mtime: 1,
      checksum: 'a',
    });
    upsertSong(db, {
      id: 's2',
      filePath: '/music/A/B/track (1).mp3',
      title: 'Track One Duplicate',
      mtime: 2,
      checksum: 'b',
    });
    upsertSong(db, {
      id: 's3',
      filePath: '/music/A/B/track (2).flac',
      title: 'Track One Duplicate Two',
      mtime: 3,
      checksum: 'c',
    });
    upsertSong(db, {
      id: 's4',
      filePath: '/music/A/B/track (live).mp3',
      title: 'Track Live',
      mtime: 4,
      checksum: 'd',
    });

    const collisions = listCollisionSongs(db);
    expect(collisions.map((s) => s.id).sort()).toEqual(['s2', 's3']);
  });

  it('round-trips rich metadata fields', () => {
    const song = {
      id: 's1',
      filePath: '/music/A/B/track.mp3',
      title: 'Track One',
      mtime: 1,
      checksum: 'a',
      musicBrainzTrackId: 'track-mbid',
      musicBrainzWorkId: 'work-mbid',
      musicBrainzDiscId: 'disc-mbid',
      producers: ['Producer One'],
      isrcs: ['US-ABC-01-00001'],
      originalYear: 1999,
      originalArtist: 'Original Artist',
      gapless: true,
      totalTracks: '10',
      totalDiscs: '1',
    };
    upsertSong(db, song);
    const found = getSongByPath(db, song.filePath);
    expect(found).toMatchObject(song);
  });

  it('stores and retrieves multi-value song artists', () => {
    upsertArtist(db, { id: 'a1', name: 'Artist One' });
    upsertArtist(db, { id: 'a2', name: 'Artist Two' });
    upsertSong(db, {
      id: 's1',
      filePath: '/music/A/B/track.mp3',
      title: 'Track One',
      mtime: 1,
      checksum: 'a',
    });
    setSongArtists(db, 's1', ['a2', 'a1']);
    expect(getSongArtistNames(db, 's1')).toEqual(['Artist Two', 'Artist One']);
  });

  it('stores and retrieves multi-value song composers via the artists table', () => {
    upsertArtist(db, { id: 'c1', name: 'Composer One' });
    upsertArtist(db, { id: 'c2', name: 'Composer Two' });
    upsertSong(db, {
      id: 's1',
      filePath: '/music/A/B/track.mp3',
      title: 'Track One',
      mtime: 1,
      checksum: 'a',
    });
    setSongComposers(db, 's1', ['c2', 'c1']);
    expect(getSongComposerNames(db, 's1')).toEqual(['Composer Two', 'Composer One']);
    expect(getSongComposerEntries(db, 's1')).toEqual([
      { id: 'c2', name: 'Composer Two' },
      { id: 'c1', name: 'Composer One' },
    ]);
  });
});
