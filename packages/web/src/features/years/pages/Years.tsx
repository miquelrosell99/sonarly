import { Link } from 'wouter';
import type { Song } from '../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useSongsList, useYearsList, type YearCount } from '../../../hooks/useLibraryLists.js';

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

export function Years() {
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data: yearsData, isLoading, error, refetch } = useYearsList({ libraryId: selectedLibraryId });
  const { data: songsData } = useSongsList({ libraryId: selectedLibraryId });
  const years: YearCount[] = yearsData?.years ?? [];
  const tracks: Track[] = songsData?.songs ?? [];

  const playYear = (entry: YearCount) => {
    const matching = tracks.filter((t) => t.year === entry.year);
    if (matching.length > 0) {
      playSongs(matching);
    }
  };

  const shuffleYears = (selectedYears: YearCount[]) => {
    const selected = selectedYears.map((entry) => entry.year);
    const matching = tracks.filter((t) => t.year !== undefined && selected.includes(t.year));
    if (matching.length > 0) {
      shufflePlay(matching);
    }
  };

  const columns: LibraryViewColumn<YearCount>[] = [
    {
      key: 'year',
      header: 'Year',
      render: (entry) => (
        <Link href={`/years/${entry.year}`} className="hover:text-muted">
          {entry.year} — {entry.songCount} {entry.songCount === 1 ? 'song' : 'songs'}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<YearCount>[] = [
    {
      key: 'year',
      render: (entry) => `${entry.year} — ${entry.songCount} ${entry.songCount === 1 ? 'song' : 'songs'}`,
    },
  ];

  return (
    <LibraryView
      title="Years"
      data={years}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(entry) => String(entry.year)}
      getHref={(entry) => `/years/${entry.year}`}
      onPlay={playYear}
      onShufflePlay={shuffleYears}
      emptyMessage="No years found."
      onRetry={() => void refetch()}
      defaultView="list"
      availableViews={['list']}
    />
  );
}
