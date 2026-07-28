import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import type { Song, Album } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { TrackList } from '../../songs/index.js';
import { AlbumList } from '../../albums/index.js';
import type { SongWithNames } from '../../../lib/types.js';

interface AlbumWithArtist extends Album {
  artistName?: string;
}

export function Genre() {
  const { genre: encodedGenre } = useParams<{ genre: string }>();
  const genre = encodedGenre ? decodeURIComponent(encodedGenre) : '';

  const [tracks, setTracks] = useState<SongWithNames[]>([]);
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const libraryQuery = buildLibraryQuery(selectedLibraryId);
  const libraryParam = libraryQuery ? `&${libraryQuery.slice(1)}` : '';

  const load = () => {
    if (!genre) return;
    setLoading(true);
    Promise.all([
      api<{ songs: SongWithNames[] }>(`/songs?genre=${encodeURIComponent(genre)}${libraryParam}`),
      api<{ albums: AlbumWithArtist[] }>(`/albums?genre=${encodeURIComponent(genre)}${libraryParam}`),
    ])
      .then(([songsRes, albumsRes]) => {
        setTracks(songsRes.songs);
        setAlbums(albumsRes.albums);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load genre'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [genre, selectedLibraryId]);

  const actions = tracks.length > 0 && (
    <>
      <PlayButton variant="default" onPlay={() => playSongs(tracks as Song[])} onShufflePlay={() => shufflePlay(tracks as Song[])}>
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
