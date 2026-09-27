import { useEffect, useState } from 'react';
import type { Album } from '../../../types';
import { api } from '../../../lib/api.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { fillCoverAlbums } from '../../../lib/coverGrid.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';

interface YearCoverGridProps {
  year: number;
}

/** 2×2 collage of album covers released in the given year (grid view). */
export function YearCoverGrid({ year }: YearCoverGridProps) {
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ year: String(year), limit: '4' });
    if (selectedLibraryId) params.set('libraryId', selectedLibraryId);
    api<{ albums: Album[] }>(`/albums?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setAlbums(res.albums ?? []);
      })
      .catch(() => {
        // ignore: the grid falls back to placeholders
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, selectedLibraryId]);

  const covers = loading ? [] : fillCoverAlbums(albums, 4);

  return (
    <div className="aspect-square grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-xl bg-surface-hover">
      {[0, 1, 2, 3].map((index) => {
        const album = covers[index];
        return (
          <CoverArt
            key={album?.id ?? `placeholder-${index}`}
            coverArt={album?.coverArt}
            alt={album?.name ?? ''}
            className="h-full w-full"
          />
        );
      })}
    </div>
  );
}
