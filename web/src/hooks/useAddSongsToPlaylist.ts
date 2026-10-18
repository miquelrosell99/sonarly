import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useNotification } from '../contexts/NotificationContext.js';

interface PlaylistRef {
  id: string;
  name: string;
}

/**
 * The append mutation behind "Add to playlist" (picker modal) and the
 * sidebar drag-and-drop target. POSTs the union-append endpoint, invalidates
 * the playlist queries, and toasts the outcome. Duplicates are skipped
 * server-side. Returns true when every target playlist accepted the songs.
 */
export function useAddSongsToPlaylist() {
  const queryClient = useQueryClient();
  const { notify } = useNotification();

  return useCallback(
    async (playlists: PlaylistRef[], songIds: string[]): Promise<boolean> => {
      const failures: string[] = [];
      for (const playlist of playlists) {
        try {
          await api(`/playlists/${playlist.id}/songs`, {
            method: 'POST',
            body: JSON.stringify({ songIds }),
          });
          await queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] });
        } catch (err) {
          failures.push(playlist.name);
          console.error(`Add to playlist "${playlist.name}" failed`, err);
        }
      }
      if (playlists.length > 0) {
        await queryClient.invalidateQueries({ queryKey: ['playlists'] });
      }
      const trackLabel = songIds.length === 1 ? '1 track' : `${songIds.length} tracks`;
      if (failures.length === 0) {
        const targetLabel =
          playlists.length === 1 ? `"${playlists[0].name}"` : `${playlists.length} playlists`;
        notify(`Added ${trackLabel} to ${targetLabel}`, 'success');
        return true;
      }
      if (failures.length === playlists.length) {
        notify(`Could not add ${trackLabel} to: ${failures.join(', ')}`, 'error');
        return false;
      }
      notify(
        `Added ${trackLabel} to ${playlists.length - failures.length} playlist(s); failed for: ${failures.join(', ')}`,
        'info',
      );
      return false;
    },
    [queryClient, notify],
  );
}
