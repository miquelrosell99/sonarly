import { useState, type ReactNode } from 'react';
import { useSearch, Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import type { components } from '../../../contract/schema.js';
import type { Song, Album, Artist, Playlist, FavoriteEntityType, User } from '../../../types';
import { api } from '../../../lib/api.js';
import { PageState } from '../../../components/PageState.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useAlbumContextMenu, type AlbumMenuTarget } from '../../../hooks/useAlbumContextMenu.js';
import { useArtistContextMenu } from '../../../hooks/useArtistContextMenu.js';
import { usePlaylistContextMenu } from '../../../hooks/usePlaylistContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { useSearchResults, type SearchResultsResponse, type SearchType } from '../../../hooks/useLibraryLists.js';
import { useLibraryMutation, invalidateLibraryEntity } from '../../../hooks/useLibraryMutation.js';
import { useSongsContextMenu } from '../../../hooks/useSongsContextMenu.js';
import { patchToPlayerSong } from '../../../lib/songPatch.js';
import { songFromPlaylistEntry, songFromSearchSong, playlistFromSearchPlaylist } from '../../../lib/entityMappers.js';
import { SONG_COLUMN_CONFIG_KEY } from '../../songs/components/SongTable.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface SearchResultsProps {
  user: User;
}

const validTypes: SearchType[] = ['songs', 'albums', 'artists', 'playlists'];

// The /search envelope carries display-subset DTOs (SearchSong/SearchAlbum/
// SearchArtist/SearchPlaylist), not full domain objects — the search page
// renders the subsets as-is and only widens at play/edit boundaries through
// the shared mappers (audit F17).
type SearchAlbumItem = components['schemas']['SearchAlbum'];

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

type PlaylistDetail = components['schemas']['PlaylistDetail'];

