import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

interface UseServerEventsOptions {
  enabled?: boolean;
}

const SSE_URL = '/api/events';

// Query key prefixes affected by library content changes (scan/ingest/etc).
const LIBRARY_QUERY_PREFIXES = [
  'songs',
  'albums',
  'artists',
  'genres',
  'years',
  'playlists',
  'playlist',
  'search',
] as const;

export function useServerEvents(options: UseServerEventsOptions = {}): void {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const source = new EventSource(SSE_URL, { withCredentials: true });
    sourceRef.current = source;

    source.onopen = () => {
      // Connection established; browsers reconnect automatically on error.
    };

    source.onmessage = (event) => {
      let data: ServerEvent;
      try {
        data = JSON.parse(event.data) as ServerEvent;
      } catch {
        return;
      }

      if (data.type === 'library:changed') {
        window.dispatchEvent(
          new CustomEvent('sonarly:library-changed', { detail: data }),
        );
        for (const prefix of LIBRARY_QUERY_PREFIXES) {
          queryClient.invalidateQueries({ queryKey: [prefix] });
        }
      }
    };

    source.onerror = () => {
      // EventSource will retry with exponential backoff. If the server returns
      // 401 the connection closes and the browser will keep retrying, which is
      // acceptable for a global listener.
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [enabled, queryClient]);
}
