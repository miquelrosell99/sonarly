import { useEffect, useState } from 'react';
import type { Album } from '@sonarly/shared';
import { api } from '../../../api.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { fillCoverAlbums } from '../../../lib/coverGrid.js';

interface PlaylistCoverGridProps {
  playlistId: string;
}

export function PlaylistCoverGrid({ playlistId }: PlaylistCoverGridProps) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<{ albums: Album[] }>(`/playlists/${encodeURIComponent(playlistId)}/albums?limit=4`)
      .then((res) => {
        if (!cancelled) setAlbums(res.albums);
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
  }, [playlistId]);

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
