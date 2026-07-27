import type { Album } from '@sonarly/shared';

export function fillCoverAlbums(albums: Album[], count = 4): Album[] {
  const seen = new Set<string>();
  const distinct: Album[] = [];
  for (const album of albums) {
    if (!seen.has(album.id)) {
      seen.add(album.id);
      distinct.push(album);
    }
  }

  if (distinct.length >= count) {
    return distinct.slice(0, count);
  }

  // If we do not have enough distinct results, cycle through the original
  // list so the grid is always filled.
  const source = albums.length > 0 ? albums : distinct;
  if (source.length === 0) return [];
  const result: Album[] = [];
  for (let i = 0; i < count; i++) {
    result.push(source[i % source.length]);
  }
  return result;
}
