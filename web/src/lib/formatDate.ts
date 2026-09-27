// Central date formatting. Every user-facing date renders day-first
// (DD/MM/YYYY, 24h clock) regardless of the browser locale — the fleet
// convention. Number localization (counts, chart axes) is out of scope.
const LOCALE = 'en-GB';

export function formatDateTime(value: string | Date | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString(LOCALE);
}

export function formatDate(value: string | Date | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString(LOCALE);
}

/** Date with a short month name, day-first: "27 Sep 2026". */
export function formatDateShortMonth(value: string | Date | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}