function isValidType(value: string | null): value is SearchType {
  return !!value && (validTypes as string[]).includes(value);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function AlbumContextMenu({ album, children }: { album: AlbumMenuTarget; children: ReactNode }) {
  const sections = useAlbumContextMenu(album);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function ArtistContextMenu({ artist, children }: { artist: Artist; children: ReactNode }) {
  const sections = useArtistContextMenu(artist, () => {});
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function PlaylistContextMenu({ playlist, children }: { playlist: Playlist; children: ReactNode }) {
  const sections = usePlaylistContextMenu(playlist, () => {}, () => {});
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

function SongContextMenu({
  songs,
  onEdit,
  isAdmin,
  children,
}: {
  songs: Song[];
  onEdit: () => void;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const { sections, deleteConfirm } = useSongsContextMenu(songs, onEdit, isAdmin);
  return (
    <>
      <ItemContextMenu sections={sections}>{children}</ItemContextMenu>
      {deleteConfirm}
    </>
  );
}

export function SearchResults({ user }: SearchResultsProps) {
  const blurExplicitTitles = user.blurExplicitTitles === true;
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const query = params.get('q') ?? '';
  const rawType = params.get('type');
  const type: SearchType = isValidType(rawType) ? rawType : 'songs';
  const [songEditing, setSongEditing] = useState<Song[] | null>(null);
  const [syncEditing, setSyncEditing] = useState<Song | null>(null);
  const { playSong, playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { notify } = useNotification();
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  const currentSong = usePlayer((state) => state.currentSong);
  const playingId = currentSong?.id;
  const currentAlbumId = currentSong?.albumId;
  const currentArtistId = currentSong?.artistId;
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const queryClient = useQueryClient();
  const songMutation = useLibraryMutation('song');
  // The debounce lives in SearchBox (200ms before the ?q= param changes);
  // once the param lands here the fetch is immediate, as before.
  const { data, isLoading, error, refetch } = useSearchResults(query, type, selectedLibraryId);
  const searchKey = ['search', 'results', { q: query, type, libraryId: selectedLibraryId }] as const;

  const patchResult = (key: SearchType, id: string, patch: Record<string, unknown>) => {
    queryClient.setQueryData<SearchResultsResponse>([...searchKey], (prev) => {
      if (!prev) return prev;
      const list = prev[key] as { id: string }[];
      return { ...prev, [key]: list.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
    });
  };

  // Favorite/rate span every searchable entity at runtime, so they share the
  // invalidation map through invalidateLibraryEntity rather than one hook
  // instance (the hook variant is used for the song-only edits below).
  const handleFavorite = async <T extends { id: string; starred?: boolean }>(
    entityType: FavoriteEntityType,
    key: SearchType,
    id: string,
    starred: boolean,
  ) => {
    try {
      await setFavorite(entityType, id, starred);
      patchResult(key, id, { starred } as Partial<T>);
      await invalidateLibraryEntity(queryClient, entityType);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async <T extends { id: string; rating?: number }>(
    entityType: FavoriteEntityType,
    key: SearchType,
    id: string,
    rating: number | undefined,
  ) => {
    try {
      await setRating(entityType, id, rating);
      patchResult(key, id, { rating } as Partial<T>);
      await invalidateLibraryEntity(queryClient, entityType);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update rating', 'error');
    }
  };

  const playAlbum = async (album: Pick<Album, 'id'>) => {
    const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
    playSongs(detail.songs);
  };

  const shuffleAlbums = async (albums: Pick<Album, 'id'>[]) => {
    const details = await Promise.all(albums.map((a) => api<AlbumDetail>(`/albums/${a.id}${buildLibraryQuery(selectedLibraryId)}`)));
    shufflePlay(details.flatMap((d) => d.songs));
  };

  const playArtist = async (artist: Artist) => {
    const { songs } = await api<{ songs: Song[] }>(`/artists/${artist.id}/songs${buildLibraryQuery(selectedLibraryId)}`);
    playSongs(songs);
  };

  const playPlaylist = async (playlist: Pick<Playlist, 'id'>) => {
    const detail = await api<{ playlist: PlaylistDetail }>(`/playlists/${playlist.id}`);
    playSongs(detail.playlist.entries.map(songFromPlaylistEntry));
  };

  const shufflePlaylists = async (playlists: Pick<Playlist, 'id'>[]) => {
    const details = await Promise.all(playlists.map((p) => api<{ playlist: PlaylistDetail }>(`/playlists/${p.id}`)));
    shufflePlay(details.flatMap((d) => d.playlist.entries.map(songFromPlaylistEntry)));
  };

  const handleSongSave = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length !== 1) return;
    if (
      await songMutation.run(() =>
        api(`/songs/${songEditing[0].id}/tags`, {
          method: 'PUT',
          body: JSON.stringify(patched),
        }),
      )
    ) {
      if (songEditing[0].id === usePlayer.getState().currentSong?.id) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
    }
  };

  const handleSongSaveMany = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length < 2) return;
    if (
      await songMutation.run(() =>
        api('/songs/tags', {
          method: 'PUT',
          body: JSON.stringify({
            ids: songEditing.map((s) => s.id),
            tags: patched,
          }),
        }),
      )
    ) {
      const currentId = usePlayer.getState().currentSong?.id;
      if (currentId && songEditing.some((s) => s.id === currentId)) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
    }
  };

  const handleSongDelete = async () => {
    if (!songEditing || songEditing.length !== 1) return;
    if (await songMutation.run(() => api(`/songs/${songEditing[0].id}`, { method: 'DELETE' }))) {
      setSongEditing(null);
    }
  };

  const renderSongs = (songs: Song[]) => {
    const columns: LibraryViewColumn<Song>[] = [
      {
        key: 'title',
        header: 'Title',
        render: (song) => (
          <ExplicitTitle explicit={song.explicit} blur={blurExplicitTitles}>
            <Link href={`/tracks/${song.id}`} className="hover:text-muted">
              {song.title}
            </Link>
          </ExplicitTitle>
        ),
      },
      { key: 'artist', header: 'Artist', render: (song) => song.artistName ?? '-' },
      { key: 'album', header: 'Album', render: (song) => song.albumName ?? '-' },
      {
        key: 'duration',
        header: 'Duration',
        className: 'w-24',
        render: (song) => (
          <span className="font-mono tabular-nums">
            {song.duration ? formatDuration(song.duration) : '-'}
          </span>
        ),
      },
    ];
    const cardFields: LibraryViewCardField<Song>[] = [
      {
        key: 'title',
        render: (song) => (
          <ExplicitTitle explicit={song.explicit} blur={blurExplicitTitles}>
            {song.title}
          </ExplicitTitle>
        ),
      },
      { key: 'artist', render: (song) => song.artistName ?? '-' },
      { key: 'album', render: (song) => song.albumName ?? '-' },
    ];
    return (
      <LibraryView
        viewModeKey="search-songs"
        columnConfigKey={SONG_COLUMN_CONFIG_KEY}
        title={`Songs matching "${query}"`}
        data={songs}
        isLoading={isLoading}
        error={error?.message ?? null}
        columns={columns}
        cardFields={cardFields}
        getId={(song) => song.id}
        getHref={(song) => `/tracks/${song.id}`}
        onPlay={playSong}
        onPlaySelection={playSongs}
        onShufflePlay={shufflePlay}
        onFavorite={(song, starred) => void handleFavorite<Song>('song', 'songs', song.id, starred)}
        onRate={(song, rating) => void handleRate<Song>('song', 'songs', song.id, rating)}
        getFavorite={(song) => song.starred}
        getRating={(song) => song.rating}
        playingId={playingId}
        renderContextMenu={(_song, children, selectedItems) => (
          <SongContextMenu songs={selectedItems} onEdit={() => setSongEditing(selectedItems)} isAdmin={user.isAdmin}>
            {children}
          </SongContextMenu>
        )}
        emptyMessage={`No songs match "${query}".`}
        emptyAction={{ label: 'Clear search', onClick: () => setLocation('/search') }}
      />
    );
  };

  const renderAlbums = (albums: SearchAlbumItem[]) => {
    const columns: LibraryViewColumn<SearchAlbumItem>[] = [
      {
        key: 'title',
        header: 'Title',
        render: (album) => (
          <ExplicitTitle explicit={album.explicit} blur={blurExplicitTitles}>
            <Link href={`/albums/${album.id}`} className="hover:text-muted">
              {album.name}
            </Link>
          </ExplicitTitle>
        ),
      },
      { key: 'artist', header: 'Artist', render: (album) => album.artistName ?? '-' },
      { key: 'year', header: 'Year', className: 'w-20', render: (album) => album.year ?? '-' },
      { key: 'genre', header: 'Genre', render: (album) => album.genre ?? '-' },
    ];
    const cardFields: LibraryViewCardField<SearchAlbumItem>[] = [
      { key: 'title', render: (album) => <ExplicitTitle title={album.name} explicit={album.explicit} blur={blurExplicitTitles} /> },
      {
        key: 'artist',
        render: (album) =>
          `${album.artistName ?? '-'}${album.year !== undefined ? ` • ${album.year}` : ''}`,
      },
    ];
    return (
      <LibraryView
        viewModeKey="search-albums"
        title={`Albums matching "${query}"`}
        data={albums}
        isLoading={isLoading}
        error={error?.message ?? null}
        columns={columns}
        cardFields={cardFields}
        getId={(album) => album.id}
        getHref={(album) => `/albums/${album.id}`}
        onPlay={playAlbum}
        onShufflePlay={shuffleAlbums}
        onFavorite={(album, starred) => void handleFavorite<SearchAlbumItem>('album', 'albums', album.id, starred)}
        onRate={(album, rating) => void handleRate<SearchAlbumItem>('album', 'albums', album.id, rating)}
        getFavorite={(album) => album.starred}
        getRating={(album) => album.rating}
        getCover={(album) => album.coverArt}
        getCoverAlt={(album) => `Cover art for ${album.name}`}
        playingId={currentAlbumId}
        renderContextMenu={(album, children) => <AlbumContextMenu album={album}>{children}</AlbumContextMenu>}
        emptyMessage={`No albums match "${query}".`}
        emptyAction={{ label: 'Clear search', onClick: () => setLocation('/search') }}
        defaultView="grid"
      />
    );
  };

  const renderArtists = (artists: Artist[]) => {
    const columns: LibraryViewColumn<Artist>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (artist) => (
          <Link href={`/artists/${artist.id}`} className="hover:text-muted">
            {artist.name}
          </Link>
        ),
      },
    ];
    const cardFields: LibraryViewCardField<Artist>[] = [{ key: 'name', render: (artist) => artist.name }];
    return (
      <LibraryView
        viewModeKey="search-artists"
        title={`Artists matching "${query}"`}
        data={artists}
        isLoading={isLoading}
        error={error?.message ?? null}
        columns={columns}
        cardFields={cardFields}
        getId={(artist) => artist.id}
        getHref={(artist) => `/artists/${artist.id}`}
        onPlay={playArtist}
        onFavorite={(artist, starred) => void handleFavorite<Artist>('artist', 'artists', artist.id, starred)}
        onRate={(artist, rating) => void handleRate<Artist>('artist', 'artists', artist.id, rating)}
        getFavorite={(artist) => artist.starred}
        getRating={(artist) => artist.rating}
        playingId={currentArtistId}
        renderContextMenu={(artist, children) => (
          <ArtistContextMenu artist={artist}>{children}</ArtistContextMenu>
        )}
        emptyMessage={`No artists match "${query}".`}
        emptyAction={{ label: 'Clear search', onClick: () => setLocation('/search') }}
        defaultView="grid"
      />
    );
  };

  const renderPlaylists = (playlists: Playlist[]) => {
    const columns: LibraryViewColumn<Playlist>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (playlist) => (
          <Link href={`/playlists/${playlist.id}`} className="hover:text-muted">
            {playlist.name}
          </Link>
        ),
      },
      { key: 'owner', header: 'Owner', render: (playlist) => playlist.ownerUsername ?? '-' },
      { key: 'visibility', header: 'Visibility', render: (playlist) => playlist.visibility },
    ];
    const cardFields: LibraryViewCardField<Playlist>[] = [
      { key: 'name', render: (playlist) => playlist.name },
      { key: 'owner', render: (playlist) => playlist.ownerUsername ?? '-' },
    ];
    return (
      <LibraryView
        viewModeKey="search-playlists"
        title={`Playlists matching "${query}"`}
        data={playlists}
        isLoading={isLoading}
        error={error?.message ?? null}
        columns={columns}
        cardFields={cardFields}
        getId={(playlist) => playlist.id}
        getHref={(playlist) => `/playlists/${playlist.id}`}
        onPlay={playPlaylist}
        onShufflePlay={shufflePlaylists}
        onFavorite={(playlist, starred) => void handleFavorite<Playlist>('playlist', 'playlists', playlist.id, starred)}
        onRate={(playlist, rating) => void handleRate<Playlist>('playlist', 'playlists', playlist.id, rating)}
        getFavorite={(playlist) => playlist.starred}
        getRating={(playlist) => playlist.rating}
        renderContextMenu={(playlist, children) => (
          <PlaylistContextMenu playlist={playlist}>{children}</PlaylistContextMenu>
        )}
        emptyMessage={`No playlists match "${query}".`}
        emptyAction={{ label: 'Clear search', onClick: () => setLocation('/search') }}
        defaultView="grid"
      />
    );
  };

  const songEditEntities = songEditing?.map((song) => ({
    ...song,
    artist: song.artistName,
    album: song.albumName,
  }));

  if (!query.trim()) {
    return (
      <PageState isEmpty emptyMessage="Type to search" emptyIcon="mdi-magnify">
        {null}
      </PageState>
    );
  }

  if (error) {
    return (
      <PageState error={error.message} onRetry={() => void refetch()}>
        {null}
      </PageState>
    );
  }

  if (!data || isLoading) {
    return <PageState loading>{null}</PageState>;
  }

  const result = (() => {
    switch (type) {
      case 'songs':
        // Search hits are display subsets; widen to full Songs through the
        // shared mapper before they reach the player/editors (audit F17).
        return renderSongs(data.songs.map(songFromSearchSong));
      case 'albums':
        return renderAlbums(data.albums);
      case 'artists':
        return renderArtists(data.artists);
      case 'playlists':
        return renderPlaylists(data.playlists.map(playlistFromSearchPlaylist));
      default:
        return renderSongs(data.songs.map(songFromSearchSong));
    }
  })();

  return (
    <>
      {result}
      {songEditEntities && songEditEntities.length > 0 && (
        <EditEntityModal
          open
          entityType="song"
          entities={songEditEntities}
          entity={songEditEntities.length === 1 ? songEditEntities[0] : undefined}
          onClose={() => setSongEditing(null)}
          onSave={handleSongSave}
          onSaveMany={handleSongSaveMany}
          onDelete={songEditEntities.length === 1 ? handleSongDelete : undefined}
          onEditSyncedLyrics={
            songEditEntities.length === 1 && songEditing
              ? () => songEditing && setSyncEditing(songEditing[0])
              : undefined
          }
          saving={songMutation.isPending}
          deleting={songMutation.isPending}
        />
      )}
      {syncEditing && (
        <SyncedLyricsEditor
          songId={syncEditing.id}
          title={syncEditing.title}
          artistName={syncEditing.artistName}
          duration={syncEditing.duration}
          onClose={() => setSyncEditing(null)}
          onSaved={() => {
            setSyncEditing(null);
            void invalidateLibraryEntity(queryClient, 'song');
          }}
        />
      )}
    </>
  );
}
