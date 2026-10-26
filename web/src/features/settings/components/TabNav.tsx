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
    'relative px-3 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    // The fleet tab idiom (rulings v2.0.9: the
    // active tab keeps INK text — a 16px centered accent bar below carries
    // the accent signal; painting the label accent or a full-width
    // underline double-signals. Hover on an inactive tab is an ink shift,
    // not a background layer.
    active
      ? "font-medium text-on-surface after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-primary after:content-['']"
      : 'text-on-surface-variant hover:text-on-surface',
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
