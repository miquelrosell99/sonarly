import { useEffect, useState } from 'react';
import type { Song } from '../../types';
import { api } from '../../lib/api.js';

/**
 * Album stats side-fetch for the song/album tag editor: resolves the album
 * named in the form and derives max track/disc numbers for field hints.
 * Extracted verbatim from EditEntityModal.tsx (audit F22, plan P10b).
 */
export function useAlbumStats(
  entityType: 'song' | 'album' | 'artist' | 'playlist',
  album: string | string[] | undefined,
  artist: string | string[] | undefined,
): { tracks: number; discs: number } | null {
  const [albumStats, setAlbumStats] = useState<{ tracks: number; discs: number } | null>(null);

  useEffect(() => {
    if (entityType !== 'song' && entityType !== 'album') return;
    const albumName = String(album ?? '').trim();
    if (!albumName) {
      setAlbumStats(null);
      return;
    }
    let cancelled = false;
    api<{ albums: { id: string; name: string; artistName?: string }[] }>('/albums')
      .then(({ albums }) => {
        if (cancelled) return;
        const artistName = (Array.isArray(artist) ? artist[0] : artist)?.trim();
        const match = albums.find(
          (a) =>
            a.name.toLowerCase() === albumName.toLowerCase() &&
            (!artistName || !a.artistName || a.artistName.toLowerCase() === artistName.toLowerCase()),
        );
        if (!match) {
          setAlbumStats(null);
          return;
        }
        return api<{ album: { songs: Song[] } }>(`/albums/${match.id}`);
      })
      .then((detail) => {
        if (cancelled || !detail) return;
        const songs = detail.album.songs;
        const tracks = Math.max(0, ...songs.map((s) => s.trackNumber ?? 0));
        const discs = Math.max(0, ...songs.map((s) => s.discNumber ?? 0));
        setAlbumStats({ tracks, discs });
      })
      .catch(() => setAlbumStats(null));
    return () => {
      cancelled = true;
    };
  }, [entityType, album, artist]);

  return albumStats;
}
