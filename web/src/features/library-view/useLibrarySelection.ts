import { useState, type KeyboardEvent, type MouseEvent } from 'react';

export interface LibrarySelection<T> {
  selectable: boolean;
  selectedIds: Set<string>;
  clearSelection: () => void;
  handleRowSelect: (item: T, e: MouseEvent) => void;
  handleRowActivate: (item: T) => void;
  handleContainerKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Selection is an affordance OF play-selection: rows only highlight and
 * select when the page can act on a selection (double-click/Enter plays
 * it) — aligning with Table's `selectable = Boolean(onPlaySelection)` so
 * pages without it don't show a dead selection affordance (audit F23/F28).
 */
export function useLibrarySelection<T>(
  data: T[],
  getId: (item: T) => string,
  onPlaySelection?: (items: T[], startIndex: number) => void,
): LibrarySelection<T> {
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
    const fromIndex = data.findIndex((item) => getId(item) === fromId);
    const toIndex = data.findIndex((item) => getId(item) === toId);
    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const next = new Set<string>();
    for (let i = start; i <= end; i++) {
      next.add(getId(data[i]));
    }
    setSelectedIds(next);
    setLastSelectedId(toId);
  };

  const handleRowSelect = (item: T, e: MouseEvent) => {
    if (!selectable) return;
    const id = getId(item);
    if (e.shiftKey && lastSelectedId) {
      selectRange(lastSelectedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelection(id);
    } else {
      selectOnly(id);
    }
  };

  const handleRowActivate = (item: T) => {
    if (!onPlaySelection) return;
    const id = getId(item);
    const selected = selectedIds.size > 0 ? data.filter((d) => selectedIds.has(getId(d))) : [item];
    const startIndex = selected.findIndex((d) => getId(d) === id);
    const safeStart = startIndex === -1 ? 0 : startIndex;
    onPlaySelection(selected, safeStart);
  };

  const handleContainerKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      clearSelection();
    }
  };

  return { selectable, selectedIds, clearSelection, handleRowSelect, handleRowActivate, handleContainerKeyDown };
}
