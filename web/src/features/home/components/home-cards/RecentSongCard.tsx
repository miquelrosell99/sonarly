import { useState } from 'react';
import { Link } from 'wouter';
import type { Song, User } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { usePlayActions } from '../../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../../hooks/useFavoriteActions.js';
import { useLibraryMutation, invalidateLibraryEntity } from '../../../../hooks/useLibraryMutation.js';
import { usePlayer } from '../../../../stores/playerStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '../../../entities/Card.js';
import { CoverArt } from '../../../entities/CoverArt.js';
import { ExplicitTitle } from '../../../entities/ExplicitTitle.js';
import { ItemContextMenu } from '../../../entities/ItemContextMenu.js';
import { EditEntityModal } from '../../../edit-entity/EditEntityModal.js';
import { useSongContextMenu } from '../../../../hooks/useSongContextMenu.js';
import { SyncedLyricsEditor } from '../../../songs/index.js';
import { patchToPlayerSong } from '../../../../lib/songPatch.js';

/**
 * One recently-played song card: the same Card/primitives the Tracks grid
 * uses (ExplicitTitle, CoverArt, favorite/rate actions) wrapped in the
 * standard ItemContextMenu, with play starting the whole recently-played
 * list in order at this song.
 */
export function RecentSongCard({
  song: initialSong,
  songs,
  index,
  user,
}: {
  song: Song;
  songs: Song[];
  index: number;
  user: User;
}) {
  const { playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const queryClient = useQueryClient();
  const songMutation = useLibraryMutation('song');
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  const currentSongId = usePlayer((state) => state.currentSong?.id);
  const [song, setSong] = useState(initialSong);
  const [error] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [syncEditing, setSyncEditing] = useState(false);
  const sections = useSongContextMenu(song, () => setEditing(true), user.isAdmin);

  const handleFavorite = async (starred: boolean) => {
    if (await songMutation.run(() => setFavorite('song', song.id, starred))) {
      setSong((prev) => ({ ...prev, starred }));
    }
  };

  const handleRate = async (rating: number) => {
    if (await songMutation.run(() => setRating('song', song.id, rating || undefined))) {
      setSong((prev) => ({ ...prev, rating: rating || undefined }));
    }
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    if (
      await songMutation.run(() =>
        api(`/songs/${song.id}/tags`, {
          method: 'PUT',
          body: JSON.stringify(patched),
        }),
      )
    ) {
      if (song.id === usePlayer.getState().currentSong?.id) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setEditing(false);
      setSong((prev) => ({
        ...prev,
        title: typeof patched.title === 'string' ? patched.title : prev.title,
        artistName: Array.isArray(patched.artist)
          ? patched.artist[0]
          : typeof patched.artist === 'string'
            ? patched.artist
            : prev.artistName,
        albumName: typeof patched.album === 'string' ? patched.album : prev.albumName,
        year: typeof patched.year === 'number' ? patched.year : prev.year,
      }));
    }
  };

  const handleDelete = async () => {
    if (await songMutation.run(() => api(`/songs/${song.id}`, { method: 'DELETE' }))) {
      setEditing(false);
    }
  };

  return (
    <div>
      <ItemContextMenu sections={sections}>
        <Card
          href={`/tracks/${song.id}`}
          title={
            <ExplicitTitle explicit={song.explicit} blur={user.blurExplicitTitles === true}>
              {song.title}
            </ExplicitTitle>
          }
          fields={[
            {
              content: song.artistId ? (
                <Link href={`/artists/${song.artistId}`} className="hover:text-on-surface-variant">
                  {song.artistName ?? 'Unknown artist'}
                </Link>
              ) : (
                (song.artistName ?? '-')
              ),
            },
            {
              content: song.albumId ? (
                <Link href={`/albums/${song.albumId}`} className="hover:text-on-surface-variant">
                  {song.albumName ?? '-'}
                </Link>
              ) : (
                (song.albumName ?? '-')
              ),
            },
          ]}
          cover={
            <CoverArt
              coverArt={song.coverArt}
              alt={`Cover art for ${song.title}`}
              className="rounded-card"
            />
          }
          favorite={{
            starred: song.starred,
            onClick: () => handleFavorite(!song.starred),
            label: song.title,
          }}
          rating={{
            value: song.rating,
            onRate: handleRate,
          }}
          play={{
            onPlay: () => playSongs(songs, index),
            onShufflePlay: () => shufflePlay(songs),
            label: song.title,
          }}
          isPlaying={currentSongId === song.id}
        />
      </ItemContextMenu>
      {error && <p className="mt-1 text-xs text-error">{error}</p>}
      {editing && (
        <EditEntityModal
          open
          entityType="song"
          entity={{ ...song, artist: song.artistName, album: song.albumName }}
          onClose={() => setEditing(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditSyncedLyrics={() => setSyncEditing(true)}
          saving={songMutation.isPending}
          deleting={songMutation.isPending}
        />
      )}
      {syncEditing && (
        <SyncedLyricsEditor
          songId={song.id}
          title={song.title}
          artistName={song.artistName}
          duration={song.duration}
          onClose={() => setSyncEditing(false)}
          onSaved={() => {
            setSyncEditing(false);
            void invalidateLibraryEntity(queryClient, 'song');
          }}
        />
      )}
    </div>
  );
}
