import Database from 'better-sqlite3';
import type { Song } from '@sonarly/shared';
import type { AutoDjExcludeWindow } from '@sonarly/shared';
import {
  getSongContext,
  getSimilarCandidates,
  getRandomCandidates,
  getSmartCandidateRows,
  getUserAveragePlayCount,
} from './repository.js';
import type { SongContext, SmartCandidate } from './repository.js';

export type AutoDjMode = 'similar' | 'random' | 'smart';

export interface AutoDjOptions {
  excludeWindow?: AutoDjExcludeWindow;
  preferFavorites?: boolean;
  /** 0 = familiar (known, well-played tracks), 100 = adventurous (deep cuts). */
  discovery?: number;
}

export function getCandidates(
  db: Database.Database,
  userId: string,
  currentSongId: string | undefined,
  mode: AutoDjMode,
  count: number,
  excludeIds: string[],
  options: AutoDjOptions = {},
): Song[] {
  const context = currentSongId ? getSongContext(db, currentSongId, userId) : undefined;

  switch (mode) {
    case 'similar':
      return getSimilarCandidates(db, userId, context, count, excludeIds, options);
    case 'random':
      return getRandomCandidates(db, userId, count, excludeIds, options);
    case 'smart':
      return getSmartCandidates(db, userId, context, count, excludeIds, options);
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
  options: AutoDjOptions,
): Song[] {
  const candidates = getSmartCandidateRows(db, userId, context, excludeIds, options);
  const avgPlayCount = getUserAveragePlayCount(db, userId);

  const discovery = Math.min(100, Math.max(0, options.discovery ?? 50));
  // +1 = fully familiar, -1 = fully adventurous.
  const familiarityBias = (50 - discovery) / 50;

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

    // Discovery dial: familiar boosts well-played tracks, adventurous
    // penalizes them and lifts never-played deep cuts instead.
    const familiarity = Math.min(candidate.playCount ?? 0, 20) / 20;
    score += familiarityBias * familiarity * 4;
    if (familiarityBias < 0 && (candidate.playCount ?? 0) === 0) {
      score += -familiarityBias * 2;
    }

    // Overplayed penalty grows with adventurousness (none at full familiar).
    if (avgPlayCount > 0 && (candidate.playCount ?? 0) > avgPlayCount) {
      score -= discovery / 100;
    }

    if (options.preferFavorites && song.starred) score += 3;

    return { candidate, score };
  });

  scored.sort((a, b) => b.score - a.score || a.candidate.song.id.localeCompare(b.candidate.song.id));
  const picked = scored.slice(0, count).map((s) => s.candidate.song);

  if (picked.length < count) {
    const more = getRandomCandidates(db, userId, count - picked.length, [
      ...excludeIds,
      ...picked.map((s) => s.id),
      ...(context ? [context.id] : []),
    ], options);
    picked.push(...more);
  }

  return picked;
}
