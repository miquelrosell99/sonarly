import { useCallback, useEffect, useRef, useState } from 'react';

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
  const requestIdRef = useRef(0);

  const reload = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (requestId === requestIdRef.current) setData(result);
      })
      .catch((err) => {
        if (requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [fetcher]);

  useEffect(() => {
    reload();
    return () => {
      // Invalidate any in-flight request so a stale response cannot clobber
      // newer data after the deps change or the component unmounts.
      requestIdRef.current += 1;
    };
  }, [reload, ...deps]);

  return { data, loading, error, reload };
}
