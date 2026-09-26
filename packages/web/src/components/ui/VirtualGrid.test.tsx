import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { VirtualGrid } from './VirtualGrid.js';

interface Item {
  id: string;
  title: string;
}

const items: Item[] = Array.from({ length: 1000 }, (_, i) => ({ id: `item-${i}`, title: `Item ${i}` }));

const ROW_HEIGHT = 250;

function makeScrollElement(width = 1200, height = 500) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 0 });
  return el;
}

function renderedIndexes(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-index]')).map((node) =>
    Number((node as HTMLElement).getAttribute('data-index')),
  );
}

describe('VirtualGrid', () => {
  beforeEach(() => {
    // jsdom measures 0; give measureElement a deterministic card height so
    // it matches the estimate and the window math stays exact.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: ROW_HEIGHT,
    });
  });

  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  });

  it('renders only the visible window plus overscan at scroll offset 0', () => {
    const scroller = makeScrollElement(1200, 500);
    const { container } = render(
      <VirtualGrid
        items={items}
        getId={(item) => item.id}
        scrollElement={scroller}
        estimateCardHeight={() => ROW_HEIGHT}
        renderItem={(item) => <div data-testid="card">{item.title}</div>}
      />,
    );

    const indexes = renderedIndexes(container);
    // 5 lanes at 1200px; viewport fits 2 rows (10 items) — overscan 5 rows
    // extends the window to ~7 rows. Never all 1000 items.
    expect(indexes.length).toBeGreaterThan(10);
    expect(indexes.length).toBeLessThan(60);
    expect(Math.min(...indexes)).toBe(0);
    // Total height reflects every row so the scrollbar is correct.
    const grid = container.querySelector('[data-virtual-grid]') as HTMLElement;
    expect(grid.style.height).toBe(`${Math.ceil(items.length / 5) * ROW_HEIGHT}px`);
  });

  it('moves the window when the scroll offset changes', () => {
    const scroller = makeScrollElement(1200, 500);
    const { container } = render(
      <VirtualGrid
        items={items}
        getId={(item) => item.id}
        scrollElement={scroller}
        estimateCardHeight={() => ROW_HEIGHT}
        renderItem={(item) => <div>{item.title}</div>}
      />,
    );

    // Scroll to row 50 (items 250+).
    scroller.scrollTop = 50 * ROW_HEIGHT;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });

    const indexes = renderedIndexes(container);
    expect(indexes.length).toBeGreaterThan(0);
    expect(Math.min(...indexes)).toBeGreaterThanOrEqual(200);
    expect(Math.max(...indexes)).toBeLessThan(320);
    expect(indexes).not.toContain(0);
  });

  it('keeps rendering the correct total height deep in the list', () => {
    const scroller = makeScrollElement(1200, 500);
    const { container } = render(
      <VirtualGrid
        items={items}
        getId={(item) => item.id}
        scrollElement={scroller}
        estimateCardHeight={() => ROW_HEIGHT}
        renderItem={(item) => <div>{item.title}</div>}
      />,
    );

    scroller.scrollTop = 100 * ROW_HEIGHT;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });

    const grid = container.querySelector('[data-virtual-grid]') as HTMLElement;
    expect(grid.style.height).toBe(`${Math.ceil(items.length / 5) * ROW_HEIGHT}px`);
    const indexes = renderedIndexes(container);
    expect(Math.max(...indexes)).toBeLessThan(items.length);
  });

  it('renders every item when no scroll container is available', () => {
    const few = items.slice(0, 50);
    const { container } = render(
      <VirtualGrid
        items={few}
        getId={(item) => item.id}
        scrollElement={null}
        renderItem={(item) => <div>{item.title}</div>}
      />,
    );
    expect(container.querySelectorAll('[data-index]')).toHaveLength(0);
    expect(container.textContent).toContain('Item 49');
  });
});
