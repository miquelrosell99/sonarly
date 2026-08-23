import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlaylistShareEntry, PlaylistVisibility, User } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { cn } from '../../../lib/cn.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { Avatar } from '../../../components/Avatar.js';
import { PageState } from '../../../components/PageState.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import type { PlaylistDetail } from '../../../hooks/usePlaylist.js';

interface LookupUser {
  id: string;
  username: string;
}

type ShareTab = 'members' | 'links';

const SHARE_TABS: { key: ShareTab; label: string; icon: string }[] = [
  { key: 'members', label: 'Members', icon: 'mdi-account-multiple-outline' },
  { key: 'links', label: 'Share links', icon: 'mdi-link-variant' },
];

function TabButton({
  active,
  onClick,
  label,
  icon,
  id,
  ariaControls,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
  id: string;
  ariaControls: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      onClick={onClick}
      aria-selected={active}
      aria-controls={ariaControls}
      tabIndex={active ? 0 : -1}
      className={cn(
        'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active
          ? 'bg-accent text-bg-primary shadow-sm'
          : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
      )}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

function UserShareSearch({
  excludeIds,
  resetKey,
  onSelect,
}: {
  excludeIds: Set<string>;
  resetKey: number;
  onSelect: (user: LookupUser | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreBlurRef = useRef(false);
  const listboxId = useId();

  useEffect(() => {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(null);
  }, [resetKey, onSelect]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const fetchUsers = useCallback(
    async (input: string) => {
      setLoading(true);
      try {
        const res = await api<{ users: LookupUser[] }>(`/users/lookup?q=${encodeURIComponent(input)}`);
        setResults(res.users.filter((u) => !excludeIds.has(u.id)));
        setHighlighted(0);
        setOpen(true);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [excludeIds],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSelect(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(value), 200);
  };

  const selectUser = (user: LookupUser) => {
    setQuery(user.username);
    setOpen(false);
    setResults([]);
    onSelect(user);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) setHighlighted((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) setHighlighted((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlighted]) selectUser(results[highlighted]);
    } else if (e.key === 'Escape') {
      // Keep the containing modal open; only dismiss the suggestion list.
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="relative flex-1">
      <Input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && results.length > 0 ? `${listboxId}-option-${highlighted}` : undefined}
        aria-label="Search users"
        placeholder="Search users…"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(results.length > 0)}
        onBlur={() => {
          if (ignoreBlurRef.current) return;
          setTimeout(() => setOpen(false), 150);
        }}
        className="w-full"
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching users"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-rule bg-surface shadow-lg"
          onMouseDown={() => {
            ignoreBlurRef.current = true;
          }}
          onMouseUp={() => {
            ignoreBlurRef.current = false;
          }}
        >
          {results.length === 0 && !loading && (
            <li className="px-3 py-2 text-sm text-fg-secondary">No matches</li>
          )}
          {results.map((user, i) => (
            <li
              key={user.id}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === highlighted}
              onClick={() => selectUser(user)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm hover:bg-surface-hover',
                i === highlighted && 'bg-surface-hover',
              )}
            >
              {user.username}
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">
          <Icon name="mdi-loading" size={16} className="animate-spin motion-reduce:animate-none" />
        </span>
      )}
    </div>
  );
}

export function SharePlaylistModal({
  open,
  onClose,
  playlist,
}: {
  open: boolean;
  onClose: () => void;
  playlist: PlaylistDetail;
}) {
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

  return (
    <Modal open={open} onClose={onClose} title={`Share "${playlist.name}"`} className="max-w-xl">
      <div
        role="tablist"
        aria-label="Playlist sharing"
        onKeyDown={handleTabListKeyDown}
        className="mb-5 flex items-center gap-1 rounded-full border border-rule/50 bg-bg-primary/60 p-1"
      >
        {SHARE_TABS.map((tab) => (
          <TabButton
            key={tab.key}
            id={`share-playlist-tab-${tab.key}`}
            active={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            label={tab.label}
            icon={tab.icon}
            ariaControls={`share-playlist-panel-${tab.key}`}
          />
        ))}
      </div>

      <div
        id={`share-playlist-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`share-playlist-tab-${activeTab}`}
      >
        {activeTab === 'members' ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-rule bg-surface px-3 py-1">
              <Checkbox
                id="share-playlist-public"
                label="Public"
                description="Anyone with an account can view this playlist."
                checked={isPublic}
                disabled={busy}
                onChange={(e) => handleTogglePublic(e.target.checked)}
              />
            </div>

            <PageState
              isEmpty={shares.length === 0}
              emptyMessage="Not shared with anyone yet."
              emptyIcon="mdi-account-multiple-outline"
            >
              <ul className="space-y-2">
                {shares.map((share) => {
                  const avatarUser: User = {
                    id: share.userId,
                    username: share.username,
                    isAdmin: false,
                    createdAt: '',
                  };
                  return (
                    <li
                      key={share.userId}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-surface px-3 py-2"
                    >
                      <Avatar user={avatarUser} variant="surface" className="h-8 w-8" />
                      <span className="min-w-0 flex-1 truncate text-sm">{share.username}</span>
                      <select
                        aria-label={`Role for ${share.username}`}
                        value={share.canEdit ? 'edit' : 'view'}
                        disabled={busy}
                        onChange={(e) => handleRoleChange(share, e.target.value === 'edit')}
                        className="input min-h-[44px] w-auto text-sm"
                      >
                        <option value="view">Can view</option>
                        <option value="edit">Can edit</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveShare(share)}
                        disabled={busy}
                        aria-label={`Remove ${share.username}`}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-fg-secondary transition hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Icon name="mdi-close" size={18} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PageState>

            {addOpen ? (
              <div className="space-y-2 rounded-lg border border-rule bg-surface p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <UserShareSearch
                    excludeIds={new Set(shares.map((s) => s.userId))}
                    resetKey={resetKey}
                    onSelect={setSelectedUser}
                  />
                  <select
                    aria-label="Role for new member"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as 'view' | 'edit')}
                    className="input min-h-[44px] w-auto text-sm"
                  >
                    <option value="view">Can view</option>
                    <option value="edit">Can edit</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setAddOpen(false);
                      setSelectedUser(null);
                      setResetKey((n) => n + 1);
                    }}
                    disabled={busy}
                    className="min-h-[44px]"
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleAddShare} disabled={!selectedUser || busy} className="min-h-[44px]">
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setAddOpen(true)} className="min-h-[44px] w-full">
                <Icon name="mdi-account-plus-outline" size={18} className="mr-1.5" />
                Add user
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              Anyone with the link can view this playlist, even without an account.
            </p>
            {shareUrl ? (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    aria-label="Share link"
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button variant="ghost" onClick={handleCopy} className="min-h-[44px] shrink-0">
                    <Icon name={copied ? 'mdi-check' : 'mdi-content-copy'} size={16} className="mr-1.5" />
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={handleGenerateLink} disabled={busy} className="min-h-[44px]">
                    <Icon name="mdi-refresh" size={16} className="mr-1.5" />
                    Regenerate
                  </Button>
                  <Button variant="danger" onClick={handleRevokeLink} disabled={busy} className="min-h-[44px]">
                    <Icon name="mdi-link-variant-off" size={16} className="mr-1.5" />
                    Revoke
                  </Button>
                </div>
              </>
            ) : (
              <>
                <PageState isEmpty emptyMessage="No share link yet." emptyIcon="mdi-link-variant-off">
                  {null}
                </PageState>
                <Button onClick={handleGenerateLink} disabled={busy} className="min-h-[44px] w-full">
                  <Icon name="mdi-link-variant" size={16} className="mr-1.5" />
                  Generate link
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
