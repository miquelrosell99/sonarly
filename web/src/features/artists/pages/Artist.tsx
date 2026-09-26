import { useParams, Link } from 'wouter';
import type { Song, User } from '../../../types';
import { api } from '../../../lib/api.js';
import { Card } from '../../../components/Card.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { ArtistImage } from '../../../components/ArtistImage.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { PlayButton } from '../../../components/PlayButton.js';
import { ScrollRow } from '../../../components/ScrollRow.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useLibraryMutation } from '../../../hooks/useLibraryMutation.js';
import { useArtistDetail, type ArtistAlbum } from '../../../hooks/useEntityDetails.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { formatDuration } from '../../../lib/format.js';
import type { SongWithNames } from '../../../lib/types.js';

export function Artist({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const { data: detail, isLoading, error, refetch, patchDetail } = useArtistDetail(id);
  const artist = detail?.artist;
  // The /artists/:id response embeds the artist's songs server-side — this
  // replaces the old parallel full-library /songs fetch and its 500-row
  // client filter (audit F16/F24).
  const topTracks: SongWithNames[] = detail?.songs ?? [];
  const { setFavorite, setRating } = useFavoriteActions();
  const { playSongs, shufflePlay } = usePlayActions();
  const { notify } = useNotification();
  const songMutation = useLibraryMutation('song');
  const albumMutation = useLibraryMutation('album');
  const artistMutation = useLibraryMutation('artist');
  const currentAlbumId = usePlayer((state) => state.currentSong?.albumId);
  const playingId = usePlayer((state) => state.currentSong?.id);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const blurExplicitTitles = user.blurExplicitTitles === true;

  const handleFavorite = async (starred: boolean) => {
    if (!artist) return;
    if (await artistMutation.run(() => setFavorite('artist', artist.id, starred))) {
      patchDetail({ artist: { ...artist, starred } });
    }
  };

  const handleRate = async (rating?: number) => {
    if (!artist) return;
    if (await artistMutation.run(() => setRating('artist', artist.id, rating))) {
      patchDetail({ artist: { ...artist, rating } });
    }
  };

  const handleAlbumFavorite = async (album: ArtistAlbum, starred: boolean) => {
    if (!artist) return;
    if (await albumMutation.run(() => setFavorite('album', album.id, starred))) {
      patchDetail({
        artist: {
          ...artist,
          albums: artist.albums.map((a) => (a.id === album.id ? { ...a, starred } : a)),
        },
      });
    }
  };

  const handleAlbumRate = async (album: ArtistAlbum, rating?: number) => {
    if (!artist) return;
    if (await albumMutation.run(() => setRating('album', album.id, rating))) {
      patchDetail({
        artist: {
          ...artist,
          albums: artist.albums.map((a) => (a.id === album.id ? { ...a, rating } : a)),
        },
      });
    }
  };

  const playAlbum = async (album: ArtistAlbum) => {
    try {
      const detail = await api<{ songs: Song[] }>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      playSongs(detail.songs);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to play album', 'error');
    }
  };

  const shufflePlayAlbum = async (album: ArtistAlbum) => {
    try {
      const detail = await api<{ songs: Song[] }>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      shufflePlay(detail.songs);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to shuffle play album', 'error');
    }
  };

  const handlePlay = (track: SongWithNames) => {
    playSongs([track as Song], 0);
  };

  const handlePlaySelection = (tracks: SongWithNames[], startIndex: number) => {
    playSongs(tracks as Song[], startIndex);
  };

  const handleShuffleTracks = (tracks: SongWithNames[]) => {
    shufflePlay(tracks as Song[]);
  };

  const handleTrackFavorite = async (track: SongWithNames, starred: boolean) => {
    if (await songMutation.run(() => setFavorite('song', track.id, starred))) {
      patchDetail({ songs: topTracks.map((t) => (t.id === track.id ? { ...t, starred } : t)) });
    }
  };

  const handleTrackRate = async (track: SongWithNames, rating?: number) => {
    if (await songMutation.run(() => setRating('song', track.id, rating))) {
      patchDetail({ songs: topTracks.map((t) => (t.id === track.id ? { ...t, rating } : t)) });
    }
  };

  const columns: LibraryViewColumn<SongWithNames>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (track) => (
        <ExplicitTitle explicit={track.explicit} blur={blurExplicitTitles}>
          <Link href={`/tracks/${track.id}`} className="hover:text-muted">
            {track.title}
          </Link>
        </ExplicitTitle>
      ),
    },
    {
      key: 'album',
      header: 'Album',
      render: (track) =>
        track.albumName ? (
          track.albumId ? (
            <Link href={`/albums/${track.albumId}`} className="hover:text-muted">
              {track.albumName}
            </Link>
          ) : (
            track.albumName
          )
        ) : (
          '-'
        ),
    },
    {
      key: 'duration',
      header: 'Duration',
      className: 'w-24',
      render: (track) => (
        <span className="font-mono tabular-nums">
          {track.duration ? formatDuration(track.duration) : '-'}
        </span>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<SongWithNames>[] = [
    {
      key: 'title',
      render: (track) => (
        <ExplicitTitle explicit={track.explicit} blur={blurExplicitTitles}>
          {track.title}
        </ExplicitTitle>
      ),
    },
    {
      key: 'album',
      render: (track) => track.albumName ?? '-',
      getHref: (track) => (track.albumId ? `/albums/${track.albumId}` : undefined),
    },
  ];

  return (
    <EntityDetail
      isLoading={isLoading}
      error={error?.message ?? null}
      onRetry={() => void refetch()}
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
                isPlaying={currentAlbumId === album.id}
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

      <LibraryView
        title="Tracks"
        data={topTracks}
        columns={columns}
        cardFields={cardFields}
        getId={(track) => track.id}
        getHref={(track) => `/tracks/${track.id}`}
        onPlay={handlePlay}
        onPlaySelection={handlePlaySelection}
        onShufflePlay={handleShuffleTracks}
        playingId={playingId}
        onFavorite={handleTrackFavorite}
        onRate={handleTrackRate}
        getFavorite={(track) => track.starred}
        getRating={(track) => track.rating}
        emptyMessage="No tracks found."
      />
    </EntityDetail>
  );
}
