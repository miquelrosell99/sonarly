import { useEffect, useState, type ReactNode } from 'react';
import { useSearch, Link } from 'wouter';
import type { Song, Album, Artist, Playlist, FavoriteEntityType, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useAlbumContextMenu } from '../../../hooks/useAlbumContextMenu.js';
import { useArtistContextMenu } from '../../../hooks/useArtistContextMenu.js';
import { usePlaylistContextMenu } from '../../../hooks/usePlaylistContextMenu.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { useSongsContextMenu } from '../../../hooks/useSongsContextMenu.js';
import { patchToPlayerSong } from '../../../lib/songPatch.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface SearchResultsProps {
  user: User;
}

type SearchType = 'songs' | 'albums' | 'artists' | 'playlists';

const validTypes: SearchType[] = ['songs', 'albums', 'artists', 'playlists'];

interface SearchResponse {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

interface PlaylistDetail {
  playlist: Playlist & { entries: Song[] };
}

function isValidType(value: string | null): value is SearchType {
  return !!value && (validTypes as string[]).includes(value);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function AlbumContextMenu({ album, children }: { album: Album; children: ReactNode }) {
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
  const sections = useSongsContextMenu(songs, onEdit, isAdmin);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function SearchResults({ user }: SearchResultsProps) {
  const blurExplicitTitles = user.blurExplicitTitles === true;
  const search = useSearch();
  const params = new URLSearchParams(search);
  const query = params.get('q') ?? '';
  const rawType = params.get('type');
  const type: SearchType = isValidType(rawType) ? rawType : 'songs';
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [songEditing, setSongEditing] = useState<Song[] | null>(null);
  const [syncEditing, setSyncEditing] = useState<Song | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { playSong, playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { notify } = useNotification();
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  const playingId = usePlayer((state) => state.currentSong?.id);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const libraryQuery = buildLibraryQuery(selectedLibraryId);
  const libraryParam = libraryQuery ? `&${libraryQuery.slice(1)}` : '';

  const load = () => {
    if (!query.trim()) {
      setData({ songs: [], albums: [], artists: [], playlists: [] });
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api<SearchResponse>(`/search?q=${encodeURIComponent(query)}&type=${type}${libraryParam}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load search results'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [query, type, selectedLibraryId]);

  function updateItem<T extends { id: string }>(
    prev: SearchResponse | null,
    key: SearchType,
    id: string,
    patch: Partial<T>,
  ): SearchResponse | null {
    if (!prev) return prev;
    const list = prev[key] as unknown as T[];
    return {
      ...prev,
      [key]: list.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    } as SearchResponse;
  }

  const handleFavorite = async <T extends { id: string; starred?: boolean }>(
    entityType: FavoriteEntityType,
    id: string,
    starred: boolean,
    update: (patch: Partial<T>) => void,
  ) => {
    await setFavorite(entityType, id, starred);
    update({ starred } as Partial<T>);
  };

  const handleRate = async <T extends { id: string; rating?: number }>(
    entityType: FavoriteEntityType,
    id: string,
    rating: number | undefined,
    update: (patch: Partial<T>) => void,
  ) => {
    await setRating(entityType, id, rating);
    update({ rating } as Partial<T>);
  };

  const playAlbum = async (album: Album) => {
    const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
    playSongs(detail.songs);
  };

  const shuffleAlbums = async (albums: Album[]) => {
    const details = await Promise.all(albums.map((a) => api<AlbumDetail>(`/albums/${a.id}${buildLibraryQuery(selectedLibraryId)}`)));
    shufflePlay(details.flatMap((d) => d.songs));
  };

  const playArtist = async (artist: Artist) => {
    const { songs } = await api<{ songs: Song[] }>(`/artists/${artist.id}/songs${buildLibraryQuery(selectedLibraryId)}`);
    playSongs(songs);
  };

  const playPlaylist = async (playlist: Playlist) => {
    const detail = await api<PlaylistDetail>(`/playlists/${playlist.id}`);
    playSongs(detail.playlist.entries);
  };

  const shufflePlaylists = async (playlists: Playlist[]) => {
    const details = await Promise.all(playlists.map((p) => api<PlaylistDetail>(`/playlists/${p.id}`)));
    shufflePlay(details.flatMap((d) => d.playlist.entries));
  };

  const handleSongSave = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length !== 1) return;
    setSaving(true);
    try {
      await api(`/songs/${songEditing[0].id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      if (songEditing[0].id === usePlayer.getState().currentSong?.id) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save song', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSongSaveMany = async (patched: Record<string, unknown>) => {
    if (!songEditing || songEditing.length < 2) return;
    setSaving(true);
    try {
      await api('/songs/tags', {
        method: 'PUT',
        body: JSON.stringify({
          ids: songEditing.map((s) => s.id),
          tags: patched,
        }),
      });
      const currentId = usePlayer.getState().currentSong?.id;
      if (currentId && songEditing.some((s) => s.id === currentId)) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setSongEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save songs', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSongDelete = async () => {
    if (!songEditing || songEditing.length !== 1) return;
    setDeleting(true);
    try {
      await api(`/songs/${songEditing[0].id}`, { method: 'DELETE' });
      setSongEditing(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete song', 'error');
    } finally {
      setDeleting(false);
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
        render: (song) => (song.duration ? formatDuration(song.duration) : '-'),
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
        title={`Songs matching "${query}"`}
        data={songs}
        isLoading={loading}
        error={error}
        columns={columns}
        cardFields={cardFields}
        getId={(song) => song.id}
        getHref={(song) => `/tracks/${song.id}`}
        onPlay={playSong}
        onPlaySelection={playSongs}
        onShufflePlay={shufflePlay}
        onFavorite={(song, starred) =>
          handleFavorite<Song>('song', song.id, starred, (patch) =>
            setData((prev) => updateItem(prev, 'songs', song.id, patch)),
          )
        }
        onRate={(song, rating) =>
          handleRate<Song>('song', song.id, rating, (patch) =>
            setData((prev) => updateItem(prev, 'songs', song.id, patch)),
          )
        }
        getFavorite={(song) => song.starred}
        getRating={(song) => song.rating}
        playingId={playingId}
        renderContextMenu={(song, children, selectedItems) => (
          <SongContextMenu songs={selectedItems} onEdit={() => setSongEditing(selectedItems)} isAdmin={user.isAdmin}>
            {children}
          </SongContextMenu>
        )}
        emptyMessage={`No songs match "${query}".`}
      />
    );
  };

  const renderAlbums = (albums: Album[]) => {
    const columns: LibraryViewColumn<Album>[] = [
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
    const cardFields: LibraryViewCardField<Album>[] = [
      { key: 'title', render: (album) => <ExplicitTitle title={album.name} explicit={album.explicit} blur={blurExplicitTitles} /> },
      {
        key: 'artist',
        render: (album) =>
          `${album.artistName ?? '-'}${album.year !== undefined ? ` • ${album.year}` : ''}`,
      },
    ];
    return (
      <LibraryView
        title={`Albums matching "${query}"`}
        data={albums}
        isLoading={loading}
        error={error}
        columns={columns}
        cardFields={cardFields}
        getId={(album) => album.id}
        getHref={(album) => `/albums/${album.id}`}
        onPlay={playAlbum}
        onShufflePlay={shuffleAlbums}
        onFavorite={(album, starred) =>
          handleFavorite<Album>('album', album.id, starred, (patch) =>
            setData((prev) => updateItem(prev, 'albums', album.id, patch)),
          )
        }
        onRate={(album, rating) =>
          handleRate<Album>('album', album.id, rating, (patch) =>
            setData((prev) => updateItem(prev, 'albums', album.id, patch)),
          )
        }
        getFavorite={(album) => album.starred}
        getRating={(album) => album.rating}
        getCover={(album) => album.coverArt}
        getCoverAlt={(album) => `Cover art for ${album.name}`}
        renderContextMenu={(album, children) => <AlbumContextMenu album={album}>{children}</AlbumContextMenu>}
        emptyMessage={`No albums match "${query}".`}
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
        title={`Artists matching "${query}"`}
        data={artists}
        isLoading={loading}
        error={error}
        columns={columns}
        cardFields={cardFields}
        getId={(artist) => artist.id}
        getHref={(artist) => `/artists/${artist.id}`}
        onPlay={playArtist}
        onFavorite={(artist, starred) =>
          handleFavorite<Artist>('artist', artist.id, starred, (patch) =>
            setData((prev) => updateItem(prev, 'artists', artist.id, patch)),
          )
        }
        onRate={(artist, rating) =>
          handleRate<Artist>('artist', artist.id, rating, (patch) =>
            setData((prev) => updateItem(prev, 'artists', artist.id, patch)),
          )
        }
        getFavorite={(artist) => artist.starred}
        getRating={(artist) => artist.rating}
        renderContextMenu={(artist, children) => (
          <ArtistContextMenu artist={artist}>{children}</ArtistContextMenu>
        )}
        emptyMessage={`No artists match "${query}".`}
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
        title={`Playlists matching "${query}"`}
        data={playlists}
        isLoading={loading}
        error={error}
        columns={columns}
        cardFields={cardFields}
        getId={(playlist) => playlist.id}
        getHref={(playlist) => `/playlists/${playlist.id}`}
        onPlay={playPlaylist}
        onShufflePlay={shufflePlaylists}
        onFavorite={(playlist, starred) =>
          handleFavorite<Playlist>('playlist', playlist.id, starred, (patch) =>
            setData((prev) => updateItem(prev, 'playlists', playlist.id, patch)),
          )
        }
        onRate={(playlist, rating) =>
          handleRate<Playlist>('playlist', playlist.id, rating, (patch) =>
            setData((prev) => updateItem(prev, 'playlists', playlist.id, patch)),
          )
        }
        getFavorite={(playlist) => playlist.starred}
        getRating={(playlist) => playlist.rating}
        renderContextMenu={(playlist, children) => (
          <PlaylistContextMenu playlist={playlist}>{children}</PlaylistContextMenu>
        )}
        emptyMessage={`No playlists match "${query}".`}
        defaultView="grid"
      />
    );
  };

  const songEditEntities = songEditing?.map((song) => ({
    ...song,
    artist: song.artistName,
    album: song.albumName,
  }));

  if (!data) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Search</h2>
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  const result = (() => {
    switch (type) {
      case 'songs':
        return renderSongs(data.songs);
      case 'albums':
        return renderAlbums(data.albums);
      case 'artists':
        return renderArtists(data.artists);
      case 'playlists':
        return renderPlaylists(data.playlists);
      default:
        return renderSongs(data.songs);
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
          saving={saving}
          deleting={deleting}
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
            load();
          }}
        />
      )}
    </>
  );
}
