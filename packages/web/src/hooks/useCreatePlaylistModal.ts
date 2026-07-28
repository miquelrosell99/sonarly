import { useLocation, useSearch } from 'wouter';

const PARAM = 'createPlaylist';

export function useCreatePlaylistModal() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const isOpen = params.get(PARAM) === 'open';

  const open = () => {
    const next = new URLSearchParams(search);
    next.set(PARAM, 'open');
    setLocation(`${location}?${next.toString()}`);
  };

  const close = () => {
    const next = new URLSearchParams(search);
    next.delete(PARAM);
    const query = next.toString();
    setLocation(query ? `${location}?${query}` : location);
  };

  return { isOpen, open, close };
}
