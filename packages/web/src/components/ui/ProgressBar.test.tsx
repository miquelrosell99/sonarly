import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressBar } from './ProgressBar.js';

describe('ProgressBar', () => {
  it('renders fill width for 50%', () => {
    const { container } = render(<ProgressBar value={50} />);
    const fill = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(fill.getAttribute('aria-valuenow')).toBe('50');
  });

  it('clamps values outside 0-100', () => {
    const { container: over } = render(<ProgressBar value={150} />);
    expect((over.querySelector('[role="progressbar"]') as HTMLElement).style.width).toBe('100%');

    const { container: under } = render(<ProgressBar value={-10} />);
    expect((under.querySelector('[role="progressbar"]') as HTMLElement).style.width).toBe('0%');
  });
});
