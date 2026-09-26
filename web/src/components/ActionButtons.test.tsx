import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FavoriteButton, StarRating } from './ActionButtons.js';

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

describe('StarRating', () => {
  it('renders a half-star icon for half ratings', () => {
    render(<StarRating rating={3.5} onRate={vi.fn()} />);
    const useElements = screen.getAllByRole('button').map((b) => b.querySelector('use'));
    expect(useElements[0]?.getAttribute('href')).toContain('mdi-star');
    expect(useElements[1]?.getAttribute('href')).toContain('mdi-star');
    expect(useElements[2]?.getAttribute('href')).toContain('mdi-star');
    expect(useElements[3]?.getAttribute('href')).toContain('mdi-star-half-full');
    expect(useElements[4]?.getAttribute('href')).toContain('mdi-star-outline');
  });

  it('selects a full star when clicked on the right half', () => {
    const onRate = vi.fn();
    render(<StarRating rating={0} onRate={onRate} />);
    const star3 = screen.getByRole('button', { name: /rate 3 stars/i });
    vi.spyOn(star3, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      top: 0,
      left: 0,
      right: 24,
      bottom: 24,
      toJSON: () => undefined,
    });
    fireEvent.click(star3, { clientX: 20, detail: 1 });
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it('selects a half star when clicked on the left half', () => {
    const onRate = vi.fn();
    render(<StarRating rating={0} onRate={onRate} />);
    const star3 = screen.getByRole('button', { name: /rate 3 stars/i });
    vi.spyOn(star3, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      top: 0,
      left: 0,
      right: 24,
      bottom: 24,
      toJSON: () => undefined,
    });
    fireEvent.click(star3, { clientX: 4, detail: 1 });
    expect(onRate).toHaveBeenCalledWith(2.5);
  });

  it('selects the full star for keyboard-origin clicks (detail 0)', () => {
    const onRate = vi.fn();
    render(<StarRating rating={0} onRate={onRate} />);
    const star3 = screen.getByRole('button', { name: /rate 3 stars/i });
    fireEvent.click(star3, { detail: 0 });
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it('clears the rating when the current value is clicked', () => {
    const onRate = vi.fn();
    render(<StarRating rating={3} onRate={onRate} />);
    const star3 = screen.getByRole('button', { name: /rate 3 stars/i });
    vi.spyOn(star3, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      top: 0,
      left: 0,
      right: 24,
      bottom: 24,
      toJSON: () => undefined,
    });
    fireEvent.click(star3, { clientX: 20 });
    expect(onRate).toHaveBeenCalledWith(0);
  });
});
