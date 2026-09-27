import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ColumnConfigMenu } from './ColumnConfigMenu.js';
import type { ColumnConfigEntry } from '../hooks/useColumnConfig.js';

const ENTRIES: ColumnConfigEntry[] = [
  { key: 'title', label: 'Title', visible: true, locked: true },
  { key: 'artist', label: 'Artist', visible: true, locked: false },
  { key: 'duration', label: 'Duration', visible: false, locked: false },
];

function renderMenu(props: Partial<React.ComponentProps<typeof ColumnConfigMenu>> = {}) {
  return render(
    <ColumnConfigMenu
      entries={ENTRIES}
      actionsLabel="Row actions"
      onToggle={vi.fn()}
      onMove={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('ColumnConfigMenu', () => {
  it('opens a popover listing columns with toggles, reorder buttons, and the locked actions row', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));

    const panel = screen.getByRole('group', { name: 'Column settings' });
    expect(panel).toBeTruthy();

    // Data rows: label + visibility toggle + up/down reorder.
    expect(screen.getByRole('checkbox', { name: 'Title column' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Artist up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Artist down' })).toBeTruthy();
    // Hidden column renders unchecked.
    expect(screen.getByRole('checkbox', { name: 'Duration column' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('checkbox', { name: 'Title column' }).getAttribute('aria-checked')).toBe('true');

    // Locked rows keep their visibility toggle disabled. The title column
    // stays reorderable (clamped at the edge); only the row-actions pseudo
    // column carries no reorder buttons at all.
    expect(screen.getByRole('checkbox', { name: 'Title column' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Title up' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Title down' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('checkbox', { name: 'Row actions column' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Move Row actions up' })).toBeNull();
  });

  it('calls onToggle and onMove handlers', () => {
    const onToggle = vi.fn();
    const onMove = vi.fn();
    renderMenu({ onToggle, onMove });

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Duration column' }));
    expect(onToggle).toHaveBeenCalledWith('duration');

    fireEvent.click(screen.getByRole('button', { name: 'Move Artist down' }));
    expect(onMove).toHaveBeenCalledWith('artist', 1);
  });

  it('disables reorder buttons at the edges of the list', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));

    expect(screen.getByRole('button', { name: 'Move Artist up' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Move Duration up' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Move Duration down' })).toHaveProperty('disabled', true);
  });

  it('closes on Escape and swallows the event so enclosing layers stay open', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    expect(screen.getByRole('group', { name: 'Column settings' })).toBeTruthy();

    const bubbleSpy = vi.fn();
    document.addEventListener('keydown', bubbleSpy);
    fireEvent.keyDown(document, { key: 'Escape' });
    document.removeEventListener('keydown', bubbleSpy);

    expect(screen.queryByRole('group', { name: 'Column settings' })).toBeNull();
    expect(bubbleSpy).not.toHaveBeenCalled();
    // Focus returns to the trigger (same convention as usePopoverMenu).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Configure columns' }));
  });

  it('closes on outside click but not on clicks inside the panel', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));

    fireEvent.mouseDown(screen.getByRole('checkbox', { name: 'Artist column' }));
    expect(screen.getByRole('group', { name: 'Column settings' })).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: 'Column settings' })).toBeNull();
  });

  it('toggles the panel closed when the gear is clicked again', () => {
    renderMenu();
    const gear = screen.getByRole('button', { name: 'Configure columns' });

    fireEvent.click(gear);
    expect(screen.getByRole('group', { name: 'Column settings' })).toBeTruthy();
    fireEvent.click(gear);
    expect(screen.queryByRole('group', { name: 'Column settings' })).toBeNull();
  });
});
