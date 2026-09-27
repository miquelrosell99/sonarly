import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { usePopoverMenu } from './ui/usePopoverMenu.js';
import type { ContextMenuSection } from './ItemContextMenu.js';

interface EntityActionsMenuProps {
  sections: ContextMenuSection[];
  /** Accessible name for the trigger button. */
  label?: string;
}

// Click-triggered "..." menu for entity headers. Renders the same
// ContextMenuSection[] the right-click ItemContextMenu uses, but from a
// visible button (the header keeps only the primary action inline).
export function EntityActionsMenu({ sections, label = 'More actions' }: EntityActionsMenuProps) {
  const menu = usePopoverMenu<HTMLButtonElement>();
  const visibleSections = sections.filter((section) => section.items.length > 0);

  return (
    <>
      <button
        ref={menu.triggerRef}
        type="button"
        {...menu.triggerProps}
        aria-label={label}
        title={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary"
      >
        <Icon name="mdi-dots-horizontal" size={18} />
      </button>
      {menu.open && visibleSections.length > 0 &&
        createPortal(
          <div
            ref={menu.menuRef}
            {...menu.menuProps}
            aria-label={label}
            className="fixed z-50 min-w-[12rem] rounded-md border border-rule bg-surface py-1 shadow-lg"
          >
            {visibleSections.map((section, sIdx) => (
              <div key={sIdx}>
                {section.title && <div className="px-3 py-1 text-xs font-medium text-muted">{section.title}</div>}
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled || item.loading}
                    onClick={async () => {
                      await item.onClick();
                      menu.closeMenu(true);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none',
                      item.disabled && 'cursor-not-allowed opacity-50',
                      item.variant === 'danger' && 'text-danger',
                      item.active && 'text-accent',
                    )}
                  >
                    {item.loading ? (
                      <Icon name="mdi-loading" size={18} className="animate-spin motion-reduce:animate-none" />
                    ) : (
                      item.icon && <Icon name={item.icon} size={18} />
                    )}
                    {item.label}
                    {item.active && <Icon name="mdi-check" size={16} className="ml-auto text-accent" />}
                  </button>
                ))}
                {sIdx < visibleSections.length - 1 && <hr role="separator" className="my-1 border-rule" />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
