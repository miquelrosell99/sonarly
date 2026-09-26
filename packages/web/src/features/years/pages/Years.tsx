import { Link } from 'wouter';
import type { Song } from '../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useSongsList, useYearsList } from '../../../hooks/useLibraryLists.js';

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

export function Years() {
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data: yearsData, isLoading, error, refetch } = useYearsList({ libraryId: selectedLibraryId });
  const { data: songsData } = useSongsList({ libraryId: selectedLibraryId });
  const years = yearsData?.years ?? [];
  const tracks: Track[] = songsData?.songs ?? [];

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
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(year) => String(year)}
      getHref={(year) => `/years/${year}`}
      onPlay={playYear}
      onShufflePlay={shuffleYears}
      emptyMessage="No years found."
      onRetry={() => void refetch()}
      defaultView="list"
      availableViews={['list']}
    />
  );
}
