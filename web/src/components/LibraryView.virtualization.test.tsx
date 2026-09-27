import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { useRef } from 'react';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from './LibraryView.js';
import { useScrollRestoration, resetScrollRestoration } from '../hooks/useScrollRestoration.js';

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

describe('LibraryView scroll restoration after windowing (audit F8)', () => {
  beforeEach(() => {
    resetScrollRestoration();
    // Fake a scrolling page (same contract as the suite above): a 500px
    // viewport over a 400-row list.
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

  // The Layout wiring in miniature: the Router wraps the component owning
  // the scrollable main (useLocation must read the memory hook), and the
  // windowed LibraryView renders within it.
  function renderShell(path: string) {
    const location = memoryLocation({ path });
    function Main() {
      const mainRef = useRef<HTMLElement | null>(null);
      const { onScroll } = useScrollRestoration(mainRef);
      return (
        <main ref={mainRef} data-testid="main" onScroll={onScroll} style={{ overflowY: 'auto' }}>
          <Route path="/tracks">
            {() => (
              <LibraryView<Item>
                data={bigList(400)}
                columns={columns}
                cardFields={cardFields}
                getId={(item) => item.id}
                getHref={(item) => `/items/${item.id}`}
              />
            )}
          </Route>
          <Route path="/tracks/:id">{() => <div>track detail</div>}</Route>
        </main>
      );
    }
    render(
      <Router hook={location.hook}>
        <Main />
      </Router>,
    );
    return location;
  }

  it('re-renders the window at the restored offset after a back navigation', async () => {
    const location = renderShell('/tracks');
    const main = document.querySelector('main') as HTMLElement;

    // The deep-offset rows are windowed away at scrollTop 0.
    expect(screen.getByText('Item 0')).toBeTruthy();
    expect(screen.queryByText('Item 100')).toBeFalsy();

    // Scroll deep, let the rAF-throttled writer record the offset, drill in.
    main.scrollTop = 100 * 48;
    fireEvent.scroll(main);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    act(() => location.navigate('/tracks/item-100'));
    expect(main.scrollTop).toBe(0);

    // Back: the offset is handed back and the virtualizer re-windows there.
    act(() => {
      window.dispatchEvent(new Event('popstate'));
      location.navigate('/tracks');
    });
    expect(main.scrollTop).toBe(100 * 48);

    // Browsers fire a scroll event for the programmatic restore; the
    // virtualizer listens to it and moves its window to the offset.
    fireEvent.scroll(main);

    expect(screen.getByText('Item 100')).toBeTruthy();
    expect(screen.queryByText('Item 0')).toBeFalsy();
  });
});
