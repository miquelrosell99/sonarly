import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NowPlayingCover } from './NowPlayingCover.js';

describe('NowPlayingCover', () => {
  it('renders cover image when coverArt is provided', () => {
    render(<NowPlayingCover coverArt="cover-1" alt="Test cover" />);
    const img = screen.getByAltText('Test cover');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/api/cover-art/cover-1');
  });

  it('renders fallback when coverArt is missing', () => {
    render(<NowPlayingCover alt="Missing cover" />);
    expect(screen.getByRole('img', { hidden: true })).toBeTruthy();
  });
});
