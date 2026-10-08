import { useState, type ReactNode } from 'react';
import type { Song } from '../types';
import { useLocation } from 'wouter';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { ConfirmModal } from '../components/ui/ConfirmModal.js';
import { api } from '../lib/api.js';
import { downloadSongs } from '../lib/download.js';
import { getShareToken } from '../lib/shareToken.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';
import { useLibraryMutation } from './useLibraryMutation.js';

export interface SongsContextMenuOptions {
  /**
   * Whether the Download entry shows. Session surfaces default to true;
   * share-link guests default to false — the shared playlist's shareDownload
   * flag (the detail DTO carries it) must be passed in explicitly.
   */
  allowDownload?: boolean;
}

export interface SongsContextMenu {
  sections: ContextMenuSection[];
  /**
   * The pending-delete ConfirmModal (null when nothing is pending). Hosts
   * render it next to the menu trigger; the hook owns the delete flow.
   */
  deleteConfirm: ReactNode;
}

export function useSongsContextMenu(
  songs: Song[],
  onEdit: () => void,
  isAdmin?: boolean,
  options?: SongsContextMenuOptions,
): SongsContextMenu {
  const { playSong, playSongs, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const songMutation = useLibraryMutation('song');
  const [, navigate] = useLocation();
  const allowDownload = options?.allowDownload ?? getShareToken() === undefined;
  const [pendingDelete, setPendingDelete] = useState<{ count: number; trackLabel: string } | null>(null);

  const count = songs.length;
  const trackLabel = count === 1 ? 'track' : 'tracks';

  const sections: ContextMenuSection[] = [];

  if (count > 0) {
    if (count === 1) {
      const song = songs[0];
      sections.push({
        title: 'Playback',
        items: [
          { id: 'play', label: 'Play', icon: 'mdi-play', onClick: () => playSong(song) },
          { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', onClick: () => playNext(song) },
          { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', onClick: () => addToQueue([song]) },
        ],
      });
      const navigateItems = [
        ...(song.albumId
          ? [{ id: 'go-to-album', label: 'Go to album', icon: 'mdi-album', onClick: () => navigate(`/albums/${song.albumId}`) }]
          : []),
        ...(song.artistId
          ? [{ id: 'go-to-artist', label: 'Go to artist', icon: 'mdi-account-music', onClick: () => navigate(`/artists/${song.artistId}`) }]
          : []),
      ];
      if (navigateItems.length > 0) {
        sections.push({ items: navigateItems });
      }
    } else {
      sections.push({
        title: 'Playback',
        items: [
          { id: 'play', label: 'Play', icon: 'mdi-play', onClick: () => playSongs(songs) },
          { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', onClick: () => playNext(songs) },
          { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', onClick: () => addToQueue(songs) },
        ],
      });
    }

    if (allowDownload) {
      sections.push({
        items: [
          {
            id: 'download',
            label: count === 1 ? 'Download' : `Download ${count} tracks`,
            icon: 'mdi-download',
            onClick: () => void downloadSongs(songs.map((song) => song.id)),
          },
        ],
      });
    }

    if (isAdmin ?? true) {
      const label = count === 1 ? 'Edit' : `Edit ${count} songs`;
      sections.push({
        items: [{ id: 'edit', label, icon: 'mdi-pencil', onClick: onEdit }],
      });

      // The album-view gap: row selections had no delete. The hook owns the
      // whole flow — ConfirmModal gate, per-id DELETE inside ONE mutation
      // (one shared invalidation), success toast.
      sections.push({
        items: [
          {
            id: 'delete',
            label: `Delete ${count} ${trackLabel}`,
            icon: 'mdi-delete',
            variant: 'danger',
            onClick: () => setPendingDelete({ count, trackLabel }),
          },
        ],
      });
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { count: deleteCount, trackLabel: deleteLabel } = pendingDelete;
    setPendingDelete(null);
    const ok = await songMutation.run(async () => {
      for (const song of songs) {
        await api(`/songs/${song.id}`, { method: 'DELETE' });
      }
    });
    if (ok) notify(`Deleted ${deleteCount} ${deleteLabel}`, 'success');
  };

  const deleteConfirm = pendingDelete ? (
    <ConfirmModal
      open
      onClose={() => setPendingDelete(null)}
      title={`Delete ${pendingDelete.count} ${pendingDelete.trackLabel}?`}
      message="This cannot be undone."
      confirmLabel="Delete"
      danger
      onConfirm={() => void confirmDelete()}
    />
  ) : null;

  return { sections, deleteConfirm };
}
