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

export function Genre() {
  const { genre: encodedGenre } = useParams<{ genre: string }>();
  const genre = encodedGenre ? decodeURIComponent(encodedGenre) : '';

  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const songsQuery = useSongsList({ libraryId: selectedLibraryId, genre: genre || undefined }, Boolean(genre));
  const albumsQuery = useAlbumsList({ libraryId: selectedLibraryId, genre: genre || undefined }, Boolean(genre));
  const tracks: SongWithNames[] = songsQuery.data?.songs ?? [];
  const albums: AlbumWithArtist[] = albumsQuery.data?.albums ?? [];
  const isLoading = songsQuery.isLoading || albumsQuery.isLoading;
  const error = songsQuery.error ?? albumsQuery.error;

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
      notFound={!genre}
      notFoundMessage="Genre not found."
      documentTitle={genre || null}
      type="Genre"
      title={genre}
      actions={actions}
      className="space-y-8"
    >
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Tracks</h3>
        <TrackList
          tracks={tracks}
          empty={<p className="text-sm text-muted">No tracks for this genre.</p>}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Albums</h3>
        <AlbumList
          albums={albums}
          empty={<p className="text-sm text-muted">No albums for this genre.</p>}
        />
      </div>
    </EntityDetail>
  );
}
