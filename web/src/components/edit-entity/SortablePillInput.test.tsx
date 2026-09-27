import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SortablePillInput } from './SortablePillInput.js';

function renderInput(props: Partial<React.ComponentProps<typeof SortablePillInput>> = {}) {
  return render(
    <SortablePillInput
      values={['Alpha', 'Beta', 'Gamma']}
      onChange={vi.fn()}
      placeholder="Artist"
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('SortablePillInput', () => {
  it('renders each value as a chip with move and remove controls; drag handles arrive with the lazy dnd wrapper', async () => {
    renderInput();

    for (const value of ['Alpha', 'Beta', 'Gamma']) {
      expect(screen.getByText(value)).toBeTruthy();
      expect(screen.getByRole('button', { name: `Remove ${value}` })).toBeTruthy();
    }
    // Move buttons exist synchronously (the keyboard-accessible path) and
    // clamp at the edges.
    expect(screen.getByRole('button', { name: 'Move Alpha left' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Alpha right' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Move Gamma left' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Move Gamma right' })).toHaveProperty('disabled', true);

    // The dnd-kit wrapper lazy-loads and adds the drag/keyboard handles.
    expect(await screen.findByRole('button', { name: 'Reorder Alpha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reorder Gamma' })).toBeTruthy();
  });

  it('moves a chip via the move buttons and reports the reordered array', () => {
    const onChange = vi.fn();
    renderInput({ onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Move Beta right' }));
    expect(onChange).toHaveBeenCalledWith(['Alpha', 'Gamma', 'Beta']);

    // Controlled input: the parent kept the original values, so a second
    // click on the same chip applies the same move again.
    fireEvent.click(screen.getByRole('button', { name: 'Move Beta left' }));
    expect(onChange).toHaveBeenCalledWith(['Beta', 'Alpha', 'Gamma']);
  });

  it('removes a chip and reports the remaining array', () => {
    const onChange = vi.fn();
    renderInput({ onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }));
    expect(onChange).toHaveBeenCalledWith(['Alpha', 'Gamma']);
  });

  it('adds a new value from the raw input on Enter, ignoring duplicates case-insensitively', () => {
    const onChange = vi.fn();
    renderInput({ onChange });
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: ' Delta ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('removes the last chip on Backspace at an empty input', () => {
    const onChange = vi.fn();
    renderInput({ onChange });
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['Alpha', 'Beta']);
  });

  it('renders chips without controls when disabled', () => {
    renderInput({ disabled: true });

    expect(screen.queryByRole('button', { name: 'Reorder Alpha' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move Beta left' })).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('keeps chip identity by value so focus survives a move', () => {
    const { container } = renderInput();
    const moveLeft = screen.getByRole('button', { name: 'Move Gamma left' });
    moveLeft.focus();

    fireEvent.click(moveLeft);

    // The same button element (keyed by the chip value) is still mounted.
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Move Gamma left"]'));
  });
});
