export const PX_PER_SECOND = 40;
export const WHEEL_STEP_SECONDS = 0.5;

export interface EditLine {
  id: number;
  time: number;
  text: string;
}

// a[href], not [href]: bare [href] also matches SVG <use> refs,
// which are not focusable and would break the Tab cycle (audit P6 deferral).
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

export function sortByTime(lines: EditLine[]): EditLine[] {
  return [...lines].sort((a, b) => a.time - b.time);
}
