import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { VirtualList } from './VirtualList.js';

interface Item {
  id: string;
}

const items: Item[] = Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}` }));

function makeScrollElement(height = 500) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width: 800, height, top: 0, left: 0, right: 800, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
  return el;
}

function dataRowIndexes(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-row-index]')).map((node) =>
    Number((node as HTMLElement).getAttribute('data-row-index')),
  );
}

describe('VirtualList', () => {
  beforeEach(() => {
    // virtual-core reads offsetHeight for the scroll element's initial rect;
    // jsdom measures 0, so give every element the mocked viewport height.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 500,
    });
  });

  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  });

  it('renders only the visible window plus overscan and pads total height', () => {
    const scroller = makeScrollElement(500);
    const { container } = render(
      <table>
        <thead>
          <tr>
            <th>Title</th>
          </tr>
        </thead>
        <VirtualList
          items={items}
          getId={(item) => item.id}
          scrollElement={scroller}
          spacerColSpan={1}
          renderItem={(item, index) => (
            <tr data-row-index={index}>
              <td>{item.id}</td>
            </tr>
          )}
        />
      </table>,
    );

    const indexes = dataRowIndexes(container);
    // viewport fits ~10 rows of 48px; overscan 5 extends to ~21. Never 1000.
    expect(indexes.length).toBeGreaterThan(10);
    expect(indexes.length).toBeLessThan(60);
    expect(Math.min(...indexes)).toBe(0);

    // At scrollTop 0 the top spacer is omitted (zero height); the bottom
    // spacer carries the remaining table height.
    const spacers = Array.from(container.querySelectorAll('tr[aria-hidden="true"]'));
    expect(spacers).toHaveLength(1);
    const bottom = Number((spacers[0] as HTMLElement).style.height.replace('px', ''));
    expect(bottom + indexes.length * 48).toBe(1000 * 48);
  });

  it('moves the window and grows the top spacer as the offset increases', () => {
    const scroller = makeScrollElement(500);
    const { container } = render(
      <table>
        <tbody>
          <VirtualList
            items={items}
            getId={(item) => item.id}
            scrollElement={scroller}
            renderItem={(item, index) => (
              <tr data-row-index={index}>
                <td>{item.id}</td>
              </tr>
            )}
          />
        </tbody>
      </table>,
    );

    scroller.scrollTop = 100 * 48;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });

    const indexes = dataRowIndexes(container);
    expect(indexes.length).toBeGreaterThan(0);
    expect(Math.min(...indexes)).toBeGreaterThanOrEqual(85);
    expect(Math.max(...indexes)).toBeLessThan(125);
    expect(indexes).not.toContain(0);

    const spacers = Array.from(container.querySelectorAll('tr[aria-hidden="true"]'));
    const top = Number((spacers[0] as HTMLElement).style.height.replace('px', ''));
    const bottom = Number((spacers[1] as HTMLElement).style.height.replace('px', ''));
    expect(top + bottom + indexes.length * 48).toBe(1000 * 48);
    expect(top).toBeGreaterThan(0);
  });

  it('renders every row when disabled (small lists)', () => {
    const few = items.slice(0, 30);
    const { container } = render(
      <table>
        <tbody>
          <VirtualList
            items={few}
            getId={(item) => item.id}
            enabled={false}
            renderItem={(item, index) => (
              <tr data-row-index={index}>
                <td>{item.id}</td>
              </tr>
            )}
          />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('[data-row-index]')).toHaveLength(30);
    expect(container.querySelectorAll('tr[aria-hidden="true"]')).toHaveLength(0);
  });
});
