export interface PlayerInfo {
  id: string;
  userId?: string;
  clientId: string;
  songId: string;
  songTitle: string;
  artistName?: string;
  albumName?: string;
  durationSeconds?: number;
  startedAt: string;
  updatedAt: string;
}
