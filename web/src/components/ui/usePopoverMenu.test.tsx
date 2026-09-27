import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { usePopoverMenu } from './usePopoverMenu.js';

afterEach(() => cleanup());

function Harness({ portal = true }: { portal?: boolean }) {
  const menu = usePopoverMenu<HTMLButtonElement>({ portal });
  return (
    <>
      <button ref={menu.triggerRef} type="button" {...menu.triggerProps}>
        Options
      </button>
      {menu.open && (
        <div ref={menu.menuRef} {...menu.menuProps} data-testid="menu">
          {['One', 'Two', 'Three'].map((label) => (
            <button key={label} type="button" role="menuitem" onClick={() => menu.closeMenu(true)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Options' }));
  return screen.getByTestId('menu');
}

describe('usePopoverMenu', () => {
  it('opens on trigger click, exposes menu-button semantics, and focuses the first item', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Options' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    const menu = openMenu();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
    expect(menu.getAttribute('role')).toBe('menu');
  });

  it('opens from the keyboard with ArrowDown or Enter on the closed trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Options' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByTestId('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByTestId('menu')).toBeTruthy();
  });

  it('closes on Escape, returns focus to the trigger, and swallows the event', () => {
    const outerHandler = vi.fn();
    document.addEventListener('keydown', outerHandler);

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Options' });
    openMenu();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('menu')).toBeFalsy();
    expect(document.activeElement).toBe(trigger);
    expect(outerHandler).not.toHaveBeenCalled();

    document.removeEventListener('keydown', outerHandler);
  });

  it('closes on click outside', () => {
    render(
      <div>
        <Harness />
        <button type="button">Elsewhere</button>
      </div>,
    );
    openMenu();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByTestId('menu')).toBeFalsy();
  });

  it('stays open on clicks inside the menu', () => {
    render(<Harness />);
    openMenu();

    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Two' }));
    expect(screen.getByTestId('menu')).toBeTruthy();
  });

  it('moves focus with ArrowDown and ArrowUp, wrapping at the edges', () => {
    render(<Harness />);
    const menu = openMenu();
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });

  it('moves focus with Home and End', () => {
    render(<Harness />);
    const menu = openMenu();
    const items = screen.getAllByRole('menuitem');

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes on Tab and returns focus to the trigger (APG)', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Options' });
    const menu = openMenu();

    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(screen.queryByTestId('menu')).toBeFalsy();
    expect(document.activeElement).toBe(trigger);
  });

  it('skips disabled items when focusing and roving', () => {
    function DisabledHarness() {
      const menu = usePopoverMenu<HTMLButtonElement>();
      return (
        <>
          <button ref={menu.triggerRef} type="button" {...menu.triggerProps}>
            Options
          </button>
          {menu.open && (
            <div ref={menu.menuRef} {...menu.menuProps} data-testid="menu">
              <button type="button" role="menuitem" disabled>Blocked</button>
              <button type="button" role="menuitem">One</button>
            </div>
          )}
        </>
      );
    }
    render(<DisabledHarness />);
    const menu = openMenu();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
  });

  it('anchors a portaled menu above-right of the trigger, clamped to the viewport', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      right: 150,
      bottom: 120,
      left: 0,
      width: 150,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    render(<Harness />);
    const menu = openMenu();
    // top-end proposal: top 0 - 120 - 8 = -128 → clamped to 8; left 150 - 150 = 0 → clamped to 8.
    expect(parseInt(menu.style.top, 10)).toBe(8);
    expect(parseInt(menu.style.left, 10)).toBe(8);

    rectSpy.mockRestore();
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true });
  });

  it('leaves positioning to CSS when portal is false', () => {
    render(<Harness portal={false} />);
    const menu = openMenu();
    expect(menu.style.top).toBe('');
    expect(menu.style.left).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'One' }));
  });

  it('closes and refocuses the trigger when an item selects via closeMenu(true)', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Options' });
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Two' }));
    expect(screen.queryByTestId('menu')).toBeFalsy();
    expect(document.activeElement).toBe(trigger);
  });
});
