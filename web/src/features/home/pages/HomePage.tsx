import { useEffect, useMemo, useState } from 'react';
import type { Album, User } from '../../../types';
import { api } from '../../../lib/api.js';
import { PageState } from '../../shell/PageState.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { ScrollRow } from '../../entities/ScrollRow.js';
import { AlbumCard, FeaturedAlbum, RecentSongCard, type HomeData } from '../components/home-cards/index.js';

export function HomePage({ user }: { user: User }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const loadHome = () => {
    setLoading(true);
    setError(null);
    api<HomeData>(`/home${buildLibraryQuery(selectedLibraryId)}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load home'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadHome();

    const handleLibraryChanged = () => loadHome();
    window.addEventListener('sonarly:library-changed', handleLibraryChanged);
    return () => window.removeEventListener('sonarly:library-changed', handleLibraryChanged);
  }, [selectedLibraryId]);

  const featuredAlbums = useMemo(() => {
    if (!data) return [];
    const candidates: Album[] = [];
    const seen = new Set<string>();
    const add = (album: Album | undefined) => {
      if (!album || seen.has(album.id)) return;
      seen.add(album.id);
      candidates.push(album);
    };
    add(data.mostPlayed[0]);
    add(data.recentAdditions[0]);
    add(data.random[0]);
    return candidates;
  }, [data]);

  if (loading || error || !data) {
    return (
      <PageState
        loading={loading}
        error={error}
        isEmpty={!data}
        emptyMessage="No data available."
        onRetry={loadHome}
      >
        {null}
      </PageState>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="sr-only">Home</h1>
      {featuredAlbums.length > 0 && <FeaturedAlbum albums={featuredAlbums} />}

      <ScrollRow title="Most played">
        {data.mostPlayed.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No played albums yet.</p>
        ) : (
          data.mostPlayed.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} user={user} />
            </div>
          ))
        )}
      </ScrollRow>

      <ScrollRow title="Random albums">
        {data.random.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No albums found.</p>
        ) : (
          data.random.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} user={user} />
            </div>
          ))
        )}
      </ScrollRow>

      <ScrollRow title="Recently added">
        {data.recentAdditions.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No recently added albums.</p>
        ) : (
          data.recentAdditions.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} user={user} />
            </div>
          ))
        )}
      </ScrollRow>

      <ScrollRow title="Recently played">
        {data.recentlyPlayed.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No recently played songs.</p>
        ) : (
          data.recentlyPlayed.map((song, index) => (
            <div key={song.id} className="w-40 flex-none sm:w-44">
              <RecentSongCard song={song} songs={data.recentlyPlayed} index={index} user={user} />
            </div>
          ))
        )}
      </ScrollRow>
    </div>
  );
}
