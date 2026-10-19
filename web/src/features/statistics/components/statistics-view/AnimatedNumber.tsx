import { useEffect, useState } from 'react';
import { formatNumber } from './format.js';

export function AnimatedNumber({ value, formatter = formatNumber }: { value: number; formatter?: (n: number) => string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }

    const duration = 900;
    const start = performance.now();
    const from = display;
    const to = value;
    let raf = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      setDisplay(current);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span>{formatter(display)}</span>;
}
