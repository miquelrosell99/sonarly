import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SmartPlaylistRules } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Modal } from '../../../components/ui/Modal.js';
import { ConfirmModal } from '../../../components/ui/ConfirmModal.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { cn } from '../../../lib/cn.js';

import { SmartPlaylistBlockEditor } from './SmartPlaylistBlockEditor.js';
import { usePlaylist } from '../../../hooks/usePlaylist.js';

interface CreatePlaylistModalProps {
  open: boolean;
  onClose: () => void;
  editingPlaylistId?: string | null;
}

const DEFAULT_RULES: SmartPlaylistRules = {
  rules: { all: [{ field: 'title', operator: 'contains', value: '' }] },
  sort: [{ field: 'title', direction: 'asc' }],
};

export function CreatePlaylistModal({ open, onClose, editingPlaylistId }: CreatePlaylistModalProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editingPlaylistId;
  const { data: playlist, isLoading: loadingPlaylist, error: playlistError } = usePlaylist(editingPlaylistId ?? undefined);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSmart, setIsSmart] = useState(false);
  const [rules, setRules] = useState<SmartPlaylistRules>(DEFAULT_RULES);
  const [pendingMode, setPendingMode] = useState<'standard' | 'smart' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(open);
  const wasEditingRef = useRef(isEditing);

  useEffect(() => {
    if (open && (!wasOpenRef.current || wasEditingRef.current !== isEditing)) {
      if (isEditing && playlist) {
        setName(playlist.name);
        setDescription(playlist.description ?? '');
        setIsSmart(playlist.isSmart ?? false);
        setRules(playlist.rules ?? DEFAULT_RULES);
      } else if (!isEditing) {
        setName('');
        setDescription('');
        setIsSmart(false);
        setRules(DEFAULT_RULES);
      }
      setError(null);
      setPendingMode(null);
    }
    wasOpenRef.current = open;
    wasEditingRef.current = isEditing;
  }, [open, isEditing, playlist]);

  const requestModeSwitch = (target: 'standard' | 'smart') => {
    if (target === 'smart' ? isSmart : !isSmart) return;
    setPendingMode(target);
  };

  const confirmModeSwitch = () => {
    if (pendingMode === 'smart') {
      setIsSmart(true);
    } else if (pendingMode === 'standard') {
      setIsSmart(false);
      setRules(DEFAULT_RULES);
    }
    setPendingMode(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        isSmart,
      };
      if (isSmart) {
        body.rules = rules;
      }

      if (isEditing) {
        return api(`/playlists/${editingPlaylistId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      }

      return api('/playlists', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      if (isEditing && editingPlaylistId) {
        queryClient.invalidateQueries({ queryKey: ['playlist', editingPlaylistId] });
      }
      setName('');
      setDescription('');
      setIsSmart(false);
      setRules(DEFAULT_RULES);
      setPendingMode(null);
      setError(null);
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : `Failed to ${isEditing ? 'update' : 'create'} playlist`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate();
  };

  const handleClose = () => {
    if (save.isPending) return;
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEditing ? 'Edit playlist' : 'Create playlist'}
      className="max-w-4xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={save.isPending || loadingPlaylist}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={save.isPending || loadingPlaylist || !name.trim()}>
            {save.isPending ? 'Saving…' : isEditing ? 'Save' : 'Create'}
          </Button>
        </div>
      }
    >
      {isEditing && loadingPlaylist && (
        <p className="text-sm text-muted">Loading playlist…</p>
      )}
      {isEditing && playlistError && (
        <p className="text-sm text-danger">{playlistError instanceof Error ? playlistError.message : 'Failed to load playlist'}</p>
      )}
      {(!isEditing || playlist) && (
        <form id="create-playlist-form" onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-danger">{error}</p>}
          <div>
            <label htmlFor="create-playlist-name" className="mb-1.5 block text-sm font-medium text-fg-secondary">
              Name
            </label>
            <Input
              id="create-playlist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Playlist name"
              disabled={save.isPending || loadingPlaylist}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="create-playlist-description" className="mb-1.5 block text-sm font-medium text-fg-secondary">
              Description
            </label>
            <textarea
              id="create-playlist-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              disabled={save.isPending || loadingPlaylist}
              className="input min-h-[5rem] w-full py-2"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-fg-secondary">Playlist type</span>
            <div role="group" aria-label="Playlist type" className="inline-flex rounded-full border border-rule bg-surface p-1">
              {(['standard', 'smart'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={isSmart === (mode === 'smart')}
                  onClick={() => requestModeSwitch(mode)}
                  disabled={save.isPending || loadingPlaylist}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isSmart === (mode === 'smart')
                      ? 'bg-accent text-bg-primary'
                      : 'text-fg-secondary hover:text-fg-primary',
                  )}
                >
                  {mode === 'smart' ? 'Smart' : 'Standard'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-fg-secondary">
              {isSmart
                ? 'Automatically populated based on rules.'
                : 'You choose which tracks belong to this playlist.'}
            </p>
          </div>
          {isSmart && <SmartPlaylistBlockEditor initialRules={rules} onChange={setRules} />}
        </form>
      )}
      <ConfirmModal
        open={pendingMode !== null}
        onClose={() => setPendingMode(null)}
        title={pendingMode === 'smart' ? 'Convert to smart playlist?' : 'Convert to standard playlist?'}
        message={
          pendingMode === 'smart'
            ? 'All current members will be removed and the playlist will be populated automatically from the rules you define.'
            : 'The current tracks will be kept as members and the smart rules will be cleared.'
        }
        confirmLabel={pendingMode === 'smart' ? 'Convert to smart' : 'Convert to standard'}
        danger={pendingMode === 'smart'}
        onConfirm={confirmModeSwitch}
      />
    </Modal>
  );
}
