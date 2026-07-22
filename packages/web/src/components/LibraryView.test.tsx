import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Router } from 'wouter';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from './LibraryView.js';

interface Item {
  id: string;
  title: string;
  artist: string;
}

const items: Item[] = [
  { id: '1', title: 'Alpha', artist: 'Artist A' },
  { id: '2', title: 'Beta', artist: 'Artist B' },
];

const columns: LibraryViewColumn<Item>[] = [
  { key: 'title', header: 'Title', render: (item) => item.title },
  { key: 'artist', header: 'Artist', render: (item) => item.artist },
];

const cardFields: LibraryViewCardField<Item>[] = [
  { key: 'title', render: (item) => item.title },
  { key: 'artist', render: (item) => item.artist },
];

afterEach(() => {
  cleanup();
});

function renderView(props: Partial<React.ComponentProps<typeof LibraryView<Item>>> = {}) {
  return render(
    <Router>
      <LibraryView<Item>
        title="Test Library"
        data={items}
        columns={columns}
        cardFields={cardFields}
        getId={(item) => item.id}
        getHref={(item) => `/items/${item.id}`}
        {...props}
      />
    </Router>,
  );
}

describe('LibraryView', () => {
  it('renders an empty state when data is empty', () => {
    const { container } = renderView({ data: [], emptyMessage: 'Nothing to see here' });
    expect(screen.getByText('Nothing to see here')).toBeTruthy();
    expect(container.querySelector('table')).toBeFalsy();
  });

  it('renders list view by default and toggles to grid view', () => {
    const { container } = renderView();

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('.grid')).toBeFalsy();
    expect(screen.getByText('Alpha')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /grid view/i })[0]);

    expect(container.querySelector('table')).toBeFalsy();
    expect(container.querySelector('.grid')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /list view/i })[0]);

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('.grid')).toBeFalsy();
  });

  it('calls onPlay when the row play button is clicked', () => {
    const onPlay = vi.fn();
    renderView({ onPlay });

    fireEvent.click(screen.getAllByRole('button', { name: /play/i })[0]);
    expect(onPlay).toHaveBeenCalledWith(items[0]);
  });

  it('calls onPlay when the grid card play button is clicked', () => {
    const onPlay = vi.fn();
    const { container } = renderView({ onPlay });

    fireEvent.click(screen.getAllByRole('button', { name: /grid view/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /play/i })[0]);
    expect(onPlay).toHaveBeenCalledWith(items[0]);
    expect(container.querySelector('.grid')).toBeTruthy();
  });
});
