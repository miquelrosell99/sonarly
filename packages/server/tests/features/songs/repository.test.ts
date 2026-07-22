import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { upsertSong, getSongByPath, listCollisionSongs } from '../../../src/features/songs/repository.js';

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
    expect(found).toEqual(song);
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
});
