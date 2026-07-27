import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';

export function Composers() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();

  useEffect(() => {
    setLoading(true);
    api<{ songs: Song[] }>('/songs')
      .then((res) => setSongs(res.songs))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load composers'))
      .finally(() => setLoading(false));
  }, []);

  const composers = Array.from(
    new Set(songs.flatMap((song) => song.composers ?? [])),
  ).sort((a, b) => a.localeCompare(b));

  const playComposer = (composer: string) => {
    const matching = songs.filter((song) => song.composers?.includes(composer));
    if (matching.length > 0) {
      playSongs(matching, 0);
    }
  };

  const shuffleComposers = (selectedComposers: string[]) => {
    const matching = songs.filter((song) =>
      selectedComposers.some((composer) => song.composers?.includes(composer)),
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
      isLoading={loading}
      error={error}
      columns={columns}
      cardFields={cardFields}
      getId={(composer) => composer}
      getHref={(composer) => `/composers/${encodeURIComponent(composer)}`}
      onPlay={playComposer}
      onShufflePlay={shuffleComposers}
      emptyMessage="No composers found."
      defaultView="list"
    />
  );
}
