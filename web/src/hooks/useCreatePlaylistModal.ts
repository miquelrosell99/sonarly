import { useLocation, useSearch } from 'wouter';

const CREATE_PARAM = 'createPlaylist';
const EDIT_PARAM = 'editPlaylist';

export function useCreatePlaylistModal() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const createOpen = params.get(CREATE_PARAM) === 'open';
  const editingPlaylistId = params.get(EDIT_PARAM);
  const isOpen = createOpen || editingPlaylistId !== null;

  const open = () => {
    const next = new URLSearchParams(search);
    next.set(CREATE_PARAM, 'open');
    next.delete(EDIT_PARAM);
    setLocation(`${location}?${next.toString()}`);
  };

  const openForEdit = (playlistId: string) => {
    const next = new URLSearchParams(search);
    next.set(EDIT_PARAM, playlistId);
    next.delete(CREATE_PARAM);
    setLocation(`${location}?${next.toString()}`);
  };

  const close = () => {
    const next = new URLSearchParams(search);
    next.delete(CREATE_PARAM);
    next.delete(EDIT_PARAM);
    const query = next.toString();
    setLocation(query ? `${location}?${query}` : location);
  };

  return { isOpen, createOpen, editingPlaylistId, open, openForEdit, close };
}
