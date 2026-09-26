import { Fragment, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollParent } from './useScrollParent.js';

// Matches the responsive column classes used by the app's card grids
// (grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5). Keep in sync
// with those Tailwind classes wherever they appear.
export function defaultGridColumns(width: number): number {
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  if (width >= 640) return 3;
  return 2;
}

export interface VirtualGridProps<T> {
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Column count for a given container width. Defaults to the app grid. */
  columns?: (width: number) => number;
  /** Height of one card for a given lane width (pre-measurement estimate). */
  estimateCardHeight?: (laneWidth: number) => number;
  overscan?: number;
  /** Test hook / explicit override for the scroll container. */
  scrollElement?: HTMLElement | null;
  className?: string;
}

const GAP = 16; // gap-4 between cards

// Windowed card grid: renders only the cards near the viewport (plus
// overscan) and pads the total height so the scrollbar stays correct at any
// list length. Cards keep their normal markup (and aspect-square covers, so
// image loads never shift layout); react-virtual refines row heights from
// the DOM after mount.
export function VirtualGrid<T>({
  items,
  getId,
  renderItem,
  columns = defaultGridColumns,
  estimateCardHeight = (laneWidth) => laneWidth + 96,
  overscan = 5,
  scrollElement,
  className,
}: VirtualGridProps<T>) {
  const { ref, scrollParent } = useScrollParent<HTMLDivElement>();
  const scroller = scrollElement !== undefined ? scrollElement : scrollParent;

  const virtualizer = useVirtualizer({
    enabled: scroller !== null,
    count: items.length,
    lanes: columns(scroller?.getBoundingClientRect().width ?? 0),
    getScrollElement: () => scroller,
    estimateSize: () => {
      const width = scroller?.getBoundingClientRect().width ?? 0;
      const lanes = Math.max(1, columns(width));
      return estimateCardHeight(Math.floor((width - GAP * (lanes - 1)) / lanes));
    },
    overscan,
    getItemKey: (index) => getId(items[index] as T),
  });

  // No measurable scroll container (jsdom, exotic embedding): render
  // everything rather than nothing.
  if (scroller === null) {
    return (
      <div ref={ref} className={className}>
        {items.map((item, index) => (
          <Fragment key={getId(item)}>{renderItem(item, index)}</Fragment>
        ))}
      </div>
    );
  }

  const lanes = Math.max(1, columns(scroller.getBoundingClientRect().width ?? 0));
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={ref} className={className}>
      <div
        className="relative w-full"
        style={{ height: virtualItems.length > 0 ? virtualizer.getTotalSize() : 0 }}
        data-virtual-grid=""
      >
        {virtualItems.map((vi) => {
          const item = items[vi.index] as T;
          return (
            <div
              key={vi.key}
              ref={virtualizer.measureElement}
              data-index={vi.index}
              className="absolute left-0 top-0"
              style={{
                width: `${100 / lanes}%`,
                padding: GAP / 2,
                transform: `translateX(${vi.lane * 100}%) translateY(${vi.start}px)`,
              }}
            >
              {renderItem(item, vi.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
