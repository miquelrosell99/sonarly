/** APG menu typeahead for roving-focus menus: printable characters
 * accumulate into a buffer (reset after `RESET_MS` of inactivity) and focus
 * jumps to the next enabled menuitem whose trimmed label starts with the
 * buffer, cycling forward from the currently focused item. Shared by
 * ItemContextMenu. */
export interface MenuTypeahead {
  /** Feed a printable key; returns false when the key is not typeahead-able. */
  handleKey(key: string): boolean;
  /** Drop the accumulated buffer (menu close/open). */
  reset(): void;
}

const RESET_MS = 500;

export function createMenuTypeahead(getItems: () => HTMLElement[]): MenuTypeahead {
  let buffer = '';
  let timer: number | undefined;

  const reset = () => {
    window.clearTimeout(timer);
    buffer = '';
  };

  return {
    reset,
    handleKey(key: string): boolean {
      if (key.length !== 1) return false;
      window.clearTimeout(timer);
      buffer += key.toLowerCase();
      timer = window.setTimeout(reset, RESET_MS);
      const items = getItems();
      if (items.length === 0) return true;
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const ordered = items.map((_, i) => items[(currentIndex + i + 1) % items.length]);
      const match = ordered.find((item) =>
        (item.textContent ?? '').trim().toLowerCase().startsWith(buffer),
      );
      match?.focus();
      return true;
    },
  };
}
