import { PageState } from '../../shell/PageState.js';
import { EditEntityModal } from '../../edit-entity/EditEntityModal.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import { invalidateLibraryEntity } from '../../../hooks/useLibraryMutation.js';
import { songFromSearchSong, playlistFromSearchPlaylist } from '../../../lib/entityMappers.js';
import type { User } from '../../../types';
import { useSearchPage } from './search-results/useSearchPage.js';
import { SongsSection } from './search-results/SongsSection.js';
import { AlbumsSection } from './search-results/AlbumsSection.js';
import { ArtistsSection } from './search-results/ArtistsSection.js';
import { PlaylistsSection } from './search-results/PlaylistsSection.js';

export function SearchResults({ user }: { user: User }) {
  const page = useSearchPage(user);
  const { query, type, data, isLoading, error, refetch } = page;

  const songEditEntities = page.songEditing?.map((song) => ({
    ...song,
    artist: song.artistName,
    album: song.albumName,
  }));

  if (!query.trim()) {
    return (
      <PageState isEmpty emptyMessage="Type to search" emptyIcon="mdi-magnify">
        {null}
      </PageState>
    );
  }

  if (error) {
    return (
      <PageState error={error.message} onRetry={() => void refetch()}>
        {null}
      </PageState>
    );
  }

  if (!data || isLoading) {
    return <PageState loading>{null}</PageState>;
  }

  // Search hits are display subsets; songs/playlists widen to full entities
  // through the shared mappers before they reach the player/editors (F17).
  const result = (() => {
    switch (type) {
      case 'songs':
        return <SongsSection page={page} songs={data.songs.map(songFromSearchSong)} />;
      case 'albums':
        return <AlbumsSection page={page} albums={data.albums} />;
      case 'artists':
        return <ArtistsSection page={page} artists={data.artists} />;
      case 'playlists':
        return <PlaylistsSection page={page} playlists={data.playlists.map(playlistFromSearchPlaylist)} />;
      default:
        return <SongsSection page={page} songs={data.songs.map(songFromSearchSong)} />;
    }
  })();

  return (
    <>
      {result}
      {songEditEntities && songEditEntities.length > 0 && (
        <EditEntityModal
          open
          entityType="song"
          entities={songEditEntities}
          entity={songEditEntities.length === 1 ? songEditEntities[0] : undefined}
          onClose={() => page.setSongEditing(null)}
          onSave={page.handleSongSave}
          onSaveMany={page.handleSongSaveMany}
          onDelete={songEditEntities.length === 1 ? page.handleSongDelete : undefined}
          onEditSyncedLyrics={
            songEditEntities.length === 1 && page.songEditing
              ? () => page.songEditing && page.setSyncEditing(page.songEditing[0])
              : undefined
          }
          saving={page.songMutationPending}
          deleting={page.songMutationPending}
        />
      )}
      {page.syncEditing && (
        <SyncedLyricsEditor
          songId={page.syncEditing.id}
          title={page.syncEditing.title}
          artistName={page.syncEditing.artistName}
          duration={page.syncEditing.duration}
          onClose={() => page.setSyncEditing(null)}
          onSaved={() => {
            page.setSyncEditing(null);
            void invalidateLibraryEntity(page.queryClient, 'song');
          }}
        />
      )}
    </>
  );
}
