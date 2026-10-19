import type { PlayerSong, PlayerStore } from './types.js';

export function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const PREVIOUS_RESTART_THRESHOLD = 3;

export function buildShuffledIndices(queueLength: number, currentIndex: number): number[] {
  if (queueLength === 0) return [];
  const others = Array.from({ length: queueLength }, (_, i) => i).filter((i) => i !== currentIndex);
  return [currentIndex, ...shuffleArray(others)];
}

/**
 * Read-only peek at what `next()` would play, honoring shuffle and repeat.
 * Used by the gapless preloader; repeat-one returns null because replaying
 * the current track needs no preload.
 */
export function getNextSong(
  state: Pick<PlayerStore, 'queue' | 'queueIndex' | 'repeat' | 'shuffle' | 'shuffledIndices'>,
): PlayerSong | null {
  const { queue, queueIndex, repeat, shuffle, shuffledIndices } = state;
  if (queue.length === 0 || repeat === 'one') return null;

  if (shuffle) {
    const position = shuffledIndices.indexOf(queueIndex);
    if (position >= 0 && position + 1 < shuffledIndices.length) {
      return queue[shuffledIndices[position + 1]] ?? null;
    }
    return repeat === 'all' ? queue[shuffledIndices[0]] ?? null : null;
  }

  const nextIndex = queueIndex + 1;
  if (nextIndex < queue.length) return queue[nextIndex];
  return repeat === 'all' ? queue[0] : null;
}
