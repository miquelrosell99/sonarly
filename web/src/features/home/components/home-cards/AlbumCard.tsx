import { useRef, useState } from 'react';
import { Link } from 'wouter';
import type { Album, User } from '../../../../types';
import { api } from '../../../../lib/api.js';
import { usePlayActions } from '../../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../../hooks/useFavoriteActions.js';
import { useLibraryMutation } from '../../../../hooks/useLibraryMutation.js';
import { useLibraryStore, buildLibraryQuery } from '../../../../stores/libraryStore.js';
import { usePlayer } from '../../../../stores/playerStore.js';
import { Card } from '../../../entities/Card.js';
import { CoverArt } from '../../../entities/CoverArt.js';
import { ItemContextMenu } from '../../../entities/ItemContextMenu.js';
import { EditEntityModal } from '../../../../components/EditEntityModal.js';
import { useAlbumContextMenu } from '../../../../hooks/useAlbumContextMenu.js';
import type { AlbumDetail } from './types.js';

export function AlbumCard({ album: initialAlbum, user }: { album: Album; user: User }) {
  const { playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const albumMutation = useLibraryMutation('album');
  const currentAlbumId = usePlayer((state) => state.currentSong?.albumId);
  const [album, setAlbum] = useState(initialAlbum);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [coverArtBusy, setCoverArtBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const baseSections = useAlbumContextMenu(album);
  const contextMenuSections = user.isAdmin
    ? [...baseSections, { items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: () => setEditing(true) }] }]
    : baseSections;

  const handlePlay = async () => {
    setError(null);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      playSongs(detail.songs, undefined, undefined, { type: 'album', id: album.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play album');
    }
  };

  const handleShufflePlay = async () => {
    setError(null);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      shufflePlay(detail.songs, { type: 'album', id: album.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to shuffle play album');
    }
  };

  const handleFavorite = async (starred: boolean) => {
    if (await albumMutation.run(() => setFavorite('album', album.id, starred))) {
      setAlbum((prev) => ({ ...prev, starred }));
    }
  };

  const handleRate = async (rating: number) => {
    if (await albumMutation.run(() => setRating('album', album.id, rating || undefined))) {
      setAlbum((prev) => ({ ...prev, rating: rating || undefined }));
    }
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    if (
      await albumMutation.run(() =>
        api(`/albums/${album.id}/tags`, {
          method: 'PUT',
          body: JSON.stringify(patched),
        }),
      )
    ) {
      setEditing(false);
      setAlbum((prev) => ({
        ...prev,
        name: typeof patched.title === 'string' ? patched.title : prev.name,
        artistName: typeof patched.albumArtist === 'string' ? patched.albumArtist : prev.artistName,
        year: typeof patched.year === 'number' ? patched.year : prev.year,
      }));
    }
  };

  const handleDelete = async () => {
    if (await albumMutation.run(() => api(`/albums/${album.id}`, { method: 'DELETE' }))) {
      setEditing(false);
    }
  };

  const handleEditCoverArt = () => {
    coverInputRef.current?.click();
  };

  const handleCoverArtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverArtBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (
        await albumMutation.run(() =>
          api(`/albums/${album.id}/cover-art`, {
            method: 'POST',
            body: formData,
          }),
        )
      ) {
        setAlbum((prev) => ({ ...prev, coverArt: `${Date.now()}` }));
      }
    } finally {
      setCoverArtBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleDeleteCoverArt = async () => {
    setCoverArtBusy(true);
    try {
      if (await albumMutation.run(() => api(`/albums/${album.id}/cover-art`, { method: 'DELETE' }))) {
        setAlbum((prev) => ({ ...prev, coverArt: undefined }));
      }
    } finally {
      setCoverArtBusy(false);
    }
  };

  const editEntity = editing
    ? {
        ...album,
        title: album.name,
        albumArtist: album.artistName,
      }
    : null;

  return (
    <div>
      <ItemContextMenu sections={contextMenuSections}>
        <Card
          href={`/albums/${album.id}`}
          title={album.name}
          fields={[
          {
            content: (
              <span>
                {album.artistId ? (
                  <Link href={`/artists/${album.artistId}`} className="hover:text-on-surface-variant">
                    {album.artistName ?? 'Unknown artist'}
                  </Link>
                ) : (
                  album.artistName ?? '-'
                )}
                {album.year !== undefined && album.year !== null && (
                  <>
                    {' • '}
                    <Link href={`/years/${album.year}`} className="hover:text-on-surface-variant">
                      {album.year}
                    </Link>
                  </>
                )}
              </span>
            ),
          },
        ]}
        cover={
          <CoverArt
            coverArt={album.coverArt}
            alt={`Cover art for ${album.name}`}
            className="rounded-card"
          />
        }
        favorite={{
          starred: album.starred,
          onClick: () => handleFavorite(!album.starred),
          label: album.name,
        }}
        rating={{
          value: album.rating,
          onRate: handleRate,
        }}
        play={{
          onPlay: handlePlay,
          onShufflePlay: handleShufflePlay,
          label: album.name,
        }}
        isPlaying={currentAlbumId === album.id}
      />
      </ItemContextMenu>
      {error && <p className="mt-1 text-xs text-error">{error}</p>}
      {editEntity && (
        <EditEntityModal
          open
          entityType="album"
          entity={editEntity}
          onClose={() => setEditing(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditCoverArt={handleEditCoverArt}
          onDeleteCoverArt={handleDeleteCoverArt}
          saving={albumMutation.isPending}
          deleting={albumMutation.isPending}
          coverArtBusy={coverArtBusy}
        />
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleCoverArtFileChange}
      />
    </div>
  );
}
