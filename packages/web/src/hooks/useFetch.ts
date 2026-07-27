import { useCallback, useEffect, useState } from 'react';

interface UseFetchResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): UseFetchResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetcher()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(() => {
    reload();
  }, deps);

  return { data, loading, error, reload };
}
