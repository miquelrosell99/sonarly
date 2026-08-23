import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'danger';
  onClick: () => void | Promise<void>;
}

export interface ContextMenuSection {
  title?: string;
  items: ContextMenuItem[];
}

interface ItemContextMenuProps {
  sections: ContextMenuSection[];
  children: ReactNode;
  anchorToTrigger?: boolean;
  placement?: 'top-end' | 'bottom-start';
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function clampPointer(value: number, max: number) {
  return clamp(value, 8, max - 8);
}

function computeAnchorPosition(
  trigger: HTMLElement,
  menu: HTMLElement,
  placement: 'top-end' | 'bottom-start',
) {
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  let top: number;
  let left: number;

  if (placement === 'top-end') {
    top = triggerRect.top - menuRect.height - margin;
    left = triggerRect.right - menuRect.width;
  } else {
    top = triggerRect.bottom + margin;
    left = triggerRect.left;
  }

  left = clamp(left, margin, window.innerWidth - menuRect.width - margin);
  top = clamp(top, margin, window.innerHeight - menuRect.height - margin);

  return { top, left };
}

export function ItemContextMenu({ sections, children, anchorToTrigger = false, placement = 'top-end' }: ItemContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const childRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideChild = childRef.current?.contains(target) ?? false;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      if (!insideChild && !insideMenu) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        childRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleMouse);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleMouse);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorToTrigger) return;
    const trigger = childRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const { top, left } = computeAnchorPosition(trigger, menu, placement);
    setPos({ x: left, y: top });
  }, [open, anchorToTrigger, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const firstItem = menu.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    firstItem?.focus();
  }, [open]);

  const focusMenuItem = (direction: 1 | -1) => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusMenuItem(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusMenuItem(-1);
    }
  };

  const visibleSections = sections?.filter((section) => section.items.length > 0) ?? [];
  if (visibleSections.length === 0) {
    return <>{children}</>;
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    childRef.current = e.currentTarget as HTMLElement;
    if (anchorToTrigger) {
      setOpen(true);
      return;
    }
    const x = clampPointer(e.clientX, window.innerWidth);
    const y = clampPointer(e.clientY, window.innerHeight);
    setPos({ x, y });
    setOpen(true);
  };

  const child = Children.only(children);
  if (!isValidElement(child)) {
    return <>{children}</>;
  }

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      style={{ top: pos.y, left: pos.x }}
      onKeyDown={handleMenuKeyDown}
      className={cn(
        'fixed z-50 min-w-[10rem] rounded-md border border-rule bg-surface py-1 shadow-lg',
      )}
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
                setOpen(false);
                childRef.current?.focus();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none',
                item.disabled && 'opacity-50 cursor-not-allowed',
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
    </div>
  ) : null;

  return (
    <>
      {cloneElement(child as ReactElement<{ onContextMenu?: (e: React.MouseEvent) => void }>, {
        onContextMenu: handleContextMenu,
      })}
      {menu && createPortal(menu, document.body)}
    </>
  );
}
