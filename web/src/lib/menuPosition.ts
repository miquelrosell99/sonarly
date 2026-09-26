export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

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
