import { useCallback, useLayoutEffect, useState } from 'react';

// The app shell scrolls the <main> element (overflow-y-auto), and every
// library page renders inside it. Virtualized lists need that element to
// translate scroll offsets into visible windows. We resolve it at runtime
// instead of hardcoding <main> so the same components keep working if they
// are ever embedded in another scroll container (e.g. a modal list).
//
// jsdom reports no computed overflow, so in tests this returns null and
// virtualized components fall back to rendering everything.
export function findScrollParent(el: HTMLElement): HTMLElement | null {
  let candidate: HTMLElement | null = null;
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      // An overflow-x-only wrapper computes overflow-y to "auto" (CSS
      // overflow rule) but never scrolls vertically — its height grows with
      // content. Only treat an element as the scroller once it actually
      // overflows vertically; otherwise keep the first match as fallback.
      if (candidate === null) candidate = node;
      if (node.scrollHeight > node.clientHeight) return node;
    }
    node = node.parentElement;
  }
  return candidate;
}

export function useScrollParent<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  const ref = useCallback((el: T | null) => setNode(el), []);

  // Layout effect: resolve before paint so a long list never renders a
  // single unwindowed frame.
  useLayoutEffect(() => {
    setScrollParent(node ? findScrollParent(node) : null);
  }, [node]);

  return { ref, scrollParent };
}
