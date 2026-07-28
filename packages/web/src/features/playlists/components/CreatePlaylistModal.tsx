import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlaylistVisibility, SmartPlaylistRules } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { SmartPlaylistBlockEditor } from './SmartPlaylistBlockEditor.js';

const VISIBILITIES: PlaylistVisibility[] = ['private', 'shared', 'public', 'link'];

interface CreatePlaylistModalProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_RULES: SmartPlaylistRules = {
  rules: { all: [{ field: 'title', operator: 'contains', value: '' }] },
  sort: [{ field: 'title', direction: 'asc' }],
};

export function CreatePlaylistModal({ open, onClose }: CreatePlaylistModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<PlaylistVisibility>('private');
  const [isSmart, setIsSmart] = useState(false);
  const [rules, setRules] = useState<SmartPlaylistRules>(DEFAULT_RULES);
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName('');
      setVisibility('private');
      setIsSmart(false);
      setRules(DEFAULT_RULES);
      setError(null);
    }
    wasOpenRef.current = open;
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        visibility,
      };
      if (isSmart) {
        body.isSmart = true;
        body.rules = rules;
      }
      return api('/playlists', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setName('');
      setVisibility('private');
      setIsSmart(false);
      setRules(DEFAULT_RULES);
      setError(null);
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to create playlist');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate();
  };

  const handleClose = () => {
    if (create.isPending) return;
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create playlist"
      className="max-w-4xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      }
    >
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
            disabled={create.isPending}
            autoFocus
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
            disabled={create.isPending}
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
          disabled={create.isPending}
        />
        {isSmart && <SmartPlaylistBlockEditor initialRules={rules} onChange={setRules} />}
      </form>
    </Modal>
  );
}
