import Database from 'better-sqlite3';
import type { Song } from '@sonarly/shared';
import {
  getSongContext,
  getSimilarCandidates,
  getRandomCandidates,
  getSmartCandidateRows,
  getUserAveragePlayCount,
} from './repository.js';
import type { SongContext, SmartCandidate } from './repository.js';

export type AutoDjMode = 'similar' | 'random' | 'smart';

export function getCandidates(
  db: Database.Database,
  userId: string,
  currentSongId: string | undefined,
  mode: AutoDjMode,
  count: number,
  excludeIds: string[],
): Song[] {
  const context = currentSongId ? getSongContext(db, currentSongId, userId) : undefined;

  switch (mode) {
    case 'similar':
      return getSimilarCandidates(db, userId, context, count, excludeIds);
    case 'random':
      return getRandomCandidates(db, userId, count, excludeIds);
    case 'smart':
      return getSmartCandidates(db, userId, context, count, excludeIds);
    default:
      return [];
  }
}

function getSmartCandidates(
  db: Database.Database,
  userId: string,
  context: SongContext | undefined,
  count: number,
  excludeIds: string[],
): Song[] {
  const candidates = getSmartCandidateRows(db, userId, context, excludeIds);
  const avgPlayCount = getUserAveragePlayCount(db, userId);

  const scored = candidates.map((candidate: SmartCandidate) => {
    let score = 0;
    const song = candidate.song;

    if (context) {
      if (song.artistId && song.artistId === context.artistId) score += 3;
      score += candidate.genreOverlap * 2;
      if (context.mood && song.mood && song.mood.toLowerCase() === context.mood.toLowerCase()) {
        score += 2;
      }
      if (context.bpm && song.bpm) {
        const diff = Math.abs(song.bpm - context.bpm) / context.bpm;
        if (diff <= 0.05) score += 1;
      }
      if (context.albumId && song.albumId === context.albumId) score -= 5;
    }

    score += (candidate.rating ?? 0) * 1;

    if (candidate.lastPlayed) {
      const hours = (Date.now() - new Date(candidate.lastPlayed).getTime()) / 36e5;
      if (hours < 24) score -= 2;
    }

    if (avgPlayCount > 0 && (candidate.playCount ?? 0) > avgPlayCount) score -= 1;

    return { candidate, score };
  });

  scored.sort((a, b) => b.score - a.score || a.candidate.song.id.localeCompare(b.candidate.song.id));
  return scored.slice(0, count).map((s) => s.candidate.song);
}
