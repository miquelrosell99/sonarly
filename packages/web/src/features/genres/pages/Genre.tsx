import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { Song, Album } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';

interface Track extends Song {
  artistName?: string;
  albumName?: string;
}

interface AlbumWithArtist extends Album {
  artistName?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Genre() {
  const { genre: encodedGenre } = useParams<{ genre: string }>();
  const genre = encodedGenre ? decodeURIComponent(encodedGenre) : '';
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumWithArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSongs, shufflePlay } = usePlayActions();

  const load = () => {
    if (!genre) return;
    setLoading(true);
    Promise.all([
      api<{ songs: Track[] }>('/songs'),
      api<{ albums: AlbumWithArtist[] }>('/albums'),
    ])
      .then(([songsRes, albumsRes]) => {
        setTracks(songsRes.songs.filter((s) => s.genre === genre));
        setAlbums(albumsRes.albums.filter((a) => a.genre === genre));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load genre'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [genre]);

  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{genre}</h2>
          {tracks.length > 0 && (
            <div className="flex gap-2">
              <Button onClick={() => playSongs(tracks, 0)}>Play all</Button>
              <Button variant="ghost" onClick={() => shufflePlay(tracks)}>
                Shuffle
              </Button>
            </div>
          )}
        </div>

        <h3 className="mb-2 text-sm font-medium text-gray-500">Tracks</h3>
        {tracks.length === 0 ? (
          <p className="text-sm text-gray-500">No tracks for this genre.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tracks.map((track) => (
              <li key={track.id}>
                <Link
                  href={`/tracks/${track.id}`}
                  className="flex items-center justify-between py-2 text-sm hover:bg-gray-50"
                >
                  <span>{track.title}</span>
                  <span className="text-gray-400">
                    {track.artistName ?? '-'} • {track.duration ? formatDuration(track.duration) : '-'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-500">Albums</h3>
        {albums.length === 0 ? (
          <p className="text-sm text-gray-500">No albums for this genre.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {albums.map((album) => (
              <li key={album.id}>
                <Link
                  href={`/albums/${album.id}`}
                  className="flex items-center justify-between py-2 text-sm hover:bg-gray-50"
                >
                  <span>{album.name}</span>
                  <span className="text-gray-400">
                    {album.artistName ?? '-'} {album.year !== undefined && album.year !== null && `• ${album.year}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
