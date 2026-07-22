import { useState, useRef, useEffect } from 'react';
import type { User } from '@sonarly/shared';

interface UserSectionProps {
  user: User;
  onSettings: () => void;
  onAdmin: () => void;
  onLogout: () => void;
}

function Avatar({ user, className }: { user: User; className?: string }) {
  const initials = user.name && user.surname
    ? `${user.name[0]}${user.surname[0]}`.toUpperCase()
    : user.name
      ? user.name[0].toUpperCase()
      : user.username[0].toUpperCase();

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <div className={`flex items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600 ${className}`}>
      {initials}
    </div>
  );
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
        className="flex w-full items-center gap-3 rounded-md p-2 text-left transition hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar user={user} className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">{displayName}</p>
          {user.email && <p className="truncate text-xs text-gray-500">{user.email}</p>}
        </div>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-sm"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onSettings(); }}
            className="block w-full px-4 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none"
          >
            Settings
          </button>
          {user.isAdmin && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onAdmin(); }}
              className="block w-full px-4 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none"
            >
              Admin panel
            </button>
          )}
          <div className="my-1 border-t border-gray-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="block w-full px-4 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
