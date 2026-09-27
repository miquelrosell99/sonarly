export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Structural subset of DOMRect returned by getBoundingClientRect. */
export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/** Where a trigger-anchored menu opens relative to its trigger. */
export type MenuPlacement = 'top-end' | 'bottom-start';

export const MENU_VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Propose a viewport-safe position for a pointer-anchored menu.
 *
 * The menu opens with its top-left corner at the pointer. When it would
 * overflow the right or bottom edge it flips left/up so the opposite edge
 * lands on the pointer (standard context-menu behavior); whatever happens,
 * the result is clamped inside the viewport with `margin` px of breathing
 * room. When the menu is larger than the viewport on an axis, the clamp
 * keeps the near edge at the margin so the menu's start stays reachable.
 */
export function computePointerMenuPosition(
  pointer: Point,
  menu: Size,
  viewport: Size,
  margin = MENU_VIEWPORT_MARGIN,
): Point {
  let left = pointer.x;
  if (left + menu.width > viewport.width - margin) {
    left = pointer.x - menu.width;
  }
  let top = pointer.y;
  if (top + menu.height > viewport.height - margin) {
    top = pointer.y - menu.height;
  }
  left = clamp(left, margin, Math.max(margin, viewport.width - menu.width - margin));
  top = clamp(top, margin, Math.max(margin, viewport.height - menu.height - margin));
  return { x: Math.round(left), y: Math.round(top) };
}

/**
 * Propose a viewport-safe position for a trigger-anchored popover menu.
 *
 * `top-end` places the menu's bottom-right corner above the trigger (the
 * player-bar popovers: the bar sits at the screen bottom, so the menu opens
 * upward, right-aligned); `bottom-start` drops the menu below the trigger's
 * left edge (keyboard opens of a context menu, which have no pointer). The
 * proposed corner is clamped inside the viewport with `margin` px of room;
 * when the menu is larger than the viewport on an axis, the near edge stays
 * at the margin so the menu's start remains reachable.
 */
export function computeAnchoredMenuPosition(
  trigger: Rect,
  menu: Size,
  viewport: Size,
  placement: MenuPlacement,
  margin = MENU_VIEWPORT_MARGIN,
): Point {
  let top: number;
  let left: number;

  if (placement === 'top-end') {
    top = trigger.top - menu.height - margin;
    left = trigger.right - menu.width;
  } else {
    top = trigger.bottom + margin;
    left = trigger.left;
  }

  left = clamp(left, margin, Math.max(margin, viewport.width - menu.width - margin));
  top = clamp(top, margin, Math.max(margin, viewport.height - menu.height - margin));

  return { x: left, y: top };
}
