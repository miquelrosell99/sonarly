import { useEffect, useRef, useState } from 'react';
import type { Library } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';

interface LibrarySelectorProps {
  libraries: Library[];
  selectedLibraryId: string | null;
  onSelect: (id: string | null) => void;
}

export function LibrarySelector({ libraries, selectedLibraryId, onSelect }: LibrarySelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const selected = libraries.find((l) => l.id === selectedLibraryId);
  const label = selected?.name ?? 'All libraries';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Library: ${label}`}
        title={label}
        className="flex items-center gap-1 rounded-lg p-2 text-sm font-medium text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-2 sm:py-1"
      >
        <Icon name="mdi-music-box-multiple" size={18} className="text-accent" />
        <span className="hidden max-w-[8rem] truncate lg:block">{label}</span>
        <Icon
          name="mdi-chevron-down"
          size={16}
          className={cn('hidden text-fg-secondary transition-transform lg:block', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-2 w-56 rounded-xl border border-rule bg-surface p-1 shadow-xl"
        >
          <button
            type="button"
            role="option"
            aria-selected={selectedLibraryId === null}
            onClick={() => { onSelect(null); setOpen(false); }}
            className={cn(
              'flex w-full rounded-lg px-3 py-2 text-left text-sm transition',
              selectedLibraryId === null
                ? 'bg-accent/10 text-accent'
                : 'text-fg-primary hover:bg-surface-hover focus-visible:bg-surface-hover',
            )}
          >
            All libraries
          </button>
          <div className="my-1 border-t border-rule" />
          {libraries.map((library) => (
            <button
              key={library.id}
              type="button"
              role="option"
              aria-selected={selectedLibraryId === library.id}
              onClick={() => { onSelect(library.id); setOpen(false); }}
              className={cn(
                'flex w-full rounded-lg px-3 py-2 text-left text-sm transition',
                selectedLibraryId === library.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-fg-primary hover:bg-surface-hover focus-visible:bg-surface-hover',
              )}
            >
              <span className="truncate">{library.name}</span>
            </button>
          ))}
          {libraries.length === 0 && (
            <p className="px-3 py-2 text-xs text-fg-secondary">No libraries configured.</p>
          )}
        </div>
      )}
    </div>
  );
}
