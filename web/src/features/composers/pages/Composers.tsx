import { Link } from 'wouter';
import type { Song } from '../../../types';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useSongsList } from '../../../hooks/useLibraryLists.js';

export function Composers() {
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data, isLoading, error, refetch } = useSongsList({ libraryId: selectedLibraryId });
  const songs: Song[] = data?.songs ?? [];

  const composerNames = (song: Song) => song.composerEntries?.map((entry) => entry.name) ?? [];

  const composers = Array.from(
    new Set(songs.flatMap((song) => composerNames(song))),
  ).sort((a, b) => a.localeCompare(b));

  const playComposer = (composer: string) => {
    const matching = songs.filter((song) => composerNames(song).includes(composer));
    if (matching.length > 0) {
      playSongs(matching);
    }
  };

  const shuffleComposers = (selectedComposers: string[]) => {
    const matching = songs.filter((song) =>
      selectedComposers.some((composer) => composerNames(song).includes(composer)),
    );
    if (matching.length > 0) {
      shufflePlay(matching);
    }
  };

  const columns: LibraryViewColumn<string>[] = [
    {
      key: 'name',
      header: 'Composer',
      render: (composer) => (
        <Link href={`/composers/${encodeURIComponent(composer)}`} className="hover:text-muted">
          {composer}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<string>[] = [
    { key: 'name', render: (composer) => composer },
  ];

  return (
    <LibraryView
      title="Composers"
      data={composers}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(composer) => composer}
      getHref={(composer) => `/composers/${encodeURIComponent(composer)}`}
      onPlay={playComposer}
      onShufflePlay={shuffleComposers}
      emptyMessage="No composers found."
      onRetry={() => void refetch()}
      defaultView="list"
    />
  );
}
