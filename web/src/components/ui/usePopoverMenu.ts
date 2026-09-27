import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from 'react';
import { computeAnchoredMenuPosition, type MenuPlacement, type Point } from '../../lib/menuPosition.js';

export type PopoverMenuPlacement = MenuPlacement;

export interface UsePopoverMenuOptions {
  /**
   * Where the menu anchors to the trigger when `portal` positioning is used.
   * 'top-end' opens above the trigger, right-aligned (player-bar popovers);
   * 'bottom-start' drops below the trigger's left edge.
   */
  placement?: PopoverMenuPlacement;
  /**
   * true (default): the menu is portaled to <body> and positioned with
   * `position: fixed` + measured viewport clamping. false: the menu stays in
   * the component tree and is anchored with CSS (absolute right-0 top-full)
   * — the hook then only manages open state, focus, and keyboard behavior.
   */
  portal?: boolean;
}

export interface PopoverMenuTriggerProps {
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  onClick: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}

export interface PopoverMenuMenuProps {
  role: 'menu';
  style: CSSProperties | undefined;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}

export interface PopoverMenuApi<T extends HTMLElement> {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  /** Close the menu; with restoreFocus the trigger receives focus (APG). */
  closeMenu: (restoreFocus?: boolean) => void;
  triggerRef: MutableRefObject<T | null>;
  menuRef: MutableRefObject<HTMLDivElement | null>;
  /** Fixed position for a portaled menu ({ x: left, y: top }); (0, 0) otherwise. */
  position: Point;
  triggerProps: PopoverMenuTriggerProps;
  menuProps: PopoverMenuMenuProps;
}

/**
 * Shared behavior for the app's trigger-anchored popover menus (audit F21):
 * open state, click-outside close, Escape close with focus restore, optional
 * measured viewport-clamped fixed positioning (ResizeObserver re-clamp),
 * focus-first-item on open, and APG arrow/Home/End roving with Tab-closes.
 * Extracted from ItemContextMenu's proven behavior, minus the pointer-anchored
 * context-menu specifics (right-click, Shift+F10/Menu key, long-press), which
 * stay in that component.
 */
export function usePopoverMenu<T extends HTMLElement = HTMLButtonElement>({
  placement = 'top-end',
  portal = true,
}: UsePopoverMenuOptions = {}): PopoverMenuApi<T> {
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<Point>({ x: 0, y: 0 });
  const triggerRef = useRef<T | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
  }, []);

  const toggleOpen = useCallback(() => {
    setOpenState((value) => !value);
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpenState(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Click-outside and Escape close, following the app's menu conventions:
  // the document-level listener runs in the capture phase and swallows Escape
  // so an open menu takes the first Escape, and focus returns to the trigger.
  useEffect(() => {
    if (!open) return;
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target) ?? false;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideMenu) {
        setOpenState(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenState(false);
        triggerRef.current?.focus();
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
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const menuRect = menu.getBoundingClientRect();
    const { x, y } = computeAnchoredMenuPosition(
      trigger.getBoundingClientRect(),
      { width: menuRect.width, height: menuRect.height },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );
    setPos({ x, y });
  }, [placement]);

  // Measure-then-position before paint so a portaled menu never flashes at
  // its previous spot.
  useLayoutEffect(() => {
    if (!open || !portal) return;
    positionMenu();
  }, [open, portal, positionMenu]);

  // Re-clamp when the menu resizes while open.
  useEffect(() => {
    if (!open || !portal || typeof ResizeObserver === 'undefined') return;
    const menu = menuRef.current;
    if (!menu) return;
    const observer = new ResizeObserver(() => positionMenu());
    observer.observe(menu);
    return () => observer.disconnect();
  }, [open, portal, positionMenu]);

  // Move focus to the first menu item when the menu opens.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const firstItem = menu.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    firstItem?.focus();
  }, [open]);

  const getEnabledMenuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );

  const focusMenuItem = (direction: 1 | -1) => {
    const items = getEnabledMenuItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  };

  const focusEdgeMenuItem = (edge: 'first' | 'last') => {
    const items = getEnabledMenuItems();
    if (items.length === 0) return;
    (edge === 'first' ? items[0] : items[items.length - 1]).focus();
  };

  const handleMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusMenuItem(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusMenuItem(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusEdgeMenuItem('first');
    } else if (e.key === 'End') {
      e.preventDefault();
      focusEdgeMenuItem('last');
    } else if (e.key === 'Tab') {
      // APG: Tab closes the menu. Focus returns to the trigger, so the user's
      // next Tab press continues through the page's tab order from there.
      closeMenu(true);
    }
  };

  const handleTriggerKeyDown = (e: ReactKeyboardEvent) => {
    // Menu-button convention: ArrowDown or Enter on the closed trigger opens
    // the menu (Enter's default click activation would otherwise toggle).
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setOpenState(true);
    }
  };

  return {
    open,
    setOpen,
    toggleOpen,
    closeMenu,
    triggerRef,
    menuRef,
    position: pos,
    triggerProps: {
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      onClick: toggleOpen,
      onKeyDown: handleTriggerKeyDown,
    },
    menuProps: {
      role: 'menu',
      style: portal ? { top: pos.y, left: pos.x } : undefined,
      onKeyDown: handleMenuKeyDown,
    },
  };
}
