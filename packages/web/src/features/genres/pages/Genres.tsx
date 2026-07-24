import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useGenreContextMenu } from '../../../hooks/useGenreContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';

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
  const matchingTracks = tracks.filter((t) => t.genre === genre);
  const sections = useGenreContextMenu(genre, matchingTracks);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Genres() {
  const [genres, setGenres] = useState<string[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();

  const load = () => {
    setLoading(true);
    api<{ songs: Track[] }>('/songs')
      .then((res) => {
        setTracks(res.songs);
        const names = Array.from(
          new Set(res.songs.map((s) => s.genre).filter((g): g is string => Boolean(g))),
        ).sort((a, b) => a.localeCompare(b));
        setGenres(names);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load genres'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const playGenre = (genre: string) => {
    const matching = tracks.filter((t) => t.genre === genre);
    if (matching.length > 0) {
      playSongs(matching, 0);
    }
  };

  const shuffleGenres = (selectedGenres: string[]) => {
    const matching = tracks.filter((t) => selectedGenres.includes(t.genre ?? ''));
    if (matching.length > 0) {
      shufflePlay(matching);
    }
  };

  const columns: LibraryViewColumn<string>[] = [
    {
      key: 'name',
      header: 'Genre',
      render: (genre) => (
        <Link href={`/genres/${encodeURIComponent(genre)}`} className="hover:text-muted">
          {genre}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<string>[] = [
    { key: 'name', render: (genre) => genre },
  ];

  return (
    <LibraryView
      title="Genres"
      data={genres}
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(genre) => genre}
      getHref={(genre) => `/genres/${encodeURIComponent(genre)}`}
      onPlay={playGenre}
      onShufflePlay={shuffleGenres}
      renderContextMenu={(genre, children) => (
        <GenreContextMenu genre={genre} tracks={tracks}>
          {children}
        </GenreContextMenu>
      )}
      emptyMessage="No genres found."
    />
  );
}
