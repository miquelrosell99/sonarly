import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { useRef } from 'react';
import { useScrollRestoration, resetScrollRestoration } from './useScrollRestoration.js';
import { useNowPlaying, resetNowPlaying } from '../features/now-playing/stores/nowPlayingStore.js';

// Layout's wiring, distilled: one scrollable <main> owns the per-route
// offset memory; pages navigate through memoryLocation. Direction is
// simulated the way the real History API surface works — a 'popstate' (or
// 'pushState'/'replaceState') event before the navigate, which is exactly
// what wouter's browser hook observes.
function Shell({ children }: { children: React.ReactNode }) {
  const mainRef = useRef<HTMLElement | null>(null);
  const { onScroll } = useScrollRestoration(mainRef);
  return (
    <main ref={mainRef} data-testid="main" onScroll={onScroll} style={{ overflowY: 'auto' }}>
      {children}
    </main>
  );
}

function TallPage({ label }: { label: string }) {
  return <div style={{ height: 100000 }}>{label}</div>;
}

function renderShell(path: string) {
  const location = memoryLocation({ path });
  render(
    <Router hook={location.hook}>
      <Shell>
        <Route path="/tracks">{() => <TallPage label="tracks-page" />}</Route>
        <Route path="/tracks/:id">{() => <TallPage label="track-detail" />}</Route>
        <Route path="/albums">{() => <TallPage label="albums-page" />}</Route>
      </Shell>
    </Router>,
  );
  return location;
}

function mainEl(): HTMLElement {
  return document.querySelector('main') as HTMLElement;
}

function flushWriter(): Promise<void> {
  // The writer is rAF-throttled; queue behind it so the offset is recorded
  // before the next navigation.
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('useScrollRestoration (audit F8)', () => {
  beforeEach(() => {
    resetScrollRestoration();
    resetNowPlaying();
  });

  afterEach(() => {
    cleanup();
    resetNowPlaying();
  });

  it('resets to the top on forward (push) navigation', async () => {
    const location = renderShell('/tracks');
    mainEl().scrollTop = 480;
    fireEvent.scroll(mainEl());
    await act(async () => {
      await flushWriter();
    });

    act(() => location.navigate('/tracks/t1'));

    expect(mainEl().scrollTop).toBe(0);
  });

  it('restores the remembered offset on back (popstate) navigation', async () => {
    const location = renderShell('/tracks');
    mainEl().scrollTop = 480;
    fireEvent.scroll(mainEl());
    await act(async () => {
      await flushWriter();
    });

    act(() => location.navigate('/tracks/t1'));
    expect(mainEl().scrollTop).toBe(0);

    act(() => {
      window.dispatchEvent(new Event('popstate'));
      location.navigate('/tracks');
    });

    expect(mainEl().scrollTop).toBe(480);
  });

  it('restores 0 on popstate when the target was never scrolled', async () => {
    const location = renderShell('/tracks');
    mainEl().scrollTop = 480;
    fireEvent.scroll(mainEl());
    await act(async () => {
      await flushWriter();
    });
    act(() => location.navigate('/tracks/t1'));

    act(() => {
      window.dispatchEvent(new Event('popstate'));
      location.navigate('/albums');
    });

    expect(mainEl().scrollTop).toBe(0);
  });

  it('leaves the offset alone on replace navigations', async () => {
    const location = renderShell('/tracks');
    mainEl().scrollTop = 200;
    fireEvent.scroll(mainEl());
    await act(async () => {
      await flushWriter();
    });

    act(() => {
      window.dispatchEvent(new Event('replaceState'));
      location.navigate('/albums');
    });

    expect(mainEl().scrollTop).toBe(200);
  });

  it('hands the scroll position back across the overlay open/close cycle', async () => {
    const location = renderShell('/tracks');
    mainEl().scrollTop = 480;
    fireEvent.scroll(mainEl());
    await act(async () => {
      await flushWriter();
    });

    // PlayerBar opens the overlay: the URL swaps while the page underneath
    // keeps its position memory.
    act(() => {
      useNowPlaying.getState().setSuppressNextReset(true);
      location.navigate('/now-playing/playlist/pl-1/song-9');
    });
    expect(mainEl().scrollTop).toBe(0);

    // Closing the overlay navigates back to returnPath ('/tracks'): the
    // remembered offset is restored instead of resetting to the top.
    act(() => {
      useNowPlaying.getState().setSuppressNextReset(true);
      location.navigate('/tracks');
    });
    expect(mainEl().scrollTop).toBe(480);
    expect(useNowPlaying.getState().suppressNextReset).toBe(false);
  });

  it('discards a stale suppress flag on an intervening popstate', async () => {
    const location = renderShell('/tracks');
    mainEl().scrollTop = 480;
    fireEvent.scroll(mainEl());
    await act(async () => {
      await flushWriter();
    });

    act(() => {
      useNowPlaying.getState().setSuppressNextReset(true);
      window.dispatchEvent(new Event('popstate'));
      location.navigate('/tracks/t1');
    });
    expect(useNowPlaying.getState().suppressNextReset).toBe(false);
    expect(mainEl().scrollTop).toBe(0);

    act(() => location.navigate('/albums'));
    expect(mainEl().scrollTop).toBe(0);
  });

  it('clears an unconsumed suppress flag on mount (guest shell has no Layout)', () => {
    useNowPlaying.getState().setSuppressNextReset(true);

    renderShell('/tracks');

    expect(useNowPlaying.getState().suppressNextReset).toBe(false);
  });
});
