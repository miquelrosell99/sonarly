import type { ReactNode } from 'react';
import { useParams } from 'wouter';
import type { Album } from '../../../types';
import { Button } from '../../../components/ui/Button.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { usePlayShuffleMenuSections } from '../../../hooks/usePlayShuffleMenuSections.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useAlbumsList, useSongsList } from '../../../hooks/useLibraryLists.js';
import { TrackList } from '../../songs/index.js';
import { AlbumList } from '../../albums/index.js';
import type { SongWithNames, UnderlayParams } from '../../../lib/types.js';

interface AlbumWithArtist extends Album {
  artistName?: string;
}

function LabelHeaderContextMenu({
  tracks,
  children,
}: {
  tracks: SongWithNames[];
  children: ReactNode;
}) {
  const sections = usePlayShuffleMenuSections(tracks);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function Label({ underlay }: { underlay?: UnderlayParams }) {
  const { name: paramName } = useParams<{ name: string }>();
  const encodedName = underlay?.id ?? paramName;
  const label = encodedName ? decodeURIComponent(encodedName) : '';
  const covered = underlay !== undefined && !underlay.fetchEnabled;

  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const songsQuery = useSongsList(
    { libraryId: selectedLibraryId, label: label || undefined },
    Boolean(label) && !covered,
  );
  const albumsQuery = useAlbumsList(
    { libraryId: selectedLibraryId, label: label || undefined },
    Boolean(label) && !covered,
  );
  const tracks: SongWithNames[] = songsQuery.data?.songs ?? [];
  const albums: AlbumWithArtist[] = albumsQuery.data?.albums ?? [];
  const isLoading = songsQuery.isLoading || albumsQuery.isLoading || covered;
  const error = songsQuery.error ?? albumsQuery.error;

  const actions = tracks.length > 0 && (
    <>
      <PlayButton variant="default" onPlay={() => playSongs(tracks, undefined, undefined, { type: 'label', id: label })}>
        Play all
      </PlayButton>
      <Button variant="ghost" onClick={() => shufflePlay(tracks, { type: 'label', id: label })}>
        Shuffle
      </Button>
    </>
  );

  return (
    <EntityDetail
      isLoading={isLoading}
      error={error?.message ?? null}
      notFound={!label}
      notFoundMessage="Label not found."
      documentTitle={label || null}
      type="Label"
      title={label}
      actions={actions}
      className="space-y-8"
      renderHeaderContextMenu={(target) => (
        <LabelHeaderContextMenu tracks={tracks}>{target}</LabelHeaderContextMenu>
      )}
    >
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Tracks</h3>
        <TrackList
          tracks={tracks}
          empty={<p className="text-sm text-muted">No tracks for this label.</p>}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Albums</h3>
        <AlbumList
          albums={albums}
          empty={<p className="text-sm text-muted">No albums for this label.</p>}
        />
      </div>
    </EntityDetail>
  );
}
