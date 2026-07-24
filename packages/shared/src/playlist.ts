import type { SmartPlaylistRules } from './smart-playlist.js';

export type PlaylistVisibility = 'private' | 'shared' | 'public' | 'link';

export interface Playlist {
  id: string;
  name: string;
  ownerId: string;
  visibility: PlaylistVisibility;
  shareToken?: string;
  songIds: string[];
  isSmart?: boolean;
  rules?: SmartPlaylistRules;
  createdAt: string;
  updatedAt: string;
  starred?: boolean;
  rating?: number;
}

export interface PlaylistShare {
  playlistId: string;
  userId: string;
  canEdit: boolean;
}
