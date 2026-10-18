import { useEffect, useState } from 'react';

/** Visibility gate for loading affordances (design system loading
 * choreography): nothing under `delay` ms, the affordance only after.
 * Resets instantly when `loading` goes false so the next load starts
 * clean. */
export function useDelayedVisible(loading: boolean, delay = 300): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [loading, delay]);

  return visible;
}
