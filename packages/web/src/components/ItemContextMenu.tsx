import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
}

interface ItemContextMenuProps {
  items: ContextMenuItem[];
  children: ReactNode;
}

export function ItemContextMenu({ items, children }: ItemContextMenuProps) {
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

  if (items.length === 0) {
    return <>{children}</>;
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setPos({ x: e.clientX, y: e.clientY });
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
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              role="menuitem"
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
