import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FavoriteButton } from './ActionButtons.js';

afterEach(() => {
  cleanup();
});

describe('FavoriteButton', () => {
  it('is disabled when the disabled prop is true', () => {
    render(<FavoriteButton starred={false} onClick={vi.fn()} disabled />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(<FavoriteButton starred={false} onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
