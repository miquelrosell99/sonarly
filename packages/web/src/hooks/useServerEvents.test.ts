import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServerEvents } from './useServerEvents.js';

const mockInvalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

class MockEventSource {
  url: string;
  withCredentials: boolean;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  closed = false;

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
  }

  close() {
    this.closed = true;
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }
}

const realQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function createHarness(enabled: boolean) {
  return function TestHarness() {
    useServerEvents({ enabled });
    return React.createElement('div', { 'data-testid': 'harness' }, 'connected');
  };
}

describe('useServerEvents', () => {
  let eventSourceInstances: MockEventSource[] = [];

  beforeEach(() => {
    eventSourceInstances = [];
    vi.stubGlobal(
      'EventSource',
      vi.fn((url: string, options?: EventSourceInit) => {
        const instance = new MockEventSource(url, options);
        eventSourceInstances.push(instance);
        return instance;
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('opens an EventSource to /api/events when enabled', () => {
    const Harness = createHarness(true);
    render(
      React.createElement(
        QueryClientProvider,
        { client: realQueryClient },
        React.createElement(Harness),
      ),
    );

    expect(EventSource).toHaveBeenCalledTimes(1);
    const instance = eventSourceInstances[0];
    expect(instance.url).toBe('/api/events');
    expect(instance.withCredentials).toBe(true);
    expect(instance.closed).toBe(false);
  });

  it('does not open an EventSource when disabled', () => {
    const Harness = createHarness(false);
    render(
      React.createElement(
        QueryClientProvider,
        { client: realQueryClient },
        React.createElement(Harness),
      ),
    );

    expect(EventSource).not.toHaveBeenCalled();
  });

  it('dispatches a custom event and invalidates queries on library:changed', () => {
    const Harness = createHarness(true);
    render(
      React.createElement(
        QueryClientProvider,
        { client: realQueryClient },
        React.createElement(Harness),
      ),
    );

    const listener = vi.fn();
    window.addEventListener('sonarly:library-changed', listener);

    const instance = eventSourceInstances[0];
    instance.simulateMessage(JSON.stringify({ type: 'library:changed', source: 'ingest' }));

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ type: 'library:changed', source: 'ingest' });
    for (const prefix of ['songs', 'albums', 'artists', 'genres', 'years', 'playlists', 'playlist', 'search']) {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: [prefix] });
    }
    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: [] });

    window.removeEventListener('sonarly:library-changed', listener);
  });

  it('ignores messages that are not valid JSON', () => {
    const Harness = createHarness(true);
    render(
      React.createElement(
        QueryClientProvider,
        { client: realQueryClient },
        React.createElement(Harness),
      ),
    );

    const instance = eventSourceInstances[0];
    instance.simulateMessage('not json');

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it('closes the EventSource on unmount', () => {
    const Harness = createHarness(true);
    const { unmount } = render(
      React.createElement(
        QueryClientProvider,
        { client: realQueryClient },
        React.createElement(Harness),
      ),
    );

    const instance = eventSourceInstances[0];
    expect(instance.closed).toBe(false);
    unmount();
    expect(instance.closed).toBe(true);
  });
});
