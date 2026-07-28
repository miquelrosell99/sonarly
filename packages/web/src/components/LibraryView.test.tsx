import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Router, Link, useLocation } from 'wouter';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from './LibraryView.js';

interface Item {
  id: string;
  title: string;
  artist: string;
}

const items: Item[] = [
  { id: '1', title: 'Alpha', artist: 'Artist A' },
  { id: '2', title: 'Beta', artist: 'Artist B' },
  { id: '3', title: 'Gamma', artist: 'Artist C' },
  { id: '4', title: 'Delta', artist: 'Artist D' },
];

const columns: LibraryViewColumn<Item>[] = [
  { key: 'title', header: 'Title', render: (item) => item.title },
  { key: 'artist', header: 'Artist', render: (item) => item.artist },
];

const cardFields: LibraryViewCardField<Item>[] = [
  { key: 'title', render: (item) => item.title },
  { key: 'artist', render: (item) => item.artist },
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function LocationDisplay() {
  const [location] = useLocation();
  return <div data-testid="location">{location}</div>;
}

function renderView(props: Partial<React.ComponentProps<typeof LibraryView<Item>>> = {}) {
  return render(
    <Router>
      <LocationDisplay />
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

function getRowByText(text: string): HTMLElement {
  const cell = screen.getByText(text);
  return cell.closest('tr') as HTMLElement;
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

    const playButton = screen.getAllByRole('button', { name: /play/i })[0];
    fireEvent.click(playButton);
    expect(onPlay).toHaveBeenCalledWith(items[0]);
  });

  it('calls onPlay when the grid card play button is clicked without navigating', () => {
    const onPlay = vi.fn();
    const { container } = renderView({ onPlay });

    fireEvent.click(screen.getAllByRole('button', { name: /grid view/i })[0]);
    const playButton = screen.getAllByRole('button', { name: /play/i })[0];
    fireEvent.click(playButton);
    expect(onPlay).toHaveBeenCalledWith(items[0]);
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(container.querySelector('.grid')).toBeTruthy();
  });

  it('selects a row on click and deselects others', () => {
    renderView();
    const alphaRow = getRowByText('Alpha');
    const betaRow = getRowByText('Beta');

    fireEvent.click(alphaRow);
    expect(alphaRow.getAttribute('aria-selected')).toBe('true');
    expect(betaRow.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(betaRow);
    expect(alphaRow.getAttribute('aria-selected')).toBe('false');
    expect(betaRow.getAttribute('aria-selected')).toBe('true');
  });

  it('does not select when clicking the title link, allowing navigation', () => {
    const linkedColumns: LibraryViewColumn<Item>[] = [
      { key: 'title', header: 'Title', render: (item) => <Link href={`/items/${item.id}`}>{item.title}</Link> },
      { key: 'artist', header: 'Artist', render: (item) => item.artist },
    ];
    renderView({ columns: linkedColumns });
    const alphaTitle = screen.getByText('Alpha');
    const alphaRow = alphaTitle.closest('tr') as HTMLElement;

    fireEvent.click(alphaTitle);
    expect(alphaRow.getAttribute('aria-selected')).toBe('false');
  });

  it('toggles row selection with ctrl+click', () => {
    renderView();
    const alphaRow = getRowByText('Alpha');
    const betaRow = getRowByText('Beta');

    fireEvent.click(alphaRow);
    fireEvent.click(betaRow, { ctrlKey: true });

    expect(alphaRow.getAttribute('aria-selected')).toBe('true');
    expect(betaRow.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(alphaRow, { ctrlKey: true });
    expect(alphaRow.getAttribute('aria-selected')).toBe('false');
    expect(betaRow.getAttribute('aria-selected')).toBe('true');
  });

  it('selects a contiguous range with shift+click', () => {
    renderView();
    const alphaRow = getRowByText('Alpha');
    const gammaRow = getRowByText('Gamma');
    const deltaRow = getRowByText('Delta');

    fireEvent.click(alphaRow);
    fireEvent.click(deltaRow, { shiftKey: true });

    expect(alphaRow.getAttribute('aria-selected')).toBe('true');
    expect(getRowByText('Beta').getAttribute('aria-selected')).toBe('true');
    expect(gammaRow.getAttribute('aria-selected')).toBe('true');
    expect(deltaRow.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onPlaySelection with selected items on double-click', () => {
    const onPlaySelection = vi.fn();
    renderView({ onPlaySelection });
    const alphaRow = getRowByText('Alpha');
    const betaRow = getRowByText('Beta');

    fireEvent.click(alphaRow);
    fireEvent.click(betaRow, { ctrlKey: true });
    fireEvent.doubleClick(alphaRow);

    expect(onPlaySelection).toHaveBeenCalledWith([items[0], items[1]], 0);
  });

  it('calls onPlaySelection with the activated item alone when nothing is selected', () => {
    const onPlaySelection = vi.fn();
    renderView({ onPlaySelection });
    const betaRow = getRowByText('Beta');

    fireEvent.doubleClick(betaRow);
    expect(onPlaySelection).toHaveBeenCalledWith([items[1]], 0);
  });

  it('calls onPlaySelection when Enter is pressed on a focused row', () => {
    const onPlaySelection = vi.fn();
    renderView({ onPlaySelection });
    const alphaRow = getRowByText('Alpha');

    fireEvent.click(alphaRow);
    fireEvent.keyDown(alphaRow, { key: 'Enter', code: 'Enter' });

    expect(onPlaySelection).toHaveBeenCalledWith([items[0]], 0);
  });

  it('clears selection on Escape', () => {
    renderView();
    const alphaRow = getRowByText('Alpha');
    const container = screen.getByRole('grid');

    fireEvent.click(alphaRow);
    expect(alphaRow.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(container, { key: 'Escape', code: 'Escape' });
    expect(alphaRow.getAttribute('aria-selected')).toBe('false');
  });

  it('highlights the title cell of the currently playing item', () => {
    renderView({ playingId: '2' });
    const betaTitle = screen.getByText('Beta');
    expect(betaTitle.className).toContain('text-accent');

    const alphaTitle = screen.getByText('Alpha');
    expect(alphaTitle.className).not.toContain('text-accent');
  });

  it('calls onShufflePlay with the full data array when the row play button is held', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    renderView({ onPlay, onShufflePlay });

    const playButton = screen.getAllByRole('button', { name: /Play \(hold to shuffle\)/, hidden: true })[0];
    fireEvent.pointerDown(playButton);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(playButton);

    expect(onShufflePlay).toHaveBeenCalledTimes(1);
    expect(onShufflePlay).toHaveBeenCalledWith(items);
  });

  it('calls onShufflePlay with the full data array when the grid card play button is held', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    renderView({ onPlay, onShufflePlay });

    fireEvent.click(screen.getAllByRole('button', { name: /grid view/i })[0]);
    const playButton = screen.getAllByRole('button', { name: /Play \(hold to shuffle\)/, hidden: true })[0];
    fireEvent.pointerDown(playButton);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(playButton);

    expect(onShufflePlay).toHaveBeenCalledTimes(1);
    expect(onShufflePlay).toHaveBeenCalledWith(items);
  });

  it('renders drag handles when sortable is enabled', () => {
    renderView({ sortable: true, onReorder: vi.fn() });
    const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i });
    expect(dragHandles).toHaveLength(items.length);
  });

  it('does not render drag handles when sortable is disabled', () => {
    renderView();
    const dragHandles = screen.queryAllByRole('button', { name: /drag to reorder/i });
    expect(dragHandles).toHaveLength(0);
  });

  it('still renders row play buttons when sortable is enabled', () => {
    const onPlay = vi.fn();
    renderView({ sortable: true, onReorder: vi.fn(), onPlay });
    const playButtons = screen.getAllByRole('button', { name: /play/i });
    expect(playButtons.length).toBeGreaterThanOrEqual(items.length);
    fireEvent.click(playButtons[0]);
    expect(onPlay).toHaveBeenCalledWith(items[0]);
  });
});
