import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlaylistShareEntry, PlaylistVisibility, User } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { cn } from '../../../lib/cn.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Avatar } from '../../../components/Avatar.js';
import { PageState } from '../../../components/PageState.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import type { PlaylistDetail } from '../../../hooks/usePlaylist.js';

interface LookupUser {
  id: string;
  username: string;
}

const VISIBILITY_OPTIONS: {
  value: PlaylistVisibility;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only you can see this playlist',
    icon: 'mdi-lock-outline',
  },
  {
    value: 'shared',
    label: 'Shared',
    description: 'Specific users you invite',
    icon: 'mdi-account-multiple-outline',
  },
  {
    value: 'public',
    label: 'Public',
    description: 'Any signed-in user can view',
    icon: 'mdi-earth',
  },
  {
    value: 'link',
    label: 'Link',
    description: 'Anyone with the link can view',
    icon: 'mdi-link-variant',
  },
];

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

  const [visibility, setVisibility] = useState<PlaylistVisibility>(playlist.visibility);
  const [selectedUser, setSelectedUser] = useState<LookupUser | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) setVisibility(playlist.visibility);
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

  const handleVisibilityChange = async (next: PlaylistVisibility) => {
    if (next === visibility || busy) return;
    const previous = visibility;
    setVisibility(next);
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}`, {
        method: 'PUT',
        body: JSON.stringify({ visibility: next }),
      });
      refresh();
    } catch (err) {
      setVisibility(previous);
      notify(err instanceof Error ? err.message : 'Failed to update visibility', 'error');
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

  const handleAddShare = async () => {
    if (!selectedUser || busy) return;
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUser.id, canEdit }),
      });
      notify(`Shared with ${selectedUser.username}`, 'success');
      setSelectedUser(null);
      setCanEdit(false);
      setResetKey((n) => n + 1);
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to share playlist', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRole = async (share: PlaylistShareEntry) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/playlists/${playlist.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ userId: share.userId, canEdit: !share.canEdit }),
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

  return (
    <Modal open={open} onClose={onClose} title={`Share "${playlist.name}"`} className="max-w-xl">
      <div className="space-y-6">
        <section>
          <h4 className="mb-3 text-sm font-medium text-fg-secondary">Visibility</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {VISIBILITY_OPTIONS.map((option) => {
              const selected = visibility === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleVisibilityChange(option.value)}
                  aria-pressed={selected}
                  disabled={busy}
                  className={`flex items-center gap-3 rounded-md border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    selected
                      ? 'border-accent bg-surface-hover text-accent'
                      : 'border-rule bg-surface text-fg-secondary hover:bg-surface-hover hover:text-fg-primary'
                  }`}
                >
                  <Icon name={option.icon} size={24} />
                  <div>
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs opacity-80">{option.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {visibility === 'link' && (
          <section>
            <h4 className="mb-3 text-sm font-medium text-fg-secondary">Share link</h4>
            {shareUrl ? (
              <>
                <p className="mb-2 text-xs text-muted">Anyone with this link can view this playlist.</p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    aria-label="Share link"
                    onFocus={(e) => e.target.select()}
                    className="flex-1 font-mono text-xs"
                  />
                  <Button variant="ghost" onClick={handleCopy} className="min-h-[44px] shrink-0">
                    <Icon name={copied ? 'mdi-check' : 'mdi-content-copy'} size={16} className="mr-1.5" />
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </>
            ) : (
              <PageState isEmpty emptyMessage="Preparing share link…" emptyIcon="mdi-link-variant">{null}</PageState>
            )}
          </section>
        )}

        {visibility === 'shared' && (
          <section>
            <h4 className="mb-3 text-sm font-medium text-fg-secondary">People</h4>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <UserShareSearch
                excludeIds={new Set(shares.map((s) => s.userId))}
                resetKey={resetKey}
                onSelect={setSelectedUser}
              />
              <div className="inline-flex rounded-lg border border-rule bg-surface" role="group" aria-label="Permission">
                {([
                  { value: false, label: 'Can view' },
                  { value: true, label: 'Can edit' },
                ] as const).map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={canEdit === option.value}
                    onClick={() => setCanEdit(option.value)}
                    className={`min-h-[44px] px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      canEdit === option.value
                        ? 'bg-surface-hover font-medium text-accent'
                        : 'text-fg-secondary hover:text-fg-primary'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Button onClick={handleAddShare} disabled={!selectedUser || busy} className="min-h-[44px]">
                Add
              </Button>
            </div>

            <div className="mt-4">
              <PageState isEmpty={shares.length === 0} emptyMessage="Not shared with anyone yet." emptyIcon="mdi-account-multiple-outline">
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
                        className="flex items-center gap-3 rounded-lg border border-rule bg-surface px-3 py-2"
                      >
                        <Avatar user={avatarUser} variant="surface" className="h-8 w-8" />
                        <span className="flex-1 truncate text-sm">{share.username}</span>
                        <button
                          type="button"
                          onClick={() => handleToggleRole(share)}
                          disabled={busy}
                          aria-label={`Change permission for ${share.username}`}
                          className="min-h-[44px] rounded-lg px-2 text-sm text-fg-secondary transition hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {share.canEdit ? 'Can edit' : 'Can view'}
                        </button>
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
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
