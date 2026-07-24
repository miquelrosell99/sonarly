import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
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
}

function clamp(value: number, max: number) {
  return Math.max(8, Math.min(value, max - 8));
}

export function ItemContextMenu({ sections, children }: ItemContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouse);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouse);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const visibleSections = sections?.filter((section) => section.items.length > 0) ?? [];
  if (visibleSections.length === 0) {
    return <>{children}</>;
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const x = clamp(e.clientX, window.innerWidth);
    const y = clamp(e.clientY, window.innerHeight);
    setPos({ x, y });
    setOpen(true);
  };

  return (
    <div ref={ref} onContextMenu={handleContextMenu} className="relative">
      {children}
      {open && (
        <div
          role="menu"
          style={{ top: pos.y, left: pos.x }}
          className={cn(
            'fixed z-50 min-w-[10rem] rounded-md border border-rule bg-bg-primary py-1 shadow-lg',
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
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none',
                    item.disabled && 'opacity-50 cursor-not-allowed',
                    item.variant === 'danger' && 'text-danger',
                  )}
                >
                  {item.loading ? <span className="animate-spin">⟳</span> : item.icon && <Icon name={item.icon} size={18} />}
                  {item.label}
                </button>
              ))}
              {sIdx < visibleSections.length - 1 && <hr role="separator" className="my-1 border-rule" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
