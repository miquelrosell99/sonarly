import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { upsertSong, getSongByPath } from '../../src/db/repositories/song-repository.js';

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
});
