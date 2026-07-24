import { Children, Fragment, useState, type MouseEvent, type KeyboardEvent, type ReactNode, type ReactElement, cloneElement, isValidElement } from 'react';
import { cn } from '../../lib/cn.js';
import { Icon } from './Icon.js';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onPlay?: (row: T) => void;
  onPlaySelection?: (rows: T[], startIndex: number) => void;
  playingId?: string;
  renderRow?: (row: T, element: ReactNode) => ReactNode;
}

function isInteractiveTarget(target: EventTarget, currentTarget: EventTarget) {
  let node: Node | null = target as Node;
  while (node && node !== currentTarget) {
    if (node instanceof Element) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'a' || tag === 'button' || node.getAttribute('role') === 'menuitem') {
        return true;
      }
    }
    node = node.parentNode;
  }
  return false;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  empty,
  onPlay,
  onPlaySelection,
  playingId,
  renderRow,
}: TableProps<T>) {
  const selectable = Boolean(onPlaySelection);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  };

  const selectOnly = (id: string) => {
    setSelectedIds(new Set([id]));
    setLastSelectedId(id);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  };

  const selectRange = (fromId: string, toId: string) => {
    const fromIndex = rows.findIndex((row) => rowKey(row) === fromId);
    const toIndex = rows.findIndex((row) => rowKey(row) === toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const next = new Set<string>();
    for (let i = start; i <= end; i++) {
      next.add(rowKey(rows[i]));
    }
    setSelectedIds(next);
    setLastSelectedId(toId);
  };

  const handleRowSelect = (row: T, e: MouseEvent) => {
    if (!selectable) return;
    const id = rowKey(row);
    if (e.shiftKey && lastSelectedId) {
      selectRange(lastSelectedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelection(id);
    } else {
      selectOnly(id);
    }
  };

  const handleRowActivate = (row: T) => {
    if (!onPlaySelection) return;
    const id = rowKey(row);
    const selected = selectedIds.size > 0
      ? rows.filter((r) => selectedIds.has(rowKey(r)))
      : [row];
    const startIndex = selected.findIndex((r) => rowKey(r) === id);
    const safeStart = startIndex === -1 ? 0 : startIndex;
    onPlaySelection(selected, safeStart);
  };

  const handleContainerKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      clearSelection();
    }
  };

  return (
    <div className="overflow-x-auto" onKeyDown={selectable ? handleContainerKeyDown : undefined} role={selectable ? 'grid' : undefined} aria-multiselectable={selectable ? 'true' : undefined}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-rule text-muted">
          <tr>
            {onPlay && <th className="w-12 py-2 pr-4 font-medium" aria-hidden />}
            {columns.map((col) => (
              <th key={col.key} className={cn('py-2 pr-4 font-medium', col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((row, index) => {
            const id = rowKey(row);
            const isSelected = selectable && selectedIds.has(id);
            const isPlayingTitle = playingId !== undefined && playingId === id;
            const cells = columns.map((col) => (
              <td key={col.key} className={cn('py-2 pr-4', col.className)}>
                {col.render(row)}
              </td>
            ));
            const titleCell = cells[0];
            const restCells = cells.slice(1);
            const highlightedTitle = isValidElement(titleCell)
              ? cloneElement(titleCell as React.ReactElement<{ className?: string }>, {
                  className: cn(
                    (titleCell.props as { className?: string }).className,
                    isPlayingTitle && 'text-accent',
                  ),
                })
              : titleCell;

            const tr = (
              <tr
                key={id}
                tabIndex={selectable ? 0 : undefined}
                aria-selected={selectable ? isSelected : undefined}
                className={cn(
                  'transition',
                  selectable && 'group cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  isSelected ? 'bg-surface-hover' : selectable ? 'hover:bg-surface-hover' : '',
                )}
                onClick={selectable ? (e) => {
                  if (isInteractiveTarget(e.target, e.currentTarget)) return;
                  handleRowSelect(row, e);
                } : undefined}
                onDoubleClick={selectable ? () => handleRowActivate(row) : undefined}
                onKeyDown={selectable ? (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRowActivate(row);
                  }
                } : undefined}
              >
                {onPlay && (
                  <td className="w-12 py-2 pr-4">
                    <span className="relative inline-flex h-5 w-6 items-center justify-center text-muted">
                      <span className="group-hover:opacity-0">{index + 1}</span>
                      <button
                        type="button"
                        className="absolute inset-0 inline-flex items-center justify-center text-accent opacity-0 hover:text-accent/80 focus-visible:outline-none group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlay(row);
                        }}
                        aria-label="Play"
                      >
                        <Icon name="mdi-play" size={18} />
                      </button>
                    </span>
                  </td>
                )}
                {highlightedTitle}
                {restCells}
              </tr>
            );

            return renderRow ? (
              <Fragment key={id}>{renderRow(row, tr)}</Fragment>
            ) : (
              tr
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && empty !== undefined && (
        <div className="py-8 text-center text-sm text-muted">{empty}</div>
      )}
    </div>
  );
}
