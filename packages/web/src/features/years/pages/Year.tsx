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

export function Year() {
  const { year: yearParam } = useParams<{ year: string }>();
  const year = yearParam ? Number(yearParam) : NaN;

  const [tracks, setTracks] = useState<SongWithNames[]>([]);
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const load = () => {
    if (Number.isNaN(year)) return;
    setLoading(true);
    Promise.all([
      api<{ songs: SongWithNames[] }>(`/songs${buildLibraryQuery(selectedLibraryId)}`),
      api<{ albums: AlbumWithArtist[] }>(`/albums${buildLibraryQuery(selectedLibraryId)}`),
    ])
      .then(([songsRes, albumsRes]) => {
        setTracks(songsRes.songs.filter((s) => s.year === year));
        setAlbums(albumsRes.albums.filter((a) => a.year === year));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load year'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [year, selectedLibraryId]);

  const title = Number.isNaN(year) ? undefined : String(year);
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
      notFound={Number.isNaN(year)}
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
