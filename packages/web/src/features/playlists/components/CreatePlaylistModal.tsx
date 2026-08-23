import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlaylistVisibility, SmartPlaylistRules } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';

import { SmartPlaylistBlockEditor } from './SmartPlaylistBlockEditor.js';
import { usePlaylist } from '../../../hooks/usePlaylist.js';

const VISIBILITIES: PlaylistVisibility[] = ['private', 'shared', 'public', 'link'];

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
  const [visibility, setVisibility] = useState<PlaylistVisibility>('private');
  const [isSmart, setIsSmart] = useState(false);
  const [rules, setRules] = useState<SmartPlaylistRules>(DEFAULT_RULES);
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(open);
  const wasEditingRef = useRef(isEditing);

  useEffect(() => {
    if (open && (!wasOpenRef.current || wasEditingRef.current !== isEditing)) {
      if (isEditing && playlist) {
        setName(playlist.name);
        setDescription(playlist.description ?? '');
        setVisibility(playlist.visibility);
        setIsSmart(playlist.isSmart ?? false);
        setRules(playlist.rules ?? DEFAULT_RULES);
      } else if (!isEditing) {
        setName('');
        setDescription('');
        setVisibility('private');
        setIsSmart(false);
        setRules(DEFAULT_RULES);
      }
      setError(null);
    }
    wasOpenRef.current = open;
    wasEditingRef.current = isEditing;
  }, [open, isEditing, playlist]);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        visibility,
      };
      if (isSmart) {
        body.isSmart = true;
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
      setVisibility('private');
      setIsSmart(false);
      setRules(DEFAULT_RULES);
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
            <label htmlFor="create-playlist-visibility" className="mb-1.5 block text-sm font-medium text-fg-secondary">
              Visibility
            </label>
            <select
              id="create-playlist-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PlaylistVisibility)}
              disabled={save.isPending || loadingPlaylist}
              className="input w-full"
            >
              {VISIBILITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <Checkbox
            id="create-playlist-smart"
            label="Smart playlist"
            description="Automatically populate this playlist based on rules"
            checked={isSmart}
            onChange={(e) => setIsSmart(e.target.checked)}
            disabled={save.isPending || loadingPlaylist || isEditing}
          />
          {isSmart && <SmartPlaylistBlockEditor initialRules={rules} onChange={setRules} />}
        </form>
      )}
    </Modal>
  );
}
