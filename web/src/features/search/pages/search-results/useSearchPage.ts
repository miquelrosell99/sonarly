import { useState } from 'react';
import { useSearch, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import type { Album, Artist, FavoriteEntityType, Playlist, Song, User } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { usePlayActions } from '../../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../../hooks/useFavoriteActions.js';
import { usePlayer } from '../../../../stores/playerStore.js';
import { useLibraryStore, buildLibraryQuery } from '../../../../stores/libraryStore.js';
import { useSearchResults, type SearchResultsResponse, type SearchType } from '../../../../hooks/useLibraryLists.js';
import { useLibraryMutation, invalidateLibraryEntity } from '../../../../hooks/useLibraryMutation.js';
import { patchToPlayerSong } from '../../../../lib/songPatch.js';
import { songFromPlaylistEntry } from '../../../../lib/entityMappers.js';
import { useNotification } from '../../../../contexts/NotificationContext.js';
import { isValidType, type AlbumDetail, type PlaylistDetailWire } from './searchModel.js';

export interface SearchPageState {
  user: User;
  blurExplicitTitles: boolean;
  query: string;
  type: SearchType;
  setLocation: (to: string) => void;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
  data: SearchResultsResponse | undefined;
  playingId: string | undefined;
  currentAlbumId: string | undefined;
  currentArtistId: string | undefined;
  playSong: (song: Song) => void;
  playSongs: (songs: Song[], startIndex?: number) => void;
  shufflePlay: (songs: Song[]) => void;
  handleFavorite: (
    entityType: FavoriteEntityType,
    key: SearchType,
    id: string,
    starred: boolean,
  ) => Promise<void>;
  handleRate: (
    entityType: FavoriteEntityType,
    key: SearchType,
    id: string,
    rating: number | undefined,
  ) => Promise<void>;
  playAlbum: (album: Pick<Album, 'id'>) => Promise<void>;
  shuffleAlbums: (albums: Pick<Album, 'id'>[]) => Promise<void>;
  playArtist: (artist: Artist) => Promise<void>;
  playPlaylist: (playlist: Pick<Playlist, 'id'>) => Promise<void>;
  shufflePlaylists: (playlists: Pick<Playlist, 'id'>[]) => Promise<void>;
  songEditing: Song[] | null;
  setSongEditing: React.Dispatch<React.SetStateAction<Song[] | null>>;
  syncEditing: Song | null;
  setSyncEditing: React.Dispatch<React.SetStateAction<Song | null>>;
  handleSongSave: (patched: Record<string, unknown>) => Promise<void>;
  handleSongSaveMany: (patched: Record<string, unknown>) => Promise<void>;
  handleSongDelete: () => Promise<void>;
  songMutationPending: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
}

export function useSearchPage(user: User): SearchPageState {
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
  const handleFavorite = async (
    entityType: FavoriteEntityType,
    key: SearchType,
    id: string,
    starred: boolean,
  ) => {
    try {
      await setFavorite(entityType, id, starred);
      patchResult(key, id, { starred });
      await invalidateLibraryEntity(queryClient, entityType);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update favorite', 'error');
    }
  };

  const handleRate = async (
    entityType: FavoriteEntityType,
    key: SearchType,
    id: string,
    rating: number | undefined,
  ) => {
    try {
      await setRating(entityType, id, rating);
      patchResult(key, id, { rating });
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
    const detail = await api<{ playlist: PlaylistDetailWire }>(`/playlists/${playlist.id}`);
    playSongs(detail.playlist.entries.map(songFromPlaylistEntry));
  };

  const shufflePlaylists = async (playlists: Pick<Playlist, 'id'>[]) => {
    const details = await Promise.all(playlists.map((p) => api<{ playlist: PlaylistDetailWire }>(`/playlists/${p.id}`)));
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

  return {
    user,
    blurExplicitTitles,
    query,
    type,
    setLocation,
    isLoading,
    error: error as Error | null,
    refetch,
    data,
    playingId,
    currentAlbumId,
    currentArtistId,
    playSong,
    playSongs,
    shufflePlay,
    handleFavorite,
    handleRate,
    playAlbum,
    shuffleAlbums,
    playArtist,
    playPlaylist,
    shufflePlaylists,
    songEditing,
    setSongEditing,
    syncEditing,
    setSyncEditing,
    handleSongSave,
    handleSongSaveMany,
    handleSongDelete,
    songMutationPending: songMutation.isPending,
    queryClient,
  };
}
