import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import { createUser } from '../../../src/features/users/repository.js';
import {
  getSongContext,
  getSimilarCandidates,
  getRandomCandidates,
  getSmartCandidateRows,
} from '../../../src/features/auto-dj/repository.js';
import { getCandidates } from '../../../src/features/auto-dj/service.js';

describe('auto-dj candidates', () => {
  let db: Database.Database;

  const insertSong = (
    id: string,
    opts: { artistId?: string; albumId?: string } = {},
  ) => {
    db.prepare(`
      INSERT INTO songs (id, file_path, title, mtime, checksum, active, artist_id, album_id)
      VALUES (?, ?, ?, 1, ?, 1, ?, ?)
    `).run(id, `/${id}.mp3`, `Song ${id}`, `c-${id}`, opts.artistId ?? null, opts.albumId ?? null);
  };

  const upsertUserSong = (
    songId: string,
    opts: { starred?: number; rating?: number; playCount?: number; lastPlayed?: string | null } = {},
  ) => {
    db.prepare(`
      INSERT INTO user_songs (user_id, song_id, starred, rating, play_count, last_played)
      VALUES ('user-1', ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, song_id) DO UPDATE SET
        starred = excluded.starred,
        rating = excluded.rating,
        play_count = excluded.play_count,
        last_played = excluded.last_played
    `).run(songId, opts.starred ?? 0, opts.rating ?? null, opts.playCount ?? 0, opts.lastPlayed ?? null);
  };

  const recordPlay = (songId: string, playedAt: string) => {
    db.prepare(`
      INSERT INTO listening_history (id, user_id, song_id, played_at)
      VALUES (?, 'user-1', ?, ?)
    `).run(`h-${songId}-${playedAt}`, songId, playedAt);
  };

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
  });

  afterEach(() => {
    db.close();
  });

  describe('getRandomCandidates', () => {
    it('excludes songs played within the configured window', () => {
      insertSong('s1');
      insertSong('s2');
      insertSong('s3');
      upsertUserSong('s1');
      upsertUserSong('s2');
      db.prepare(`UPDATE user_songs SET last_played = datetime('now', '-2 days') WHERE song_id = 's1'`).run();
      db.prepare(`UPDATE user_songs SET last_played = datetime('now', '-5 days') WHERE song_id = 's2'`).run();

      // Request exactly the windowed pool size so the relax-everything
      // fallback never kicks in.
      const recent = getRandomCandidates(db, 'user-1', 2, [], { excludeWindow: '24h' });
      expect(new Set(recent.map((s) => s.id))).toEqual(new Set(['s2', 's3']));

      const wide = getRandomCandidates(db, 'user-1', 1, [], { excludeWindow: '7d' });
      expect(wide.map((s) => s.id)).toEqual(['s3']);

      // With everything inside the window, the fallback backfills anyway.
      const fallback = getRandomCandidates(db, 'user-1', 1, [], { excludeWindow: '30d' });
      expect(fallback).toHaveLength(1);
    });

    it('puts starred songs first when preferFavorites is on', () => {
      for (let i = 0; i < 5; i += 1) insertSong(`p${i}`);
      insertSong('fav');
      upsertUserSong('fav', { starred: 1 });

      const withPref = getRandomCandidates(db, 'user-1', 1, [], { preferFavorites: true });
      expect(withPref.map((s) => s.id)).toEqual(['fav']);

      const without = getRandomCandidates(db, 'user-1', 6, []);
      expect(without).toHaveLength(6);
    });
  });

  describe('getSimilarCandidates', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO artists (id, name) VALUES ('a1', 'Artist One'), ('a2', 'Artist Two')`).run();
      insertSong('seed', { artistId: 'a1' });
      insertSong('same-recent', { artistId: 'a1' });
      insertSong('same-old', { artistId: 'a1' });
      insertSong('other', { artistId: 'a2' });
      db.prepare(`INSERT INTO listening_history (id, user_id, song_id, played_at)
        VALUES ('h-recent', 'user-1', 'same-recent', datetime('now'))`).run();
      db.prepare(`INSERT INTO listening_history (id, user_id, song_id, played_at)
        VALUES ('h-old', 'user-1', 'same-old', datetime('now', '-10 days'))`).run();
    });

    it('skips songs played within the window', () => {
      const context = getSongContext(db, 'seed', 'user-1');
      // Pool after exclusion is exactly one song, so no backfill happens.
      const results = getSimilarCandidates(db, 'user-1', context, 1, [], { excludeWindow: '7d' });
      expect(results.map((s) => s.id)).toEqual(['same-old']);
    });

    it('backfills when the whole neighborhood is inside the window', () => {
      const context = getSongContext(db, 'seed', 'user-1');
      const results = getSimilarCandidates(db, 'user-1', context, 1, [], { excludeWindow: '30d' });
      // Both same-artist songs are inside a 30d window; the pool is empty
      // and the random backfill fills the request instead.
      expect(results).toHaveLength(1);
      expect(results[0]?.id).not.toBe('seed');
    });
  });

  describe('getSmartCandidateRows', () => {
    it('excludes songs played within the window from the scoring pool', () => {
      insertSong('recent');
      insertSong('stale');
      recordPlay('recent', new Date().toISOString().replace('T', ' ').slice(0, 19));

      const rows = getSmartCandidateRows(db, 'user-1', undefined, [], { excludeWindow: '24h' });
      expect(rows.map((r) => r.song.id)).toEqual(['stale']);

      const allRows = getSmartCandidateRows(db, 'user-1', undefined, [], {});
      // Default window (24h) also excludes the just-played song.
      expect(allRows.map((r) => r.song.id)).toEqual(['stale']);
    });
  });

  describe('getCandidates smart scoring', () => {
    beforeEach(() => {
      insertSong('heavy');
      insertSong('fresh');
      upsertUserSong('heavy', { playCount: 40 });
      upsertUserSong('fresh', { playCount: 0 });
    });

    it('familiar discovery ranks well-played tracks first', () => {
      const songs = getCandidates(db, 'user-1', undefined, 'smart', 2, [], { discovery: 0 });
      expect(songs[0]?.id).toBe('heavy');
    });

    it('adventurous discovery ranks never-played tracks first', () => {
      const songs = getCandidates(db, 'user-1', undefined, 'smart', 2, [], { discovery: 100 });
      expect(songs[0]?.id).toBe('fresh');
    });

    it('preferFavorites boosts starred tracks', () => {
      insertSong('fav');
      upsertUserSong('fav', { starred: 1, playCount: 0 });
      const songs = getCandidates(db, 'user-1', undefined, 'smart', 3, [], {
        discovery: 50,
        preferFavorites: true,
      });
      expect(songs[0]?.id).toBe('fav');
    });

    it('keeps working with no options (defaults)', () => {
      const songs = getCandidates(db, 'user-1', undefined, 'smart', 2, []);
      expect(songs).toHaveLength(2);
    });
  });
});
