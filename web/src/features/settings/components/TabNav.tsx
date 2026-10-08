import { Link, useLocation } from 'wouter';
import { cn } from '../../../lib/cn.js';

export interface TabNavItem {
  key: string;
  label: React.ReactNode;
}

interface TabNavProps {
  items: TabNavItem[];
  /** Active item key. When omitted (link mode), it is derived from the current location. */
  activeKey?: string;
  /** When provided, items render as buttons; otherwise they render as links to their key. */
  onSelect?: (key: string) => void;
  className?: string;
}

function tabClass(active: boolean): string {
  return cn(
    '-mb-px border-b-2 px-3 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    // No fill: the accent underline marks "you are here" (the sidebar's
    // language) without turning navigation into a button.
    active
      ? 'border-accent font-medium text-fg-primary'
      : 'border-transparent text-muted hover:text-fg-primary',
  );
}

export function TabNav({ items, activeKey, onSelect, className }: TabNavProps) {
  const [location] = useLocation();
  const isActive = (key: string) =>
    activeKey !== undefined ? activeKey === key : location === key || location.startsWith(`${key}/`);

  return (
    <nav className={cn('flex flex-wrap gap-2', className)}>
      {items.map((item) => {
        const active = isActive(item.key);
        return onSelect ? (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-pressed={active}
            className={tabClass(active)}
          >
            {item.label}
          </button>
        ) : (
          <Link
            key={item.key}
            href={item.key}
            aria-current={active ? 'page' : undefined}
            className={tabClass(active)}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
