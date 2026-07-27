import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import type { Song, Album } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
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

  const load = () => {
    if (Number.isNaN(year)) return;
    setLoading(true);
    Promise.all([
      api<{ songs: SongWithNames[] }>('/songs'),
      api<{ albums: AlbumWithArtist[] }>('/albums'),
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
  }, [year]);

  if (Number.isNaN(year)) return <p className="text-sm text-danger">Invalid year.</p>;
  if (loading) return <p className="text-sm text-muted">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{year}</h2>
          {tracks.length > 0 && (
            <div className="flex gap-2">
              <PlayButton variant="default" onPlay={() => playSongs(tracks as Song[], 0)} onShufflePlay={() => shufflePlay(tracks as Song[])}>
                Play all
              </PlayButton>
              <Button variant="ghost" onClick={() => shufflePlay(tracks as Song[])}>
                Shuffle
              </Button>
            </div>
          )}
        </div>

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
    </div>
  );
}
