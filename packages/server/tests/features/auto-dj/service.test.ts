import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import { upsertSong } from '../../../src/features/songs/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';
import { upsertAlbum } from '../../../src/features/albums/repository.js';
import { getCandidates } from '../../../src/features/auto-dj/service.js';

function seedArtistAlbum(db: Database.Database) {
  upsertArtist(db, { id: 'artist-1', name: 'Artist One' });
  upsertArtist(db, { id: 'artist-2', name: 'Artist Two' });
  upsertAlbum(db, {
    id: 'album-1',
    name: 'Album One',
    artistId: 'artist-1',
    artistName: 'Artist One',
  });
  upsertAlbum(db, {
    id: 'album-2',
    name: 'Album Two',
    artistId: 'artist-2',
    artistName: 'Artist Two',
  });
}

function insertSong(
  db: Database.Database,
  id: string,
  title: string,
  options: {
    artistId?: string;
    albumId?: string;
    genre?: string;
    bpm?: number;
    mood?: string;
  } = {},
) {
  upsertSong(db, {
    id,
    filePath: `/music/${id}.mp3`,
    title,
    artistId: options.artistId,
    albumId: options.albumId,
    genre: options.genre,
    bpm: options.bpm,
    mood: options.mood,
    mtime: Date.now(),
    checksum: id,
  });
}

function setUserSong(
  db: Database.Database,
  userId: string,
  songId: string,
  values: { rating?: number; play_count?: number; last_played?: string },
) {
  db.prepare(`
    INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played)
    VALUES (?, ?, 0, ?, ?, ?)
    ON CONFLICT(user_id, song_id) DO UPDATE SET
      rating = excluded.rating,
      play_count = excluded.play_count,
      last_played = excluded.last_played
  `).run(userId, songId, values.rating ?? null, values.play_count ?? 0, values.last_played ?? null);
}

describe('auto-dj service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    createUser(db, {
      id: 'user-1',
      username: 'tester',
      passwordHash: 'hash',
      subsonicPasswordEncrypted: 'encrypted',
      isAdmin: false,
      createdAt: new Date().toISOString(),
    });
    seedArtistAlbum(db);
  });

  afterEach(() => {
    db.close();
  });

  it('similar mode returns same-artist songs and falls back to random', () => {
    insertSong(db, 's1', 'One', { artistId: 'artist-1', albumId: 'album-1' });
    insertSong(db, 's2', 'Two', { artistId: 'artist-1', albumId: 'album-1' });
    insertSong(db, 's3', 'Three', { artistId: 'artist-2', albumId: 'album-2' });

    const result = getCandidates(db, 'user-1', 's1', 'similar', 5, []);
    const ids = result.map((s) => s.id);
    expect(ids).toContain('s2');
    expect(ids).toContain('s3');
    expect(ids).not.toContain('s1');
  });

  it('random mode excludes recently played songs, falling back to them only when needed', () => {
    insertSong(db, 's1', 'One');
    insertSong(db, 's2', 'Two');
    insertSong(db, 's3', 'Three');
    setUserSong(db, 'user-1', 's2', { last_played: new Date().toISOString() });

    const result = getCandidates(db, 'user-1', 's1', 'random', 10, ['s1']);
    expect(result.map((s) => s.id)).toContain('s3');
    expect(result.map((s) => s.id)).not.toContain('s1');
    // Only s3 is non-recent, so the fallback fills the remainder with s2.
    expect(result.map((s) => s.id)).toContain('s2');
  });

  it('smart mode scores by shared artist and penalizes same album', () => {
    insertSong(db, 's1', 'Seed', { artistId: 'artist-1', albumId: 'album-1', bpm: 120, mood: 'Happy' });
    insertSong(db, 's2', 'Same artist and album', { artistId: 'artist-1', albumId: 'album-1' });
    insertSong(db, 's3', 'Same artist different album', { artistId: 'artist-1', albumId: 'album-2' });
    insertSong(db, 's4', 'Different artist', { artistId: 'artist-2', albumId: 'album-2' });

    const result = getCandidates(db, 'user-1', 's1', 'smart', 1, []);
    expect(result[0].id).toBe('s3');
  });
});
