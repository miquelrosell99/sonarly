import { useParams } from 'wouter';
import type { Song, Album } from '@sonarly/shared';
import { Button } from '../../../components/ui/Button.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useAlbumsList, useSongsList } from '../../../hooks/useLibraryLists.js';
import { TrackList } from '../../songs/index.js';
import { AlbumList } from '../../albums/index.js';
import type { SongWithNames } from '../../../lib/types.js';

interface AlbumWithArtist extends Album {
  artistName?: string;
}

export function Year() {
  const { year: yearParam } = useParams<{ year: string }>();
  const year = yearParam ? Number(yearParam) : NaN;
  const yearValid = !Number.isNaN(year);

  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  // The year filter is client-side: the full lists are cached under the same
  // keys the Tracks/Albums pages use, so navigating between them is free.
  const songsQuery = useSongsList({ libraryId: selectedLibraryId }, yearValid);
  const albumsQuery = useAlbumsList({ libraryId: selectedLibraryId }, yearValid);
  const tracks: SongWithNames[] = (songsQuery.data?.songs ?? []).filter((s) => s.year === year);
  const albums: AlbumWithArtist[] = (albumsQuery.data?.albums ?? []).filter((a) => a.year === year);
  const isLoading = songsQuery.isLoading || albumsQuery.isLoading;
  const error = songsQuery.error ?? albumsQuery.error;

  const title = yearValid ? String(year) : undefined;
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
      isLoading={isLoading}
      error={error?.message ?? null}
      notFound={!yearValid}
      notFoundMessage="Invalid year."
      documentTitle={title}
      type="Year"
      title={title}
      actions={actions}
      className="space-y-8"
    >
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Tracks</h3>
        <TrackList
          tracks={tracks}
          empty={<p className="text-sm text-muted">No tracks for this year.</p>}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Albums</h3>
        <AlbumList
          albums={albums}
          empty={<p className="text-sm text-muted">No albums for this year.</p>}
        />
      </div>
    </EntityDetail>
  );
}
