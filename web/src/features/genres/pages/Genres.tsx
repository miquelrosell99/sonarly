import { type ReactNode } from 'react';
import { Link } from 'wouter';
import type { Song } from '../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useGenreContextMenu } from '../../../hooks/useGenreContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { GenreCoverGrid } from '../components/GenreCoverGrid.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useGenresList, useSongsList } from '../../../hooks/useLibraryLists.js';

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
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data: genresData, isLoading, error, refetch } = useGenresList({ libraryId: selectedLibraryId });
  const { data: songsData } = useSongsList({ libraryId: selectedLibraryId });
  // The API returns genres unordered; keep the alphabetical sort the page
  // always applied.
  const genres = sortGenres(genresData?.genres);
  const tracks: Track[] = songsData?.songs ?? [];

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
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(genre) => genre.id}
      getHref={(genre) => `/genres/${encodeURIComponent(genre.name)}`}
      onPlay={playGenre}
      onShufflePlay={shuffleGenres}
      renderCover={(genre) => <GenreCoverGrid genreId={genre.id} />}
      renderContextMenu={(genre, children, _selectedItems) => (
        <GenreContextMenu genre={genre.name} tracks={tracks}>
          {children}
        </GenreContextMenu>
      )}
      emptyMessage="No genres found."
      onRetry={() => void refetch()}
    />
  );
}

function sortGenres(genres: GenreItem[] | undefined): GenreItem[] {
  return genres ? [...genres].sort((a, b) => a.name.localeCompare(b.name)) : [];
}
