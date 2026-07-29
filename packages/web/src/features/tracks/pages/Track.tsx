import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Icon } from '../../../components/ui/Icon.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { EntityDetail } from '../../../components/EntityDetail.js';
import { FavoriteRatingGroup } from '../../../components/FavoriteRatingGroup.js';
import { formatDuration } from '../../../lib/format.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { SyncedLyricsEditor } from '../../songs/index.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import type { SongWithNames } from '../../../lib/types.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { patchToPlayerSong } from '../../../lib/songPatch.js';

type TrackDetail = SongWithNames;

export function Track() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [track, setTrack] = useState<TrackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [syncEditing, setSyncEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { playSong } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { notify } = useNotification();
  const updateCurrentSong = usePlayer((state) => state.updateCurrentSong);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const load = () => {
    if (!id) return;
    setLoading(true);
    api<{ song: TrackDetail }>(`/songs/${id}${buildLibraryQuery(selectedLibraryId)}`)
      .then((res) => setTrack(res.song))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load track'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id, selectedLibraryId]);

  const handleFavorite = async (starred: boolean) => {
    if (!track) return;
    try {
      await setFavorite('song', track.id, starred);
      setTrack((prev) => (prev ? { ...prev, starred } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating?: number) => {
    if (!track) return;
    try {
      await setRating('song', track.id, rating);
      setTrack((prev) => (prev ? { ...prev, rating } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    if (!track) return;
    setSaving(true);
    try {
      await api(`/songs/${track.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      if (track.id === usePlayer.getState().currentSong?.id) {
        updateCurrentSong(patchToPlayerSong(patched));
      }
      setEditing(false);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save song', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!track) return;
    setDeleting(true);
    try {
      await api(`/songs/${track.id}`, { method: 'DELETE' });
      navigate('/songs');
    } catch (err) {
      setDeleting(false);
      notify(err instanceof Error ? err.message : 'Failed to delete song', 'error');
    }
  };

  const metadata = track
    ? [
        { label: track.artistName ?? 'Unknown artist', href: track.artistId ? `/artists/${track.artistId}` : undefined },
        { label: track.albumName ?? 'Unknown album', href: track.albumId ? `/albums/${track.albumId}` : undefined },
        { label: track.year !== undefined && track.year !== null ? String(track.year) : '', href: track.year !== undefined ? `/years/${track.year}` : undefined },
        { label: track.genre ?? '', href: track.genre ? `/genres/${encodeURIComponent(track.genre)}` : undefined },
        { label: track.duration !== undefined ? formatDuration(track.duration) : '' },
      ]
    : [];

  const editEntity = track
    ? {
        ...track,
        artist: track.artistName,
        album: track.albumName,
        albumArtist: track.albumArtistName,
      }
    : null;

  return (
    <>
      <EntityDetail
        isLoading={loading}
        error={error}
        notFound={!track}
        notFoundMessage="Track not found."
        documentTitle={track?.title}
        type="Song"
        title={track?.title}
        cover={track ? <CoverArt coverArt={track.albumCoverArt ?? track.coverArt} alt={`Cover art for ${track.title}`} className="h-48 w-48 sm:h-56 sm:w-56" iconSize={64} /> : undefined}
        metadata={metadata}
        actions={
          track && (
            <>
              <Button onClick={() => playSong(track)} className="gap-2">
                <Icon name="mdi-play" size={18} />
                Play
              </Button>
              <Button variant="ghost" onClick={() => setEditing(true)} className="gap-2">
                <Icon name="mdi-pencil" size={18} />
                Edit
              </Button>
              <FavoriteRatingGroup
                starred={track.starred}
                onToggleFavorite={() => handleFavorite(!track.starred)}
                rating={track.rating}
                onRate={handleRate}
              />
            </>
          )
        }
      />
      {editEntity && (
        <EditEntityModal
          open={editing}
          entityType="song"
          entity={editEntity}
          onClose={() => setEditing(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditSyncedLyrics={() => setSyncEditing(true)}
          saving={saving}
          deleting={deleting}
        />
      )}
      {track && syncEditing && (
        <SyncedLyricsEditor
          songId={track.id}
          title={track.title}
          artistName={track.artistName}
          duration={track.duration}
          onClose={() => setSyncEditing(false)}
          onSaved={() => {
            setSyncEditing(false);
            load();
          }}
        />
      )}
    </>
  );
}
