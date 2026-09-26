import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ExplicitTitle } from './ExplicitTitle.js';

afterEach(() => {
  cleanup();
});

describe('ExplicitTitle', () => {
  it('renders the title without a badge when explicit is false', () => {
    render(<ExplicitTitle title="Clean Song" explicit={false} />);
    expect(screen.getByText('Clean Song')).toBeTruthy();
    expect(screen.queryByLabelText('Explicit')).toBeNull();
  });

  it('renders the title with an explicit badge', () => {
    render(<ExplicitTitle title="Explicit Song" explicit />);
    expect(screen.getByText('Explicit Song')).toBeTruthy();
    expect(screen.getByLabelText('Explicit')).toBeTruthy();
  });

  it('renders ReactNode children with an explicit badge', () => {
    render(
      <ExplicitTitle explicit>
        <a href="/tracks/1">Linked Song</a>
      </ExplicitTitle>,
    );
    expect(screen.getByRole('link', { name: 'Linked Song' })).toBeTruthy();
    expect(screen.getByLabelText('Explicit')).toBeTruthy();
  });

  it('applies a blur class when explicit and blur are true', () => {
    const { container } = render(<ExplicitTitle title="Explicit Song" explicit blur />);
    expect((container.firstChild as HTMLElement).className.includes('blur-sm')).toBe(true);
  });

  it('does not blur when only explicit is true', () => {
    const { container } = render(<ExplicitTitle title="Explicit Song" explicit />);
    expect((container.firstChild as HTMLElement).className.includes('blur-sm')).toBe(false);
  });
});
