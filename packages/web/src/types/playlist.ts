import type { SmartPlaylistRules } from './smart-playlist.js';

export type PlaylistVisibility = 'private' | 'shared' | 'public' | 'link';

/**
 * How a smart playlist's user-scoped rule fields (rating, loved, playcount,
 * lastplayed) are resolved for a viewer:
 * - 'tracks': resolve against the owner's data, so every viewer receives the
 *   same curated track list (default).
 * - 'query': resolve live against each viewer's own data.
 */
export type PlaylistResolveMode = 'tracks' | 'query';

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
  resolveMode?: PlaylistResolveMode;
  createdAt: string;
  updatedAt: string;
  songCount?: number;
  starred?: boolean;
  rating?: number;
  /** Owner-only: current user shares, included on the detail response. */
  shares?: PlaylistShareEntry[];
}

export interface PlaylistShare {
  playlistId: string;
  userId: string;
  canEdit: boolean;
}

export interface PlaylistShareEntry {
  userId: string;
  username: string;
  canEdit: boolean;
}
