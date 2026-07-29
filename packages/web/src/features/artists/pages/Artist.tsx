import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import type { Song, UserPreferences } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Card } from '../../../components/Card.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { ArtistImage } from '../../../components/ArtistImage.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { ScrollRow } from '../../../components/ScrollRow.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { TrackList } from '../../songs/index.js';
import type { SongWithNames } from '../../../lib/types.js';

interface Album {
  id: string;
  name: string;
  year?: number;
  genre?: string;
  coverArt?: string;
  starred?: boolean;
  rating?: number;
}

interface ArtistDetail {
  id: string;
  name: string;
  artistImageUrl?: string;
  albums: Album[];
  starred?: boolean;
  rating?: number;
}

export function Artist() {
  const { id } = useParams<{ id: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [topTracks, setTopTracks] = useState<SongWithNames[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api<{ artist: ArtistDetail }>(`/artists/${id}${buildLibraryQuery(selectedLibraryId)}`),
      api<{ songs: SongWithNames[] }>(`/songs${buildLibraryQuery(selectedLibraryId)}`).catch(() => ({ songs: [] })),
      api<{ preferences: UserPreferences }>('/me/preferences').catch(() => ({ preferences: {} })),
    ])
      .then(([artistRes, songsRes, prefsRes]) => {
        setArtist(artistRes.artist);
        setTopTracks(songsRes.songs.filter((s) => s.artistId === id));
        setPreferences(prefsRes.preferences);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artist'))
      .finally(() => setLoading(false));
  }, [id, selectedLibraryId]);

  const handleFavorite = async (starred: boolean) => {
    if (!artist) return;
    try {
      await setFavorite('artist', artist.id, starred);
      setArtist((prev) => (prev ? { ...prev, starred } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!artist) return;
    try {
      await setRating('artist', artist.id, rating);
      setArtist((prev) => (prev ? { ...prev, rating } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  const handleAlbumFavorite = async (album: Album, starred: boolean) => {
    if (!artist) return;
    try {
      await setFavorite('album', album.id, starred);
      setArtist((prev) =>
        prev
          ? {
              ...prev,
              albums: prev.albums.map((a) => (a.id === album.id ? { ...a, starred } : a)),
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleAlbumRate = async (album: Album, rating?: number) => {
    if (!artist) return;
    try {
      await setRating('album', album.id, rating);
      setArtist((prev) =>
        prev
          ? {
              ...prev,
              albums: prev.albums.map((a) => (a.id === album.id ? { ...a, rating } : a)),
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  const playAlbum = async (album: Album) => {
    try {
      const detail = await api<{ songs: Song[] }>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      playSongs(detail.songs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play album');
    }
  };

  const shufflePlayAlbum = async (album: Album) => {
    try {
      const detail = await api<{ songs: Song[] }>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      shufflePlay(detail.songs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to shuffle play album');
    }
  };

  const playTrack = (track: SongWithNames) => {
    playSongs([track as Song], 0);
  };

  return (
    <EntityDetail
      isLoading={loading}
      error={error}
      notFound={!artist}
      notFoundMessage="Artist not found."
      documentTitle={artist?.name}
      type="Artist"
      title={artist?.name}
      cover={
        artist && (
          <ArtistImage
            artistId={artist.id}
            alt={`Image for ${artist.name}`}
            className="h-48 w-48 sm:h-56 sm:w-56"
            iconSize={64}
            shape="rounded"
          />
        )
      }
      actions={
        artist && (
          <>
            <PlayButton
              variant="default"
              onPlay={() => playSongs(topTracks as Song[])}
              onShufflePlay={() => shufflePlay(topTracks as Song[])}
              disabled={topTracks.length === 0}
            >
              Play
            </PlayButton>
            <FavoriteRatingGroup
              starred={artist.starred}
              onToggleFavorite={() => handleFavorite(!artist.starred)}
              rating={artist.rating}
              onRate={handleRate}
            />
          </>
        )
      }
    >
      {artist && artist.albums.length > 0 ? (
        <ScrollRow title="Albums">
          {artist.albums.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <Card
                href={`/albums/${album.id}`}
                title={album.name}
                cover={<CoverArt coverArt={album.coverArt} alt={`Cover art for ${album.name}`} />}
                fields={[
                  {
                    content: album.year !== undefined && album.year !== null && (
                      <Link href={`/years/${album.year}`} className="hover:text-muted">
                        {album.year}
                      </Link>
                    ),
                  },
                ]}
                favorite={{
                  starred: album.starred,
                  onClick: () => handleAlbumFavorite(album, !album.starred),
                  label: album.starred ? 'Remove favorite' : 'Add favorite',
                }}
                rating={{
                  value: album.rating,
                  onRate: (rating) => handleAlbumRate(album, rating || undefined),
                }}
                play={{
                  onPlay: () => playAlbum(album),
                  onShufflePlay: () => shufflePlayAlbum(album),
                  label: album.name,
                }}
              />
            </div>
          ))}
        </ScrollRow>
      ) : (
        <>
          <h3 className="mb-3 text-sm font-medium text-fg-secondary">Albums</h3>
          <p className="py-4 text-sm text-muted">No albums found.</p>
        </>
      )}

      <h3 className="mb-2 mt-8 text-sm font-medium text-fg-secondary">Top tracks</h3>
      <TrackList tracks={topTracks} onItemClick={playTrack} showArtist={false} showAlbum />
      {topTracks.length === 0 && <p className="py-4 text-sm text-muted">No tracks found.</p>}
    </EntityDetail>
  );
}
