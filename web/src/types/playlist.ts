// Re-derived from the generated OpenAPI schema (audit F17, plan 10d). The
// server splits the playlist shape into `PlaylistListItem` (list endpoints)
// and `PlaylistDetail` (GET /playlists/:id) — the old hand `Playlist` was a
// merge of both plus a `songIds` field no client code ever read, so the list
// component is what `Playlist` means everywhere it survives.
import type { components } from '../contract/schema.js';

export type Playlist = components['schemas']['PlaylistListItem'];
export type PlaylistVisibility = components['schemas']['PlaylistVisibility'];
export type PlaylistResolveMode = components['schemas']['ResolveMode'];
export type PlaylistShareEntry = components['schemas']['ShareEntry'];

/** POST /api/playlists/:id/share request body (no generated component). */
export interface PlaylistShare {
  playlistId: string;
  userId: string;
  canEdit: boolean;
}
