import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Router } from 'wouter';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from './LibraryView.js';
import { COLUMN_CONFIG_STORAGE_KEY } from '../hooks/useColumnConfig.js';

interface Item {
  id: string;
  title: string;
  artist: string;
  duration: string;
}

const items: Item[] = [
  { id: '1', title: 'Alpha', artist: 'Artist A', duration: '3:00' },
  { id: '2', title: 'Beta', artist: 'Artist B', duration: '4:00' },
];

const columns: LibraryViewColumn<Item>[] = [
  { key: 'title', header: 'Title', render: (item) => item.title },
  { key: 'artist', header: 'Artist', render: (item) => item.artist },
  { key: 'duration', header: 'Duration', render: (item) => item.duration },
];

const cardFields: LibraryViewCardField<Item>[] = [
  { key: 'title', render: (item) => item.title },
  { key: 'artist', render: (item) => item.artist },
];

function renderView(props: Partial<React.ComponentProps<typeof LibraryView<Item>>> = {}) {
  return render(
    <Router>
      <LibraryView<Item>
        data={items}
        columns={columns}
        cardFields={cardFields}
        getId={(item) => item.id}
        getHref={(item) => `/items/${item.id}`}
        columnConfigKey="lv-test"
        {...props}
      />
    </Router>,
  );
}

function headerTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('LibraryView column configurator', () => {
  it('renders the natural column set with a gear affordance', () => {
    const { container } = renderView();

    expect(headerTexts(container)).toEqual(['#', 'Title', 'Artist', 'Duration']);
    expect(screen.getByRole('button', { name: 'Configure columns' })).toBeTruthy();
  });

  it('hides a column from the header and the rows via the popover toggle', () => {
    const { container } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Duration column' }));

    expect(headerTexts(container)).toEqual(['#', 'Title', 'Artist']);
    expect(screen.queryByText('3:00')).toBeNull();
    expect(screen.getByText('Artist A')).toBeTruthy();
  });

  it('shows a hidden column again when its toggle is clicked twice', () => {
    const { container } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Duration column' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Duration column' }));

    expect(headerTexts(container)).toEqual(['#', 'Title', 'Artist', 'Duration']);
  });

  it('reorders columns via the move buttons and the table follows', () => {
    const { container } = renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Duration up' }));

    expect(headerTexts(container)).toEqual(['#', 'Title', 'Duration', 'Artist']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Duration up' }));
    expect(headerTexts(container)).toEqual(['#', 'Duration', 'Title', 'Artist']);
  });

  it('never hides the locked title column: toggle disabled, poisoned storage ignored', () => {
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    expect(screen.getByRole('checkbox', { name: 'Title column' })).toHaveProperty('disabled', true);

    window.localStorage.setItem(
      COLUMN_CONFIG_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        views: { 'lv-test': { order: ['title', 'artist', 'duration'], hidden: ['title'] } },
      }),
    );
    cleanup();
    const second = renderView();
    expect(headerTexts(second.container)).toEqual(['#', 'Title', 'Artist', 'Duration']);
  });

  it('lists the row actions column as locked in the popover', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));

    expect(screen.getByRole('checkbox', { name: 'Row actions column' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Move Row actions up' })).toBeNull();
  });

  it('persists the configuration across remounts (round-trip)', () => {
    const first = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Duration column' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Artist up' }));
    first.unmount();

    const second = renderView();
    expect(headerTexts(second.container)).toEqual(['#', 'Artist', 'Title']);
  });

  it('keeps views with different keys isolated', () => {
    const first = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Configure columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Duration column' }));
    first.unmount();

    const second = renderView({ columnConfigKey: 'lv-other' });
    expect(headerTexts(second.container)).toEqual(['#', 'Title', 'Artist', 'Duration']);
  });

  it('renders no configurator without a columnConfigKey', () => {
    const { container } = renderView({ columnConfigKey: undefined });
    expect(screen.queryByRole('button', { name: 'Configure columns' })).toBeNull();
    expect(headerTexts(container)).toEqual(['#', 'Title', 'Artist', 'Duration']);
  });
});
