// Shared mutation wrapper for library writes (P5). One exported invalidation
// map decides which query-key prefixes a write refreshes, applied in
// onSettled, so every mutation path (detail pages, HomePage, SearchResults)
// stays consistent with the SSE prefix contract instead of hand-picking
// invalidations per call site:
//
//   song     → songs, search, albums, artists   (song rows appear inside
//              album/artist details and every search surface)
//   album    → albums, search
//   artist   → artists, search
//   playlist → playlists, playlist
//
// Errors surface through the notification convention (catch →
// notify(err.message, 'error')); `run` resolves to whether the write
// succeeded so callers can chain follow-up work (close modals, navigate)
// without their own try/catch and without unhandled rejections.
import { useCallback } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNotification } from '../contexts/NotificationContext.js';

export type LibraryMutationEntity = 'song' | 'album' | 'artist' | 'playlist';

export const LIBRARY_MUTATION_INVALIDATIONS: Record<LibraryMutationEntity, readonly string[]> = {
  song: ['songs', 'search', 'albums', 'artists'],
  album: ['albums', 'search'],
  artist: ['artists', 'search'],
  playlist: ['playlists', 'playlist'],
};

/** Invalidate every prefix the entity's writes can affect (the shared map). */
export async function invalidateLibraryEntity(queryClient: QueryClient, entity: LibraryMutationEntity): Promise<void> {
  await Promise.all(
    LIBRARY_MUTATION_INVALIDATIONS[entity].map((prefix) =>
      queryClient.invalidateQueries({ queryKey: [prefix] }),
    ),
  );
}

export interface LibraryMutation {
  isPending: boolean;
  /**
   * Run one library write. Invalidates the entity's prefixes on settle
   * (success or failure) and notifies on failure. Resolves true on success;
   * never rejects.
   */
  run: (task: () => Promise<unknown>) => Promise<boolean>;
}

export function useLibraryMutation(entity: LibraryMutationEntity): LibraryMutation {
  const queryClient = useQueryClient();
  const { notify } = useNotification();

  const mutation = useMutation({
    mutationFn: (task: () => Promise<unknown>) => task(),
    onSettled: () => invalidateLibraryEntity(queryClient, entity),
    onError: (err: Error) => {
      notify(err.message || 'Request failed', 'error');
    },
  });

  const run = useCallback(
    async (task: () => Promise<unknown>) => {
      try {
        await mutation.mutateAsync(task);
        return true;
      } catch {
        // onError already notified and onSettled already invalidated.
        return false;
      }
    },
    [mutation],
  );

  return { isPending: mutation.isPending, run };
}
