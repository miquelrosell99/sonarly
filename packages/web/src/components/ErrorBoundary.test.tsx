import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Throwing(): never {
  throw new Error('render exploded');
}

describe('ErrorBoundary (FF10)', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">fine</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeTruthy();
  });

  it('shows the reload fallback when a child throws', () => {
    // React logs the caught error; silence the noise for the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    const reload = screen.getByRole('button', { name: 'Reload' });
    expect(reload).toBeTruthy();
    expect(screen.queryByText('fine')).toBeFalsy();
  });

  it('logs the caught error via componentDidCatch', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
    );

    expect(spy).toHaveBeenCalledWith(
      'ErrorBoundary caught a render error',
      expect.any(Error),
      expect.anything(),
    );
  });
});
