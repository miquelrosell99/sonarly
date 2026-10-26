import { useState, useRef, useEffect } from 'react';
import type { User } from '../../../types';
import { Avatar } from '../../entities/Avatar.js';

interface UserSectionProps {
  user: User;
  onSettings: () => void;
  onAdmin: () => void;
  onLogout: () => void;
}

export function UserSection({ user, onSettings, onAdmin, onLogout }: UserSectionProps) {
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

  const displayName = [user.name, user.surname].filter(Boolean).join(' ') || user.username;

  return (
    <div ref={ref} className="relative mt-auto pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-item p-2 text-left transition hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar user={user} variant="surface" className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-on-surface">{displayName}</p>
          {user.email && <p className="truncate text-xs text-on-surface-variant">{user.email}</p>}
        </div>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-48 rounded-popover bg-surface py-1 shadow-sm"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onSettings(); }}
            className="block w-full px-4 py-2 text-left text-sm text-on-surface transition hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-none"
          >
            Settings
          </button>
          {user.isAdmin && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onAdmin(); }}
              className="block w-full px-4 py-2 text-left text-sm text-on-surface transition hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-none"
            >
              Admin panel
            </button>
          )}
          <div className="my-1 border-t border-outline" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="block w-full px-4 py-2 text-left text-sm text-on-surface transition hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-none"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
