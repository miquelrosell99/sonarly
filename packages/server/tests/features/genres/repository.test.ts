import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import {
  createGenre,
  getOrCreateGenreIdsByNames,
  setSongGenres,
  getSongGenreNames,
  getSongGenreNamesForMany,
  setAlbumGenres,
  getAlbumGenreNames,
  getAlbumGenreNamesForMany,
} from '../../../src/features/genres/repository.js';

describe('genre junction helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    db.prepare(`
      INSERT INTO songs (id, file_path, title, mtime, checksum, active)
      VALUES ('s1', '/a.mp3', 'A', 1, 'c1', 1), ('s2', '/b.mp3', 'B', 1, 'c2', 1)
    `).run();
    db.prepare(`
      INSERT INTO albums (id, name, active)
      VALUES ('al1', 'Album 1', 1), ('al2', 'Album 2', 1)
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('creates genres and returns their ids', () => {
    const ids = getOrCreateGenreIdsByNames(db, ['Rock', 'Jazz']);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('sets and reads song genres', () => {
    const [rockId, jazzId] = getOrCreateGenreIdsByNames(db, ['Rock', 'Jazz']);
    setSongGenres(db, 's1', [rockId, jazzId]);
    setSongGenres(db, 's2', [jazzId]);

    expect(getSongGenreNames(db, 's1')).toEqual(['Rock', 'Jazz']);
    expect(getSongGenreNames(db, 's2')).toEqual(['Jazz']);

    const map = getSongGenreNamesForMany(db, ['s1', 's2', 'missing']);
    expect(map.get('s1')).toEqual(['Rock', 'Jazz']);
    expect(map.get('s2')).toEqual(['Jazz']);
    expect(map.has('missing')).toBe(false);
  });

  it('replaces existing song genres on update', () => {
    const [rockId] = getOrCreateGenreIdsByNames(db, ['Rock']);
    setSongGenres(db, 's1', [rockId]);
    const [popId] = getOrCreateGenreIdsByNames(db, ['Pop']);
    setSongGenres(db, 's1', [popId]);

    expect(getSongGenreNames(db, 's1')).toEqual(['Pop']);
  });

  it('sets and reads album genres', () => {
    const [rockId, jazzId] = getOrCreateGenreIdsByNames(db, ['Rock', 'Jazz']);
    setAlbumGenres(db, 'al1', [rockId, jazzId]);
    setAlbumGenres(db, 'al2', [rockId]);

    expect(getAlbumGenreNames(db, 'al1')).toEqual(['Rock', 'Jazz']);
    expect(getAlbumGenreNames(db, 'al2')).toEqual(['Rock']);

    const map = getAlbumGenreNamesForMany(db, ['al1', 'al2']);
    expect(map.get('al1')).toEqual(['Rock', 'Jazz']);
    expect(map.get('al2')).toEqual(['Rock']);
  });

  it('trims empty genre names when resolving ids', () => {
    createGenre(db, 'Metal');
    const ids = getOrCreateGenreIdsByNames(db, ['', 'Metal', '  ']);
    expect(ids).toHaveLength(1);
    expect(getSongGenreNames(db, 's1')).toEqual([]);
  });
});
