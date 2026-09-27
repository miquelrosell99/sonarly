// Scroll restoration for the app shell (audit F8). The core browsing loop of
// a music library is list → detail → back: without restoration every back
// navigation lands at the top of a multi-thousand-row list and the
// virtualizer re-renders from offset 0.
//
// Design: a module-level Map remembers the <main> scroll offset per route
// (wouter's location string, i.e. pathname). A rAF-throttled onScroll writer
// keeps the entry fresh while the user scrolls. On every location change an
// effect (post-commit, so windowed lists have mounted) decides by navigation
// direction:
//
//   push     → scroll to the top (forward navigation starts at the top)
//   popstate → restore the remembered offset (back/forward buttons)
//   replace  → leave the offset alone (same-page URL swaps: overlay song
//              sync, filter params)
//
// Direction comes from the History API surface, not from wouter: the browser
// fires popstate on back/forward, and wouter's history patch (see
// use-browser-location.js in the wouter package) dispatches window
// 'pushState'/'replaceState' events for programmatic navigations. That also
// makes the direction observable in tests: dispatch a synthetic 'popstate'
// before a memory-location navigate to simulate the back button.
//
// The now-playing overlay is the one push navigation that must behave like a
// pop: opening it covers the page, and closing it navigates back to
// returnPath. nowPlayingStore's one-shot suppressNextReset flag (set by
// PlayerBar on open and NowPlayingRoute on close) tells this hook to restore
// the remembered offset instead of resetting — the scroll position is handed
// back to the underlying page.
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'wouter';
import { useNowPlaying } from '../features/now-playing/stores/nowPlayingStore.js';

const scrollPositions = new Map<string, number>();

type NavDirection = 'push' | 'pop' | 'replace';

// Default 'push': a navigation without a preceding history event (the initial
// mount, memory-location navigates in tests) behaves like a forward
// navigation. The flag is consumed per location change and reset, so a stale
// direction can never leak into the next navigation.
let pendingDirection: NavDirection = 'push';

if (typeof window !== 'undefined') {
  window.addEventListener('pushState', () => {
    pendingDirection = 'push';
  });
  window.addEventListener('replaceState', () => {
    pendingDirection = 'replace';
  });
  window.addEventListener('popstate', () => {
    pendingDirection = 'pop';
  });
}

function setScrollTop(el: HTMLElement, top: number): void {
  // Direct assignment: instant in browsers (no smooth-scroll crawl through a
  // long list) and supported by jsdom, which has no Element.scrollTo.
  el.scrollTop = top;
}

// Test-only: the scroll memory and direction flag are module-level, so
// suites driving navigations must clear them between tests.
export function resetScrollRestoration(): void {
  scrollPositions.clear();
  pendingDirection = 'push';
}

export function useScrollRestoration(ref: RefObject<HTMLElement | null>): {
  onScroll: () => void;
} {
  const [location] = useLocation();
  const rafRef = useRef(0);
  // The decision for the current location, replayed verbatim if the effect
  // re-runs for the same location (React StrictMode double-invokes effects;
  // re-deciding would see the already-consumed direction/suppress flags).
  const decisionRef = useRef<{ location: string; top: number } | null>(null);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = ref.current;
      if (el) scrollPositions.set(location, el.scrollTop);
    });
  }, [ref, location]);

  // Drop a suppress flag nobody consumed before this hook decides anything:
  // the guest shell sets it on overlay open but has no Layout/hook to consume
  // it — it must not leak into the first navigation after a later sign-in.
  useEffect(() => {
    if (useNowPlaying.getState().suppressNextReset) {
      useNowPlaying.getState().setSuppressNextReset(false);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (decisionRef.current?.location === location) {
      setScrollTop(el, decisionRef.current.top);
      return;
    }

    const direction = pendingDirection;
    pendingDirection = 'push';
    const suppress = useNowPlaying.getState().suppressNextReset;
    if (suppress) useNowPlaying.getState().setSuppressNextReset(false);

    if (direction === 'replace') {
      decisionRef.current = { location, top: el.scrollTop };
      return;
    }
    const top = direction === 'pop' || suppress ? (scrollPositions.get(location) ?? 0) : 0;
    decisionRef.current = { location, top };
    setScrollTop(el, top);
  }, [location, ref]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return { onScroll };
}
