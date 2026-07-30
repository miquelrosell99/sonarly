import type { PlayerSong } from '../stores/playerStore.js';

export function patchToPlayerSong(patch: Record<string, unknown>): Partial<PlayerSong> {
  const mapped: Partial<PlayerSong> = {};
  if ('title' in patch) mapped.title = String(patch.title);
  if ('explicit' in patch) mapped.explicit = Boolean(patch.explicit);
  if ('genre' in patch) mapped.genre = Array.isArray(patch.genre) ? patch.genre[0] : (patch.genre as string | undefined);
  if ('year' in patch) mapped.year = patch.year as number | undefined;
  if ('lyrics' in patch) mapped.lyrics = patch.lyrics as string | undefined;
  if ('artist' in patch) {
    mapped.artistName = Array.isArray(patch.artist) ? patch.artist[0] : (patch.artist as string | undefined);
  }
  if ('album' in patch) mapped.albumName = patch.album as string | undefined;
  if ('trackNumber' in patch) mapped.trackNumber = patch.trackNumber as number | undefined;
  if ('discNumber' in patch) mapped.discNumber = patch.discNumber as number | undefined;
  return mapped;
}
