import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LibrarySelector } from './LibrarySelector.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const libraries = [{
  id: 'lib-1',
  name: 'Main',
  path: '/music',
  organizePattern: '{artist}/{album}/{title}',
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}];

function renderSelector(error?: string | null) {
  const onSelect = vi.fn();
  render(
    <LibrarySelector
      libraries={libraries}
      selectedLibraryId={null}
      onSelect={onSelect}
      error={error}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /library:/i }));
  return onSelect;
}

describe('LibrarySelector', () => {
  it('renders a disabled "Libraries unavailable" item when the load failed', () => {
    renderSelector('Could not reach the server');

    const item = screen.getByText('Libraries unavailable');
    expect(item.getAttribute('role')).toBe('option');
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  it('renders the configured libraries without an error item', () => {
    renderSelector(null);

    expect(screen.getByText('Main')).toBeTruthy();
    expect(screen.queryByText('Libraries unavailable')).toBeNull();
  });
});
