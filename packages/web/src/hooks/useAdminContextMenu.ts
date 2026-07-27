import { useMemo } from 'react';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';

export function useAdminContextMenu(sections: ContextMenuSection[], isAdmin: boolean): ContextMenuSection[] {
  return useMemo(() => {
    if (isAdmin) return sections;
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.id !== 'edit'),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, isAdmin]);
}
