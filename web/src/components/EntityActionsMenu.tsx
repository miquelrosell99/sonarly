import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js';
import type { ContextMenuSection } from './ItemContextMenu.js';

interface EntityActionsMenuProps {
  sections: ContextMenuSection[];
  /** Accessible name for the trigger button. */
  label?: string;
}

// Click-triggered "..." menu for entity headers. Renders the same
// ContextMenuSection[] the right-click ItemContextMenu uses, but from a
// visible button (the header keeps only the primary action inline).
// Composed on the normalized catalog dropdown-menu (migration 2026-10-19,
// retiring usePopoverMenu): Radix owns open state, focus restore, typeahead,
// and the Escape-swallow convention lives in the catalog content wrapper.
export function EntityActionsMenu({ sections, label = 'More actions' }: EntityActionsMenuProps) {
  const visibleSections = sections.filter((section) => section.items.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <Icon name="mdi-dots-horizontal" size={18} />
        </button>
      </DropdownMenuTrigger>
      {visibleSections.length > 0 && (
        <DropdownMenuContent align="end" aria-label={label}>
          {visibleSections.map((section, sIdx) => (
            <div key={sIdx}>
              {section.title && <DropdownMenuLabel>{section.title}</DropdownMenuLabel>}
              {section.items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled || item.loading}
                  onSelect={() => void item.onClick()}
                  className={cn(
                    item.variant === 'danger' && 'text-error',
                    item.active && 'text-primary',
                  )}
                >
                  {item.loading ? (
                    <Icon name="mdi-loading" size={18} className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    item.icon && <Icon name={item.icon} size={18} />
                  )}
                  {item.label}
                  {item.active && <Icon name="mdi-check" size={16} className="ml-auto text-primary" />}
                </DropdownMenuItem>
              ))}
              {sIdx < visibleSections.length - 1 && <DropdownMenuSeparator />}
            </div>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
