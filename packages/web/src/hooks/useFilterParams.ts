import { useSearch, useLocation } from 'wouter';

export function useFilterParams() {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(search);

  const get = (key: string): string | null => params.get(key);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(search);
    if (value === null || value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const query = next.toString();
    setLocation(query ? `${location}?${query}` : location);
  };

  return { get, set, params };
}
