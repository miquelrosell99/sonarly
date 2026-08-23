import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api.js';
import { Modal } from '../../../components/ui/Modal.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface SaveQueueAsPlaylistModalProps {
  open: boolean;
  onClose: () => void;
  // Song ids in the underlying queue order (not the shuffled display order).
  songIds: string[];
}

function defaultName(): string {
  const date = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return `Queue — ${date}`;
}

export function SaveQueueAsPlaylistModal({ open, onClose, songIds }: SaveQueueAsPlaylistModalProps) {
  const queryClient = useQueryClient();
  const { notify } = useNotification();
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(defaultName());
      setError(null);
    }
    wasOpenRef.current = open;
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      api('/playlists', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), songIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      notify('Queue saved as playlist', 'success');
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to save playlist');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || songIds.length === 0) return;
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
      title="Save queue as playlist"
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={save.isPending || !name.trim()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <div>
          <label htmlFor="save-queue-playlist-name" className="mb-1.5 block text-sm font-medium text-fg-secondary">
            Name
          </label>
          <Input
            id="save-queue-playlist-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name"
            disabled={save.isPending}
            autoFocus
          />
        </div>
        <p className="text-xs text-fg-secondary">
          {songIds.length} {songIds.length === 1 ? 'track' : 'tracks'} will be added in queue order.
        </p>
      </form>
    </Modal>
  );
}
