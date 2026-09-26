import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NotificationProvider, useNotification } from './NotificationContext.js';

// jsdom has neither matchMedia nor WAAPI (Element.prototype.animate), and
// NotificationItem only guards on the former — stub the animations it drives.
beforeAll(() => {
  Element.prototype.animate = vi.fn().mockReturnValue({
    cancel: vi.fn(),
    play: vi.fn(),
    set onfinish(_handler: (() => void) | null) {
      // Never fires in tests; the exit animation's completion callback.
    },
  }) as unknown as typeof Element.prototype.animate;
});

function FireButtons() {
  const { notify } = useNotification();
  return (
    <>
      <button onClick={() => notify('Link copied', 'success')}>fire success</button>
      <button onClick={() => notify('Playback stalled', 'error')}>fire error</button>
      <button onClick={() => notify('Heads up')}>fire info</button>
    </>
  );
}

function renderProvider() {
  return render(
    <NotificationProvider>
      <FireButtons />
    </NotificationProvider>,
  );
}

afterEach(cleanup);

describe('NotificationProvider toast roles (F26)', () => {
  it('renders error toasts as assertive alerts', () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'fire error' }));

    expect(screen.getByRole('alert').textContent).toContain('Playback stalled');
  });

  it('renders success and info toasts as polite status', () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'fire success' }));
    fireEvent.click(screen.getByRole('button', { name: 'fire info' }));

    // No assertive alert in the tree...
    expect(screen.queryByRole('alert')).toBeNull();
    // ...and both polite toasts are exposed.
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    expect(statuses[0].textContent).toContain('Link copied');
    expect(statuses[1].textContent).toContain('Heads up');
  });
});
