export type PlaylistVisibility = 'private' | 'shared' | 'public' | 'link';

export interface Playlist {
  id: string;
  name: string;
  ownerId: string;
  visibility: PlaylistVisibility;
  shareToken?: string;
  songIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistShare {
  playlistId: string;
  userId: string;
  canEdit: boolean;
}
