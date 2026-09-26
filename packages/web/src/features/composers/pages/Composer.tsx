import { useParams } from 'wouter';
import type { Song } from '../../../types';
import { Button } from '../../../components/ui/Button.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useSongsList } from '../../../hooks/useLibraryLists.js';
import { TrackList } from '../../songs/index.js';
import type { SongWithNames } from '../../../lib/types.js';

export function Composer() {
  const { name: encodedName } = useParams<{ name: string }>();
  const composer = encodedName ? decodeURIComponent(encodedName) : '';

  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data, isLoading, error } = useSongsList(
    { libraryId: selectedLibraryId, composer: composer || undefined },
    Boolean(composer),
  );
  const tracks: SongWithNames[] = data?.songs ?? [];

  const actions = tracks.length > 0 && (
    <>
      <PlayButton variant="default" onPlay={() => playSongs(tracks as Song[], undefined, undefined, { type: 'composer', id: composer })}>
        Play all
      </PlayButton>
      <Button variant="ghost" onClick={() => shufflePlay(tracks as Song[], { type: 'composer', id: composer })}>
        Shuffle
      </Button>
    </>
  );

  return (
    <EntityDetail
      isLoading={isLoading}
      error={error?.message ?? null}
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
