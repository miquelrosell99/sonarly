// HTML5 drag-and-drop payload contract for dragging songs onto playlist
// targets (the sidebar playlist entries). A custom MIME type so drops are
// only accepted where song ids make sense, and the payload is the plain id
// array — drop targets append via POST /api/playlists/:id/songs.

export const SONGS_DRAG_MIME = 'application/x-sonarly-songs';

export function startSongsDrag(e: React.DragEvent, songIds: string[]): void {
  e.dataTransfer.setData(SONGS_DRAG_MIME, JSON.stringify(songIds));
  e.dataTransfer.effectAllowed = 'copy';
}

export function hasSongsDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(SONGS_DRAG_MIME);
}

export function readSongsDragData(dataTransfer: DataTransfer): string[] | null {
  try {
    const raw = dataTransfer.getData(SONGS_DRAG_MIME);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((id): id is string => typeof id === 'string');
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}
