import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useGenreContextMenu } from '../../../hooks/useGenreContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { GenreCoverGrid } from '../components/GenreCoverGrid.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';

interface GenreItem {
  id: string;
  name: string;
  path: string;
}

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

function GenreContextMenu({
  genre,
  tracks,
  children,
}: {
  genre: string;
  tracks: Track[];
  children: ReactNode;
}) {
  const matchingTracks = tracks.filter((t) => t.genres?.includes(genre));
  const sections = useGenreContextMenu(genre, matchingTracks);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Genres() {
  const [genres, setGenres] = useState<GenreItem[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const load = () => {
    setLoading(true);
    Promise.all([
      api<{ genres: GenreItem[] }>(`/genres${buildLibraryQuery(selectedLibraryId)}`),
      api<{ songs: Track[] }>(`/songs${buildLibraryQuery(selectedLibraryId)}`),
    ])
      .then(([genresRes, songsRes]) => {
        setTracks(songsRes.songs);
        setGenres(genresRes.genres.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load genres'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [selectedLibraryId]);

  const matchingTracks = (genreName: string) => tracks.filter((t) => t.genres?.includes(genreName));

  const playGenre = (genre: GenreItem) => {
    const matching = matchingTracks(genre.name);
    if (matching.length > 0) {
      playSongs(matching);
    }
  };

  const shuffleGenres = (selectedGenres: GenreItem[]) => {
    const names = selectedGenres.map((g) => g.name);
    const matching = tracks.filter((t) => t.genres?.some((g) => names.includes(g)));
    if (matching.length > 0) {
      shufflePlay(matching);
    }
  };

  const columns: LibraryViewColumn<GenreItem>[] = [
    {
      key: 'name',
      header: 'Genre',
      render: (genre) => (
        <Link href={`/genres/${encodeURIComponent(genre.name)}`} className="hover:text-muted">
          {genre.name}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<GenreItem>[] = [
    { key: 'name', render: (genre) => genre.name },
  ];

  return (
    <LibraryView
      title="Genres"
      data={genres}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(genre) => genre.id}
      getHref={(genre) => `/genres/${encodeURIComponent(genre.name)}`}
      onPlay={playGenre}
      onShufflePlay={shuffleGenres}
      renderCover={(genre) => <GenreCoverGrid genreId={genre.id} />}
      renderContextMenu={(genre, children) => (
        <GenreContextMenu genre={genre.name} tracks={tracks}>
          {children}
        </GenreContextMenu>
      )}
      emptyMessage="No genres found."
    />
  );
}
