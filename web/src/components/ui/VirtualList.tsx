import { Fragment, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollParent } from './useScrollParent.js';

export interface VirtualListProps<T> {
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Fixed row height in px. Defaults to the app's h-12 table rows. */
  rowHeight?: number;
  overscan?: number;
  /** False renders every row (small lists, tests, no scroll container). */
  enabled?: boolean;
  /** Test hook / explicit override for the scroll container. */
  scrollElement?: HTMLElement | null;
  /** colSpan for the top/bottom spacer rows. Defaults to the full table. */
  spacerColSpan?: number;
  className?: string;
}

// Windowed table body: renders only the rows near the viewport (plus
// overscan) between two spacer rows, so the total scroll height stays
// correct at any row count. Rows keep their real markup — selection,
// keyboard focus, and context menus behave exactly like the unwindowed
// table. Render as the <tbody> of the caller's <table> (which owns the
// thead and column layout).
//
// FALLBACK_ROWS: while the scroll container is unresolved (the first
// commit, before useScrollParent's layout effect can resolve it) a large
// list renders this fixed initial window instead of every row. Row height
// is fixed, so the spacer math stays exact — and the scroller resolves in
// the same commit cycle, before paint. Building the full multi-thousand-row
// DOM for that one transient commit stalls every section open for seconds
// (Firefox profile: a 17s style flush triggered by the scroll-restoration
// write on a just-committed 6k-row table).
const FALLBACK_ROWS = 25;

export function VirtualList<T>({
  items,
  getId,
  renderItem,
  rowHeight = 48,
  overscan = 5,
  enabled = true,
  scrollElement,
  spacerColSpan = 1,
  className,
}: VirtualListProps<T>) {
  const { ref, scrollParent } = useScrollParent<HTMLTableSectionElement>();
  const scroller = scrollElement !== undefined ? scrollElement : scrollParent;
  const active = enabled && scroller !== null;

  const virtualizer = useVirtualizer({
    enabled: active,
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan,
    getItemKey: (index) => getId(items[index] as T),
  });

  const virtualItems = active ? virtualizer.getVirtualItems() : [];
  // Without a scroller (transient first commit, jsdom, small embeds) show a
  // fixed window for large enabled lists and everything for small ones or
  // when the caller disabled windowing (enabled={false} means "render all").
  const fallback = enabled && !active && items.length > FALLBACK_ROWS;
  const shownItems = active ? [] : fallback ? items.slice(0, FALLBACK_ROWS) : items;
  const paddingTop = !active || virtualItems.length === 0 ? 0 : (virtualItems[0]?.start ?? 0);
  const paddingBottom = active
    ? virtualItems.length === 0
      ? 0
      : virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0)
    : fallback
      ? (items.length - FALLBACK_ROWS) * rowHeight
      : 0;

  return (
    <tbody ref={ref} className={className ?? 'divide-y divide-rule'}>
      {paddingTop > 0 && (
        <tr aria-hidden="true" style={{ height: paddingTop }}>
          <td colSpan={spacerColSpan} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
      {active
        ? virtualItems.map((vi) => {
            const item = items[vi.index] as T;
            return <Fragment key={vi.key}>{renderItem(item, vi.index)}</Fragment>;
          })
        : shownItems.map((item, index) => (
            <Fragment key={getId(item)}>{renderItem(item, index)}</Fragment>
          ))}
      {paddingBottom > 0 && (
        <tr aria-hidden="true" style={{ height: paddingBottom }}>
          <td colSpan={spacerColSpan} style={{ padding: 0, border: 0 }} />
        </tr>
      )}
    </tbody>
  );
}
