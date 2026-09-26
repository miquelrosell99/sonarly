// TEMPORARY diagnostic: render the full App against a REAL local v2 server
// (127.0.0.1:4620, real production-shaped DB) and find which routes crash.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const BASE = 'http://127.0.0.1:4620';
let cookie = '';
const rawFetch = globalThis.fetch.bind(globalThis);

async function realFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isSameOrigin = url.startsWith('/api') || url.startsWith('/rest');
  const target = isSameOrigin ? BASE + url : url;
  const headers = new Headers(init?.headers);
  if (cookie) headers.set('cookie', cookie);
  const res = await rawFetch(target, { ...init, headers, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  close() { this.readyState = 2; }
  addEventListener() {}
  removeEventListener() {}
  constructor(public url: string, _opts?: unknown) {}
}

const consoleErrors: string[] = [];
const origError = console.error;

const ROUTES = [
  '/', '/tracks', '/albums', '/artists', '/genres', '/years',
  '/playlists', '/search?q=a', '/statistics', '/settings', '/profile',
];

describe('UI-vs-v2 repro against real server', () => {
  beforeAll(async () => {
    console.error = (...args: unknown[]) => {
      const s = args.map(String).join(' ');
      if (/not wrapped in act|inside a test|EventSource/i.test(s)) return;
      consoleErrors.push(s.slice(0, 600));
    };
    vi.stubGlobal('fetch', vi.fn(realFetch));
    vi.stubGlobal('EventSource', FakeEventSource);
    // audio stubs for jsdom
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'canPlayType', { value: () => 'maybe' });
  });
  afterAll(() => {
    console.error = origError;
    vi.unstubAllGlobals();
  });

  for (const route of ROUTES) {
    it(`route ${route} does not hit the error boundary`, { timeout: 20000 }, async () => {
      const startIdx = consoleErrors.length;
      const [{ default: App }, { QueryClient, QueryClientProvider }] = await Promise.all([
        import('./App'),
        import('@tanstack/react-query'),
      ]);
      const { NotificationProvider } = await import('./contexts/NotificationContext');
      const wouter = await import('wouter');
      const { memoryLocation } = await import('wouter/memory-location');
      const mem = memoryLocation({ path: route });

      render(
        React.createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          React.createElement(
            NotificationProvider,
            null,
            React.createElement(wouter.Router, { hook: mem.hook } as never, React.createElement(App, null)),
          ),
        ),
      );

      await new Promise((r) => setTimeout(r, 2500));
      const crashed = screen.queryByText('This view crashed unexpectedly.');
      const errs = consoleErrors.slice(startIdx).filter((e) => /Error|error/.test(e));
      if (crashed || errs.length) {
        throw new Error(
          `ROUTE ${route} CRASHED (boundary=${!!crashed})\n${errs.slice(0, 3).join('\n---\n')}`,
        );
      }
      expect(crashed).toBeNull();
    });
  }
});
