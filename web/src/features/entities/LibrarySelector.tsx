import { useEffect, useRef, useState } from 'react';
import type { Library } from '../../types';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../components/ui/Icon.js';

interface LibrarySelectorProps {
  libraries: Library[];
  selectedLibraryId: string | null;
  onSelect: (id: string | null) => void;
  /** Set when the libraries load failed; rendered as a disabled option. */
  error?: string | null;
}

export function LibrarySelector({ libraries, selectedLibraryId, onSelect, error }: LibrarySelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    // Keyboard support: land focus on the selected option (or the first)
    // when the listbox opens — Escape returns it to the trigger above.
    const options = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [],
    );
    const selectedOption =
      options.find((el) => el.getAttribute('aria-selected') === 'true') ?? options[0];
    selectedOption?.focus();
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Arrow navigation between the option buttons while the listbox has focus.
  const handleListboxKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const options = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [],
    );
    if (options.length === 0) return;
    const current = options.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown'
        ? (current + 1) % options.length
        : (current - 1 + options.length) % options.length;
    options[next].focus();
  };

  const selected = libraries.find((l) => l.id === selectedLibraryId);
  const label = selected?.name ?? 'All libraries';

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Library: ${label}`}
        title={label}
        className="flex w-full items-center gap-2 rounded-input border border-outline bg-surface px-3 py-2 text-sm font-medium text-on-surface-variant transition hover:border-on-surface-variant hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Icon name="mdi-music-box-multiple" size={18} className="shrink-0 text-on-surface-variant" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <Icon
          name="mdi-chevron-down"
          size={16}
          className={cn('shrink-0 text-on-surface-variant transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          onKeyDown={handleListboxKeyDown}
          className="absolute left-0 top-full z-40 mt-2 w-full rounded-popover border border-outline bg-surface p-1 shadow-xl"
        >
          <button
            type="button"
            role="option"
            aria-selected={selectedLibraryId === null}
            onClick={() => { onSelect(null); setOpen(false); }}
            className={cn(
              'flex w-full items-center rounded-item px-3 py-2 text-left text-sm transition',
              selectedLibraryId === null
                ? 'text-primary'
                : 'text-on-surface hover:bg-surface-container-high focus-visible:bg-surface-container-high',
            )}
          >
            All libraries
            {selectedLibraryId === null && (
              <Icon name="mdi-check" size={16} className="ml-auto shrink-0" />
            )}
          </button>
          <div className="my-1 border-t border-outline" />
          {libraries.map((library) => (
            <button
              key={library.id}
              type="button"
              role="option"
              aria-selected={selectedLibraryId === library.id}
              onClick={() => { onSelect(library.id); setOpen(false); }}
              className={cn(
                'flex w-full items-center rounded-item px-3 py-2 text-left text-sm transition',
                selectedLibraryId === library.id
                  ? 'text-primary'
                  : 'text-on-surface hover:bg-surface-container-high focus-visible:bg-surface-container-high',
              )}
            >
              <span className="truncate">{library.name}</span>
              {selectedLibraryId === library.id && (
                <Icon name="mdi-check" size={16} className="ml-auto shrink-0" />
              )}
            </button>
          ))}
          {error ? (
            <p className="px-3 py-2 text-xs text-error" role="option" aria-disabled="true">
              Libraries unavailable
            </p>
          ) : (
            libraries.length === 0 && (
              <p className="px-3 py-2 text-xs text-on-surface-variant">No libraries configured.</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
