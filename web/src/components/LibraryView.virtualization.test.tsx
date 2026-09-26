import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Router } from 'wouter';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from './LibraryView.js';

interface Item {
  id: string;
  title: string;
}

const columns: LibraryViewColumn<Item>[] = [
  { key: 'title', header: 'Title', render: (item) => item.title },
];

const cardFields: LibraryViewCardField<Item>[] = [
  { key: 'title', render: (item) => item.title },
];

function bigList(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, title: `Item ${i}` }));
}

describe('LibraryView virtualization', () => {
  beforeEach(() => {
    // Fake a scrolling page: every element reports a 500px viewport that
    // overflows vertically, so useScrollParent picks an ancestor and the
    // virtualizer sees a 500px scroll rect.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () => ({ overflowY: 'auto', overflowX: 'visible' }) as unknown as CSSStyleDeclaration,
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 500;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 100000;
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  });

  function renderView(data: Item[], props: Partial<React.ComponentProps<typeof LibraryView<Item>>> = {}) {
    return render(
      <Router>
        <LibraryView<Item>
          data={data}
          columns={columns}
          cardFields={cardFields}
          getId={(item) => item.id}
          getHref={(item) => `/items/${item.id}`}
          {...props}
        />
      </Router>,
    );
  }

  it('windows long lists: only visible rows render, with correct total height', () => {
    const data = bigList(400);
    const { container } = renderView(data);

    const rows = Array.from(container.querySelectorAll('tbody tr:not([aria-hidden="true"])'));
    // 400 rows at 48px = 19200px; a 500px viewport + overscan renders a
    // small window, never all 400.
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(80);

    const spacer = container.querySelector('tr[aria-hidden="true"]') as HTMLElement;
    const bottom = Number(spacer.style.height.replace('px', ''));
    expect(bottom + rows.length * 48).toBe(400 * 48);
  });

  it('keeps selection/activation wiring on windowed rows', () => {
    const data = bigList(400);
    const onPlaySelection = vi.fn();
    const { container } = renderView(data, { onPlaySelection });

    const row = container.querySelector('tbody tr:not([aria-hidden="true"])') as HTMLElement;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onPlaySelection).toHaveBeenCalledTimes(1);
  });

  it('does not window dnd-sortable lists (queue editor keeps full render + drag)', () => {
    const data = bigList(400);
    const { container } = renderView(data, {
      sortable: true,
      onReorder: () => {},
      availableViews: ['list'],
      defaultView: 'list',
    });

    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(400);
  });

  it('renders small lists fully (below the threshold)', () => {
    const data = bigList(30);
    const { container } = renderView(data);

    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(30);
  });
});
