import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Table, type TableColumn } from './Table.js';

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

const columns: TableColumn<Item>[] = [
  { key: 'title', header: 'Title', render: (item) => item.title },
  { key: 'artist', header: 'Artist', render: (item) => item.artist },
];

afterEach(() => {
  cleanup();
});

function renderTable(props: Partial<React.ComponentProps<typeof Table<Item>>> = {}) {
  return render(
    <Table<Item>
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
      {...props}
    />,
  );
}

function getRowByText(text: string): HTMLElement {
  const cell = screen.getByText(text);
  return cell.closest('tr') as HTMLElement;
}

describe('Table', () => {
  it('renders rows', () => {
    renderTable();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Artist B')).toBeTruthy();
  });

  it('shows empty message when there are no rows', () => {
    renderTable({ rows: [], empty: 'Nothing here' });
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('does not select rows when onPlaySelection is not provided', () => {
    renderTable();
    const alphaRow = getRowByText('Alpha');
    fireEvent.click(alphaRow);
    expect(alphaRow.getAttribute('aria-selected')).toBeNull();
  });

  it('selects a row on click when selectable', () => {
    renderTable({ onPlaySelection: vi.fn() });
    const alphaRow = getRowByText('Alpha');
    fireEvent.click(alphaRow);
    expect(alphaRow.getAttribute('aria-selected')).toBe('true');
  });

  it('toggles selection with ctrl+click', () => {
    renderTable({ onPlaySelection: vi.fn() });
    const alphaRow = getRowByText('Alpha');
    const betaRow = getRowByText('Beta');

    fireEvent.click(alphaRow);
    fireEvent.click(betaRow, { ctrlKey: true });

    expect(alphaRow.getAttribute('aria-selected')).toBe('true');
    expect(betaRow.getAttribute('aria-selected')).toBe('true');
  });

  it('selects a range with shift+click', () => {
    renderTable({ onPlaySelection: vi.fn() });
    const alphaRow = getRowByText('Alpha');
    const deltaRow = getRowByText('Delta');

    fireEvent.click(alphaRow);
    fireEvent.click(deltaRow, { shiftKey: true });

    expect(alphaRow.getAttribute('aria-selected')).toBe('true');
    expect(getRowByText('Beta').getAttribute('aria-selected')).toBe('true');
    expect(getRowByText('Gamma').getAttribute('aria-selected')).toBe('true');
    expect(deltaRow.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onPlaySelection with selected rows on double-click', () => {
    const onPlaySelection = vi.fn();
    renderTable({ onPlaySelection });
    const alphaRow = getRowByText('Alpha');
    const betaRow = getRowByText('Beta');

    fireEvent.click(alphaRow);
    fireEvent.click(betaRow, { ctrlKey: true });
    fireEvent.doubleClick(alphaRow);

    expect(onPlaySelection).toHaveBeenCalledWith([items[0], items[1]], 0);
  });

  it('calls onPlaySelection on Enter key', () => {
    const onPlaySelection = vi.fn();
    renderTable({ onPlaySelection });
    const alphaRow = getRowByText('Alpha');

    fireEvent.click(alphaRow);
    fireEvent.keyDown(alphaRow, { key: 'Enter', code: 'Enter' });

    expect(onPlaySelection).toHaveBeenCalledWith([items[0]], 0);
  });

  it('clears selection on Escape', () => {
    renderTable({ onPlaySelection: vi.fn() });
    const alphaRow = getRowByText('Alpha');
    const container = screen.getByRole('table');

    fireEvent.click(alphaRow);
    expect(alphaRow.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(container, { key: 'Escape', code: 'Escape' });
    expect(alphaRow.getAttribute('aria-selected')).toBe('false');
  });

  it('calls onPlay when the hover play button is clicked', () => {
    const onPlay = vi.fn();
    renderTable({ onPlay, onPlaySelection: vi.fn() });

    fireEvent.click(screen.getAllByRole('button', { name: /play/i })[0]);
    expect(onPlay).toHaveBeenCalledWith(items[0]);
  });

  it('calls onShufflePlay when the hover play button is held', () => {
    const onPlay = vi.fn();
    const onShufflePlay = vi.fn();
    vi.useFakeTimers();
    renderTable({ onPlay, onShufflePlay, onPlaySelection: vi.fn() });

    const playButton = screen.getAllByRole('button', { name: /play/i })[0];
    fireEvent.pointerDown(playButton);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(playButton);

    expect(onShufflePlay).toHaveBeenCalledTimes(1);
    expect(onShufflePlay).toHaveBeenCalledWith(items[0]);
    expect(onPlay).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('highlights the title cell of the currently playing row', () => {
    renderTable({ playingId: '2', onPlaySelection: vi.fn() });
    const betaTitle = screen.getByText('Beta');
    expect(betaTitle.className).toContain('text-accent');

    const alphaTitle = screen.getByText('Alpha');
    expect(alphaTitle.className).not.toContain('text-accent');
  });

  it('renders custom index labels when getIndexLabel is provided', () => {
    renderTable({
      onPlay: vi.fn(),
      indexPad: 2,
      getIndexLabel: (item) => (item.id === '2' ? 5 : undefined),
    });
    const rows = screen.getAllByRole('row');
    // rows[0] is the header; data rows follow in original order.
    expect(rows[1].textContent).toContain('01');
    expect(rows[2].textContent).toContain('05');
    expect(rows[3].textContent).toContain('03');
  });

  it('renders group headers when groupBy is provided', () => {
    renderTable({
      onPlaySelection: vi.fn(),
      groupBy: (item) => (item.id === '1' || item.id === '2' ? 'A' : 'B'),
    });
    expect(screen.getAllByText('A')).toHaveLength(1);
    expect(screen.getAllByText('B')).toHaveLength(1);
    expect(screen.getByText('Alpha').closest('tr')?.previousElementSibling?.textContent).toBe('A');
    expect(screen.getByText('Gamma').closest('tr')?.previousElementSibling?.textContent).toBe('B');
  });

  it('renders custom group headers when renderGroupHeader is provided', () => {
    renderTable({
      onPlaySelection: vi.fn(),
      groupBy: (item) => (item.id === '1' || item.id === '2' ? 'A' : 'B'),
      renderGroupHeader: (key) => `Group ${key}`,
    });
    expect(screen.getByText('Group A')).toBeTruthy();
    expect(screen.getByText('Group B')).toBeTruthy();
  });
});
