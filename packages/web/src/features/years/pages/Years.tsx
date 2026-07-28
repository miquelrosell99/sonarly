import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Song, Album } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

interface AlbumWithArtist extends Album {
  artistName?: string;
}

export function Years() {
  const [years, setYears] = useState<number[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ years: number[] }>(`/years${buildLibraryQuery(selectedLibraryId)}`),
      api<{ songs: Track[] }>(`/songs${buildLibraryQuery(selectedLibraryId)}`),
      api<{ albums: AlbumWithArtist[] }>(`/albums${buildLibraryQuery(selectedLibraryId)}`),
    ])
      .then(([yearsRes, songsRes, albumsRes]) => {
        setYears(yearsRes.years);
        setTracks(songsRes.songs);
        setAlbums(albumsRes.albums);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load years'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [selectedLibraryId]);

  const playYear = (year: number) => {
    const matching = tracks.filter((t) => t.year === year);
    if (matching.length > 0) {
      playSongs(matching);
    }
  };

  const shuffleYears = (selectedYears: number[]) => {
    const matching = tracks.filter((t) => t.year !== undefined && selectedYears.includes(t.year));
    if (matching.length > 0) {
      shufflePlay(matching);
    }
  };

  const columns: LibraryViewColumn<number>[] = [
    {
      key: 'year',
      header: 'Year',
      render: (year) => (
        <Link href={`/years/${year}`} className="hover:text-muted">
          {year}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<number>[] = [
    { key: 'year', render: (year) => year },
  ];

  return (
    <LibraryView
      title="Years"
      data={years}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(year) => String(year)}
      getHref={(year) => `/years/${year}`}
      onPlay={playYear}
      onShufflePlay={shuffleYears}
      emptyMessage="No years found."
      defaultView="list"
      availableViews={['list']}
    />
  );
}
