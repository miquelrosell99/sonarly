import { Children, cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';
import { computePointerMenuPosition, type Point } from '../lib/menuPosition.js';
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
  /** Also open the menu after a ~500ms touch/pen press on the trigger. */
  openOnLongPress?: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
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

export function ItemContextMenu({ sections, children, anchorToTrigger = false, placement = 'top-end', openOnLongPress = false }: ItemContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const childRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);
  // Set when the menu was opened from the keyboard (Shift+F10 / Menu key):
  // there is no pointer position, so the menu anchors below the trigger.
  const openedFromKeyboardRef = useRef(false);
  // Pointer position for pointer/long-press opens; the layout effect
  // measures the menu and clamps/flips around it before paint.
  const pointerPosRef = useRef<Point | null>(null);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  useEffect(() => cancelLongPress, []);

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

  const positionMenu = useCallback(() => {
    const trigger = childRef.current;
    const menu = menuRef.current;
    if (!menu) return;
    const menuRect = menu.getBoundingClientRect();
    const menuSize = { width: menuRect.width, height: menuRect.height };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (anchorToTrigger && trigger) {
      const { top, left } = computeAnchorPosition(trigger, menu, placement);
      setPos({ x: left, y: top });
    } else if (openedFromKeyboardRef.current && trigger) {
      // Keyboard opens have no pointer position; anchor below the trigger.
      const { top, left } = computeAnchorPosition(trigger, menu, 'bottom-start');
      setPos({ x: left, y: top });
    } else if (pointerPosRef.current) {
      const { x, y } = computePointerMenuPosition(pointerPosRef.current, menuSize, viewport);
      setPos({ x, y });
    }
  }, [anchorToTrigger, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
  }, [open, positionMenu]);

  // Re-clamp when the menu resizes while open (e.g. a loading item swaps
  // its icon for a spinner, or sections change).
  useEffect(() => {
    if (!open || typeof ResizeObserver === 'undefined') return;
    const menu = menuRef.current;
    if (!menu) return;
    const observer = new ResizeObserver(() => positionMenu());
    observer.observe(menu);
    return () => observer.disconnect();
  }, [open, positionMenu]);

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
    openedFromKeyboardRef.current = false;
    if (anchorToTrigger) {
      setOpen(true);
      return;
    }
    pointerPosRef.current = { x: e.clientX, y: e.clientY };
    setPos({ x: e.clientX, y: e.clientY });
    setOpen(true);
  };

  // FF11: keyboard path to open the menu on the wrapped trigger — the Menu
  // key (Windows) or Shift+F10 (the platform context-menu shortcut). Escape
  // close and arrow-key navigation already live on the menu itself.
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
    e.preventDefault();
    childRef.current = e.currentTarget as HTMLElement;
    openedFromKeyboardRef.current = true;
    pointerPosRef.current = null;
    setOpen(true);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!openOnLongPress || e.pointerType === 'mouse') return;
    longPressFiredRef.current = false;
    openedFromKeyboardRef.current = false;
    const { clientX: x, clientY: y } = e;
    longPressOriginRef.current = { x, y };
    childRef.current = e.currentTarget as HTMLElement;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressOriginRef.current = null;
      longPressFiredRef.current = true;
      pointerPosRef.current = { x, y };
      setPos({ x, y });
      setOpen(true);
    }, 500);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const origin = longPressOriginRef.current;
    if (!origin) return;
    if (Math.abs(e.clientX - origin.x) > 10 || Math.abs(e.clientY - origin.y) > 10) {
      cancelLongPress();
    }
  };

  // Swallow the synthetic click that follows a long-press so the trigger
  // (e.g. a Link) does not also activate when the menu opens.
  const handleClickCapture = (e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const child = Children.only(children);
  if (!isValidElement(child)) {
    return <>{children}</>;
  }

  type Handler<E> = ((e: E) => void) | undefined;
  const compose = <E,>(childHandler: Handler<E>, menuHandler: (e: E) => void) =>
    (e: E) => {
      childHandler?.(e);
      menuHandler(e);
    };

  const childProps = child.props as {
    onPointerDown?: Handler<React.PointerEvent>;
    onPointerMove?: Handler<React.PointerEvent>;
    onPointerUp?: Handler<React.PointerEvent>;
    onPointerCancel?: Handler<React.PointerEvent>;
    onClickCapture?: Handler<React.MouseEvent>;
    onKeyDown?: Handler<React.KeyboardEvent>;
  };

  const longPressProps = openOnLongPress
    ? {
        onPointerDown: compose(childProps.onPointerDown, handlePointerDown),
        onPointerMove: compose(childProps.onPointerMove, handlePointerMove),
        onPointerUp: compose(childProps.onPointerUp, cancelLongPress),
        onPointerCancel: compose(childProps.onPointerCancel, cancelLongPress),
        onClickCapture: compose(childProps.onClickCapture, handleClickCapture),
      }
    : {};

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
      {cloneElement(
        child as ReactElement<{
          onContextMenu?: (e: React.MouseEvent) => void;
          onKeyDown?: (e: React.KeyboardEvent) => void;
        }>,
        {
          onContextMenu: handleContextMenu,
          onKeyDown: compose(childProps.onKeyDown, handleTriggerKeyDown),
          ...longPressProps,
        },
      )}
      {menu && createPortal(menu, document.body)}
    </>
  );
}
