import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icon.js';

interface ScrollRowProps {
  title: string;
  children: React.ReactNode;
}

export function ScrollRow({ title, children }: ScrollRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    updateScrollState();
  }, [children]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            aria-label={`Scroll ${title} left`}
            className="rounded-full p-1 text-fg-secondary transition hover:bg-surface hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Icon name="mdi-chevron-left" size={24} />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            aria-label={`Scroll ${title} right`}
            className="rounded-full p-1 text-fg-secondary transition hover:bg-surface hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Icon name="mdi-chevron-right" size={24} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex gap-4 overflow-x-auto scrollbar-hide"
      >
        {children}
      </div>
    </section>
  );
}
