import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import type { Playlist } from '../types';
import { api } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { ItemContextMenu } from './ItemContextMenu.js';
import { ConfirmModal } from './ui/ConfirmModal.js';
import { SharePlaylistModal } from '../features/playlists/index.js';
import { usePlaylistContextMenu } from '../hooks/usePlaylistContextMenu.js';
import { useCreatePlaylistModal } from '../hooks/useCreatePlaylistModal.js';
import { usePlaylist } from '../hooks/usePlaylist.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { useAddSongsToPlaylist } from '../hooks/useAddSongsToPlaylist.js';
import { hasSongsDragData, readSongsDragData } from '../lib/dragSongs.js';

interface SidebarPlaylistItemProps {
  playlist: Playlist;
  href: string;
  active: boolean;
  isOwner: boolean;
}

function SidebarShareModal({ playlistId, onClose }: { playlistId: string; onClose: () => void }) {
  const { data: playlist } = usePlaylist(playlistId);
  // The detail response carries the owner-only shares/shareToken the modal needs.
  if (!playlist) return null;
  return <SharePlaylistModal open onClose={onClose} playlist={playlist} />;
}

export function SidebarPlaylistItem({ playlist, href, active, isOwner }: SidebarPlaylistItemProps) {
  const queryClient = useQueryClient();
  const { notify } = useNotification();
  const { openForEdit } = useCreatePlaylistModal();
  const [location, setLocation] = useLocation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const addSongs = useAddSongsToPlaylist();

  // Drop target for drags from song lists. Smart playlists reject manual
  // membership edits, so they don't accept the drop at all.
  const acceptsSongsDrop = !playlist.isSmart;

  const handleDragOver = (e: React.DragEvent) => {
    if (!acceptsSongsDrop || !hasSongsDragData(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    setDropActive(false);
    if (!acceptsSongsDrop) return;
    const songIds = readSongsDragData(e.dataTransfer);
    if (!songIds) return;
    e.preventDefault();
    void addSongs([playlist], songIds);
  };

  const sections = usePlaylistContextMenu(
    playlist,
    () => openForEdit(playlist.id),
    () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
    {
      onShare: isOwner ? () => setShareOpen(true) : undefined,
      onDelete: isOwner ? () => setDeleteOpen(true) : undefined,
    },
  );

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api(`/playlists/${playlist.id}`, { method: 'DELETE' });
      setDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      notify(`Deleted playlist "${playlist.name}"`, 'success');
      if (location === href) {
        setLocation('/playlists');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete playlist', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ItemContextMenu sections={sections} openOnLongPress>
        <Link
          href={href}
          onDragOver={handleDragOver}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleDrop}
          aria-describedby={playlist.isSmart ? undefined : `drop-desc-${playlist.id}`}
          className={cn(
            'group relative flex items-center gap-3 rounded-item px-3 py-2 text-sm font-medium transition [@media(pointer:coarse)]:min-h-11',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            active
              ? 'bg-surface-container-high text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            dropActive && 'bg-surface-container-high text-on-surface ring-2 ring-inset ring-primary',
          )}
        >
          {!playlist.isSmart && (
            <span id={`drop-desc-${playlist.id}`} className="sr-only">
              Drop target for dragged songs
            </span>
          )}
          {active && (
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
          )}
          <Icon
            name="mdi-playlist-play"
            size={20}
            className={cn(
              'transition',
              active ? 'text-primary' : 'text-on-surface-variant group-hover:text-on-surface',
            )}
          />
          <span className="truncate">{playlist.name}</span>
        </Link>
      </ItemContextMenu>
      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete playlist"
        message={`Delete "${playlist.name}"? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        danger
        onConfirm={handleDelete}
      />
      {shareOpen && (
        <SidebarShareModal playlistId={playlist.id} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}
