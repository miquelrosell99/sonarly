import { describe, it, expect } from 'vitest';
import { computeAnchoredMenuPosition, computePointerMenuPosition, MENU_VIEWPORT_MARGIN } from './menuPosition.js';

// Viewport and menu sizes shared across cases; the viewport is 600x400 and
// the menu 150x120, so a menu fits anywhere with >8px margin to spare.
const viewport = { width: 600, height: 400 };
const menu = { width: 150, height: 120 };

describe('computePointerMenuPosition', () => {
  it('opens with the top-left corner at the pointer when everything fits', () => {
    expect(computePointerMenuPosition({ x: 100, y: 100 }, menu, viewport)).toEqual({ x: 100, y: 100 });
  });

  it('flips left near the right edge so the menu right edge lands on the pointer', () => {
    // 500 + 150 = 650 > 600 - 8 → flip: 500 - 150 = 350
    expect(computePointerMenuPosition({ x: 500, y: 100 }, menu, viewport)).toEqual({ x: 350, y: 100 });
  });

  it('flips up near the bottom edge so the menu bottom edge lands on the pointer', () => {
    // 350 + 120 = 470 > 400 - 8 → flip: 350 - 120 = 230
    expect(computePointerMenuPosition({ x: 100, y: 350 }, menu, viewport)).toEqual({ x: 100, y: 230 });
  });

  it('clamps to the left margin when the pointer is past the left edge', () => {
    expect(computePointerMenuPosition({ x: 2, y: 100 }, menu, viewport)).toEqual({
      x: MENU_VIEWPORT_MARGIN,
      y: 100,
    });
  });

  it('clamps to the top margin when the pointer is past the top edge', () => {
    expect(computePointerMenuPosition({ x: 100, y: 3 }, menu, viewport)).toEqual({
      x: 100,
      y: MENU_VIEWPORT_MARGIN,
    });
  });

  it('flips on both axes in the bottom-right corner', () => {
    expect(computePointerMenuPosition({ x: 590, y: 390 }, menu, viewport)).toEqual({ x: 440, y: 270 });
  });

  it('does not flip when the menu exactly reaches the margin boundary', () => {
    // 442 + 150 = 592 = 600 - 8 → fits exactly, no flip
    expect(computePointerMenuPosition({ x: 442, y: 100 }, menu, viewport)).toEqual({ x: 442, y: 100 });
  });

  it('flips left far enough to keep an 8px margin from the viewport edge', () => {
    // Flip lands at 590 - 150 = 440, clamped ceiling is 600 - 150 - 8 = 442
    const { x } = computePointerMenuPosition({ x: 590, y: 100 }, menu, viewport);
    expect(x + menu.width).toBeLessThanOrEqual(viewport.width - MENU_VIEWPORT_MARGIN);
  });

  it('keeps the near edge at the margin when the menu is larger than the viewport', () => {
    const huge = { width: 800, height: 500 };
    expect(computePointerMenuPosition({ x: 300, y: 200 }, huge, viewport)).toEqual({
      x: MENU_VIEWPORT_MARGIN,
      y: MENU_VIEWPORT_MARGIN,
    });
  });

  it('keeps the near edge at the margin in a tiny viewport', () => {
    const tiny = { width: 100, height: 80 };
    expect(computePointerMenuPosition({ x: 50, y: 40 }, menu, tiny)).toEqual({
      x: MENU_VIEWPORT_MARGIN,
      y: MENU_VIEWPORT_MARGIN,
    });
  });

  it('respects a custom margin', () => {
    // 480 + 150 = 630 > 600 - 20 → flip: 480 - 150 = 330
    expect(computePointerMenuPosition({ x: 480, y: 100 }, menu, viewport, 20)).toEqual({ x: 330, y: 100 });
  });

  it('rounds fractional positions', () => {
    const { x, y } = computePointerMenuPosition({ x: 100.4, y: 100.6 }, menu, viewport);
    expect(x).toBe(100);
    expect(y).toBe(101);
  });
});

// Trigger rects as returned by getBoundingClientRect; the viewport is 600x400
// and the menu 150x120 unless a case says otherwise.
function triggerRect(top: number, right: number, bottom: number, left: number) {
  return { top, right, bottom, left, width: right - left, height: bottom - top };
}

describe('computeAnchoredMenuPosition', () => {
  it('opens top-end: bottom-right corner above the trigger, right-aligned', () => {
    // top: 200 - 120 - 8 = 72; left: 300 - 150 = 150
    expect(computeAnchoredMenuPosition(triggerRect(200, 300, 220, 280), menu, viewport, 'top-end')).toEqual({ x: 150, y: 72 });
  });

  it('opens bottom-start: below the trigger, left-aligned', () => {
    // top: 124 + 8 = 132; left: 100
    expect(computeAnchoredMenuPosition(triggerRect(100, 120, 124, 100), menu, viewport, 'bottom-start')).toEqual({ x: 100, y: 132 });
  });

  it('clamps the right-aligned left edge to the viewport margin', () => {
    // left: 100 - 150 = -50 → clamped to 8
    expect(computeAnchoredMenuPosition(triggerRect(200, 100, 220, 80), menu, viewport, 'top-end')).toEqual({ x: MENU_VIEWPORT_MARGIN, y: 72 });
  });

  it('clamps the top edge to the viewport margin when the trigger is at the top', () => {
    // top: 20 - 120 - 8 = -108 → clamped to 8
    const { y } = computeAnchoredMenuPosition(triggerRect(20, 300, 40, 280), menu, viewport, 'top-end');
    expect(y).toBe(MENU_VIEWPORT_MARGIN);
  });

  it('keeps the near edge at the margin when the menu is wider than the viewport', () => {
    const wide = { width: 700, height: 120 };
    // left: 300 - 700 = -400, ceiling: 600 - 700 - 8 < margin → 8
    expect(computeAnchoredMenuPosition(triggerRect(200, 300, 220, 280), wide, viewport, 'top-end')).toEqual({ x: MENU_VIEWPORT_MARGIN, y: 72 });
  });

  it('respects a custom margin', () => {
    // top: 200 - 120 - 20 = 60; left: 300 - 150 = 150
    expect(computeAnchoredMenuPosition(triggerRect(200, 300, 220, 280), menu, viewport, 'top-end', 20)).toEqual({ x: 150, y: 60 });
  });
});
