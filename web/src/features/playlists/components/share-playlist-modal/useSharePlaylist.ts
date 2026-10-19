import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlaylistShareEntry, PlaylistVisibility } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { useNotification } from '../../../../contexts/NotificationContext.js';
import type { PlaylistDetail } from '../../../../hooks/usePlaylist.js';
import { SHARE_TABS, type LookupUser, type ShareTab } from './types.js';

export function useSharePlaylist(open: boolean, playlist: PlaylistDetail) {
  const queryClient = useQueryClient();
  const { notify } = useNotification();

  const [activeTab, setActiveTab] = useState<ShareTab>('members');
  const [isPublic, setIsPublic] = useState(playlist.visibility === 'public');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<LookupUser | null>(null);
  const [newRole, setNewRole] = useState<'view' | 'edit'>('view');
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRemoveShare, setConfirmRemoveShare] = useState<PlaylistShareEntry | null>(null);
  const [confirmRevokeLink, setConfirmRevokeLink] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab('members');
      setIsPublic(playlist.visibility === 'public');
      setAddOpen(false);
      setSelectedUser(null);
    }
  }, [open, playlist.visibility]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  const shares = playlist.shares ?? [];
  const shareUrl = playlist.shareToken
    ? `${window.location.origin}/playlists/${playlist.id}?shareToken=${playlist.shareToken}`
    : null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };

  const handleTabListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const currentIndex = SHARE_TABS.findIndex((tab) => tab.key === activeTab);
    const nextIndex =
      e.key === 'ArrowRight'
        ? (currentIndex + 1) % SHARE_TABS.length
        : (currentIndex - 1 + SHARE_TABS.length) % SHARE_TABS.length;
    const nextTab = SHARE_TABS[nextIndex].key;
    setActiveTab(nextTab);
    document.getElementById(`share-playlist-tab-${nextTab}`)?.focus();
  };

  const handleTogglePublic = async (next: boolean) => {
    if (busy) return;
    const previous = isPublic;
    setIsPublic(next);
    setBusy(true);
    const visibility: PlaylistVisibility = next ? 'public' : shares.length > 0 ? 'shared' : 'private';
    try {
      await api(`/playlists/${playlist.id}`, {
        method: 'PUT',
        body: JSON.stringify({ visibility }),
      });
      refresh();
    } catch (err) {
      setIsPublic(previous);
      notify(err instanceof Error ? err.message : 'Failed to update visibility', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleAddShare = async () => {
    if (!selectedUser || busy) return;
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUser.id, canEdit: newRole === 'edit' }),
      });
      notify(`Shared with ${selectedUser.username}`, 'success');
      setSelectedUser(null);
      setNewRole('view');
      setAddOpen(false);
      setResetKey((n) => n + 1);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to share playlist', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (share: PlaylistShareEntry, canEdit: boolean) => {
    if (busy || canEdit === share.canEdit) return;
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ userId: share.userId, canEdit }),
      });
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update permission', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveShare = async (share: PlaylistShareEntry) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}/share/${share.userId}`, { method: 'DELETE' });
      notify(`Removed ${share.username}`, 'success');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove share', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('Failed to copy link', 'error');
    }
  };

  const handleGenerateLink = async () => {
    if (busy) return;
    setBusy(true);
    const hadLink = Boolean(playlist.shareToken);
    try {
      await api(`/playlists/${playlist.id}/share-link`, { method: 'POST' });
      notify(hadLink ? 'Share link regenerated' : 'Share link created', 'success');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to create share link', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeLink = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}/share-link`, { method: 'DELETE' });
      notify('Share link revoked', 'success');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to revoke share link', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Allow download: PATCHes the link's permission without rotating the
  // token; the checkbox reflects the detail DTO's shareDownload flag, so a
  // failed PATCH simply never changes the checked state (no local revert).
  const handleToggleDownload = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}/share-link`, {
        method: 'PATCH',
        body: JSON.stringify({ allowDownload: next }),
      });
      notify(next ? 'Downloads enabled for this link' : 'Downloads disabled for this link', 'success');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update download permission', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelAdd = () => {
    setAddOpen(false);
    setSelectedUser(null);
    setResetKey((n) => n + 1);
  };

  return {
    activeTab,
    setActiveTab,
    isPublic,
    addOpen,
    setAddOpen,
    selectedUser,
    setSelectedUser,
    newRole,
    setNewRole,
    resetKey,
    busy,
    copied,
    shares,
    shareUrl,
    confirmRemoveShare,
    setConfirmRemoveShare,
    confirmRevokeLink,
    setConfirmRevokeLink,
    handleTabListKeyDown,
    handleTogglePublic,
    handleAddShare,
    handleRoleChange,
    handleRemoveShare,
    handleCopy,
    handleGenerateLink,
    handleRevokeLink,
    handleToggleDownload,
    cancelAdd,
  };
}
