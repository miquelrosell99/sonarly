import type { ReactNode } from 'react';
import type { Artist, Playlist, Song } from '../../../../types';
import { ItemContextMenu } from '../../../../components/ItemContextMenu.js';
import { useAlbumContextMenu, type AlbumMenuTarget } from '../../../../hooks/useAlbumContextMenu.js';
import { useArtistContextMenu } from '../../../../hooks/useArtistContextMenu.js';
import { usePlaylistContextMenu } from '../../../../hooks/usePlaylistContextMenu.js';
import { useSongsContextMenu } from '../../../../hooks/useSongsContextMenu.js';

export function AlbumContextMenu({ album, children }: { album: AlbumMenuTarget; children: ReactNode }) {
  const sections = useAlbumContextMenu(album);
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function ArtistContextMenu({ artist, children }: { artist: Artist; children: ReactNode }) {
  const sections = useArtistContextMenu(artist, () => {});
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function PlaylistContextMenu({ playlist, children }: { playlist: Playlist; children: ReactNode }) {
  const sections = usePlaylistContextMenu(playlist, () => {}, () => {});
  return <ItemContextMenu sections={sections}>{children}</ItemContextMenu>;
}

export function SongContextMenu({
  songs,
  onEdit,
  isAdmin,
  children,
}: {
  songs: Song[];
  onEdit: () => void;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const { sections, deleteConfirm } = useSongsContextMenu(songs, onEdit, isAdmin);
  return (
    <>
      <ItemContextMenu sections={sections}>{children}</ItemContextMenu>
      {deleteConfirm}
    </>
  );
}
