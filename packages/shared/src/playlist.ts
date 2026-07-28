import type { SmartPlaylistRules } from './smart-playlist.js';

export type PlaylistVisibility = 'private' | 'shared' | 'public' | 'link';

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  ownerUsername?: string;
  visibility: PlaylistVisibility;
  shareToken?: string;
  songIds: string[];
  isSmart?: boolean;
  rules?: SmartPlaylistRules;
  createdAt: string;
  updatedAt: string;
  songCount?: number;
  starred?: boolean;
  rating?: number;
}

export interface PlaylistShare {
  playlistId: string;
  userId: string;
  canEdit: boolean;
}
