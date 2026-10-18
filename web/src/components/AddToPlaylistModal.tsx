import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/Modal.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { Input } from './ui/Input.js';
import { usePlaylists } from '../hooks/usePlaylists.js';
import { useAddSongsToPlaylist } from '../hooks/useAddSongsToPlaylist.js';
import { useAddToPlaylistStore } from '../stores/addToPlaylistStore.js';

/**
 * The global "Add to playlist" picker: one modal, opened from any context
 * menu via the addToPlaylist store. Multi-select — the picked playlists each
 * get the union-append POST. Smart playlists are excluded (the server
 * rejects manual membership edits for them).
 */
export function AddToPlaylistModal() {
  const target = useAddToPlaylistStore((s) => s.target);
  const close = useAddToPlaylistStore((s) => s.close);
  const addSongs = useAddSongsToPlaylist();
  const { data: playlists, isLoading, isError } = usePlaylists({ enabled: target !== null });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fresh pick per open; the previous selection must not leak into the
  // next "Add to playlist".
  useEffect(() => {
    if (target) {
      setSelected(new Set());
      setFilter('');
    }
  }, [target]);

  const staticPlaylists = useMemo(
    () => (playlists ?? []).filter((playlist) => !playlist.isSmart),
    [playlists],
  );
  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return staticPlaylists;
    return staticPlaylists.filter((playlist) => playlist.name.toLowerCase().includes(query));
  }, [staticPlaylists, filter]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    if (!target || selected.size === 0) return;
    const chosen = staticPlaylists.filter((playlist) => selected.has(playlist.id));
    setSubmitting(true);
    try {
      const ok = await addSongs(chosen, target.songs.map((song) => song.id));
      if (ok) close();
    } finally {
      setSubmitting(false);
    }
  };

  const addLabel =
    selected.size === 0
      ? 'Add to playlist'
      : selected.size === 1
        ? 'Add to 1 playlist'
        : `Add to ${selected.size} playlists`;

  return (
    <Modal open={target !== null} onClose={close} title="Add to playlist" className="max-w-md">
      {target && (
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Adding <span className="font-medium text-fg-primary">{target.label}</span> to:
          </p>

          {staticPlaylists.length > 5 && (
            <Input
              type="search"
              aria-label="Filter playlists"
              placeholder="Filter playlists…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}

          {isLoading ? (
            <p className="py-6 text-center text-sm text-fg-secondary">Loading playlists…</p>
          ) : isError ? (
            <p className="py-6 text-center text-sm text-danger" role="alert">
              Could not load playlists.
            </p>
          ) : staticPlaylists.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-secondary">
              No playlists yet — create one from the Playlists page.
            </p>
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-secondary">No playlists match "{filter.trim()}".</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {visible.map((playlist) => (
                <Checkbox
                  key={playlist.id}
                  id={`add-to-playlist-${playlist.id}`}
                  label={playlist.name}
                  description={
                    playlist.songCount > 0
                      ? `${playlist.songCount} track${playlist.songCount === 1 ? '' : 's'}`
                      : undefined
                  }
                  checked={selected.has(playlist.id)}
                  onChange={() => toggle(playlist.id)}
                  disabled={submitting}
                />
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void handleAdd()} disabled={selected.size === 0} loading={submitting}>
              {addLabel}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
