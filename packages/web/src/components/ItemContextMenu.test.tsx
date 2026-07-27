import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ItemContextMenu } from './ItemContextMenu.js';

afterEach(() => cleanup());

const sections = [
  { title: 'Playback', items: [{ id: 'play', label: 'Play', icon: 'mdi-play', onClick: vi.fn() }] },
  { items: [{ id: 'edit', label: 'Edit', onClick: vi.fn() }] },
];

describe('ItemContextMenu', () => {
  it('renders sections and dividers', () => {
    render(
      <ItemContextMenu sections={sections}>
        <div data-testid="target">Right click me</div>
      </ItemContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('target'));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('Playback')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').length).toBe(2);
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('calls the item onClick and closes the menu', async () => {
    const onClick = vi.fn();
    render(
      <ItemContextMenu sections={[{ items: [{ id: 'play', label: 'Play', onClick }] }]}>
        <div data-testid="target">Right click me</div>
      </ItemContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('target'));
    fireEvent.click(screen.getByText('Play'));
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeFalsy();
    });
  });

  it('disables the menuitem when disabled or loading', () => {
    const onClick = vi.fn();
    render(
      <ItemContextMenu
        sections={[
          {
            items: [
              { id: 'disabled', label: 'Disabled', disabled: true, onClick },
              { id: 'loading', label: 'Loading', loading: true, onClick },
            ],
          },
        ]}
      >
        <div data-testid="target">Right click me</div>
      </ItemContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('target'));
    const buttons = screen.getAllByRole('menuitem');
    expect(buttons[0].hasAttribute('disabled')).toBe(true);
    expect(buttons[1].hasAttribute('disabled')).toBe(true);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByText('⟳')).toBeTruthy();
  });

  it('applies the danger variant class', () => {
    render(
      <ItemContextMenu sections={[{ items: [{ id: 'delete', label: 'Delete', variant: 'danger', onClick: vi.fn() }] }]}>
        <div data-testid="target">Right click me</div>
      </ItemContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('target'));
    expect(screen.getByText('Delete').className.includes('text-danger')).toBe(true);
  });

  it('clamps the menu position to the viewport', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });

    render(
      <ItemContextMenu sections={[{ items: [{ id: 'play', label: 'Play', onClick: vi.fn() }] }]}>
        <div data-testid="target">Right click me</div>
      </ItemContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('target'), { clientX: 5, clientY: 395 });
    const menu = screen.getByRole('menu');
    expect(parseInt(menu.style.left, 10)).toBe(8);
    expect(parseInt(menu.style.top, 10)).toBeLessThanOrEqual(292);

    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true });
  });

  it('closes on Escape without letting the event bubble', () => {
    const outerHandler = vi.fn();
    document.addEventListener('keydown', outerHandler);

    render(
      <ItemContextMenu sections={[{ items: [{ id: 'play', label: 'Play', onClick: vi.fn() }] }]}>
        <div data-testid="target">Right click me</div>
      </ItemContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId('target'));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeFalsy();
    expect(outerHandler).not.toHaveBeenCalled();

    document.removeEventListener('keydown', outerHandler);
  });
});
