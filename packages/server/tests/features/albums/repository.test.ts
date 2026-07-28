import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import {
  upsertAlbum,
  getAlbumById,
  setAlbumArtists,
  getAlbumArtistNames,
  setAlbumLabels,
  getAlbumLabelNames,
  getAlbumLabelEntries,
  ensureLabel,
} from '../../../src/features/albums/repository.js';
import { upsertArtist } from '../../../src/features/artists/repository.js';

describe('album repository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts and retrieves an album', () => {
    const album = {
      id: 'al1',
      name: 'Album One',
      artistName: 'Artist One',
      year: 2020,
    };
    upsertAlbum(db, album);
    const found = getAlbumById(db, 'al1');
    expect(found).toMatchObject(album);
  });

  it('round-trips rich metadata fields', () => {
    const album = {
      id: 'al1',
      name: 'Album One',
      catalogNumbers: ['CAT-001'],
      barcode: '1234567890123',
      asin: 'B012345678',
      musicBrainzAlbumId: 'album-mbid',
      musicBrainzReleaseGroupId: 'rg-mbid',
      musicBrainzAlbumArtistIds: ['artist-mbid-1', 'artist-mbid-2'],
      originalYear: 1999,
      compilation: true,
      totalTracks: '12',
      totalDiscs: '2',
    };
    upsertAlbum(db, album);
    const found = getAlbumById(db, 'al1');
    expect(found).toMatchObject(album);
  });

  it('stores and retrieves multi-value album artists', () => {
    upsertArtist(db, { id: 'a1', name: 'Artist One' });
    upsertArtist(db, { id: 'a2', name: 'Artist Two' });
    upsertAlbum(db, { id: 'al1', name: 'Album One' });
    setAlbumArtists(db, 'al1', ['a2', 'a1']);
    expect(getAlbumArtistNames(db, 'al1')).toEqual(['Artist Two', 'Artist One']);
  });

  it('stores and retrieves multi-value album labels via the labels table', () => {
    const labelA = ensureLabel(db, 'Label A');
    const labelB = ensureLabel(db, 'Label B');
    upsertAlbum(db, { id: 'al1', name: 'Album One' });
    setAlbumLabels(db, 'al1', [labelB, labelA]);
    expect(getAlbumLabelNames(db, 'al1')).toEqual(['Label B', 'Label A']);
    expect(getAlbumLabelEntries(db, 'al1')).toEqual([
      { id: labelB, name: 'Label B' },
      { id: labelA, name: 'Label A' },
    ]);
  });
});
