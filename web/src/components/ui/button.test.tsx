import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Button } from './button.js';

// At-least-a-square ruling (fleet, shipped in notees 2026-10-28): a button's
// visible box must never be taller than it is wide — each size carries a
// min-width utility riding the SAME spacing token as its height utility.
afterEach(cleanup);

describe('Button square floor', () => {
  it.each([
    ['default', 'h-10', 'min-w-10'],
    ['sm', 'h-8', 'min-w-8'],
    ['lg', 'h-12', 'min-w-12'],
  ] as const)('size %s carries the height-matching min-width floor', (size, heightClass, minWidthClass) => {
    render(
      <Button size={size} data-testid="btn">
        Go
      </Button>,
    );

    const button = screen.getByTestId('btn');
    expect(button.className).toContain(heightClass);
    expect(button.className).toContain(minWidthClass);
  });

  it('icon size is square by construction (fixed w-10 against h-10)', () => {
    render(<Button size="icon" aria-label="Close" data-testid="btn" />);

    const button = screen.getByTestId('btn');
    expect(button.className).toContain('h-10');
    expect(button.className).toContain('w-10');
  });
});
