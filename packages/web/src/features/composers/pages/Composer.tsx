import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { TrackList } from '../../songs/index.js';
import type { SongWithNames } from '../../../lib/types.js';

export function Composer() {
  const { name: encodedName } = useParams<{ name: string }>();
  const composer = encodedName ? decodeURIComponent(encodedName) : '';

  const [tracks, setTracks] = useState<SongWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const libraryQuery = buildLibraryQuery(selectedLibraryId);
  const libraryParam = libraryQuery ? `&${libraryQuery.slice(1)}` : '';

  const load = () => {
    if (!composer) return;
    setLoading(true);
    api<{ songs: SongWithNames[] }>(`/songs?composer=${encodeURIComponent(composer)}${libraryParam}`)
      .then((songsRes) => {
        setTracks(songsRes.songs);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load composer'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [composer, selectedLibraryId]);

  const actions = tracks.length > 0 && (
    <>
      <PlayButton variant="default" onPlay={() => playSongs(tracks as Song[])}>
        Play all
      </PlayButton>
      <Button variant="ghost" onClick={() => shufflePlay(tracks as Song[])}>
        Shuffle
      </Button>
    </>
  );

  return (
    <EntityDetail
      isLoading={loading}
      error={error}
      notFound={!composer}
      notFoundMessage="Composer not found."
      documentTitle={composer || null}
      type="Composer"
      title={composer}
      actions={actions}
      className="space-y-8"
    >
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Tracks</h3>
        <TrackList
          tracks={tracks}
          empty={<p className="text-sm text-muted">No tracks for this composer.</p>}
        />
      </div>
    </EntityDetail>
  );
}
