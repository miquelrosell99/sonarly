import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { api } from '../api.js';
import type { PlayerInfo } from '@sonarly/shared';

interface TopBarProps {
  user: User;
  onOpenProfile: () => void;
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
        className={cn('rounded-full object-cover', className)}
      />
    );
  }
  return (
    <div className={cn('flex items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-muted', className)}>
      {initials}
    </div>
  );
}

function usePlayers() {
  return useQuery<{ players: PlayerInfo[] }, Error, PlayerInfo[]>({
    queryKey: ['players'],
    queryFn: () => api('/players'),
    select: (data) => data.players,
    refetchInterval: 5000,
  });
}

function PlayersDropdown() {
  const { data: players = [], isLoading } = usePlayers();
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md border border-rule px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          open ? 'bg-surface-hover' : 'bg-surface hover:bg-surface-hover',
        )}
      >
        <Icon name="mdi-cast-audio" size={18} />
        <span className="hidden sm:inline">
          {isLoading ? 'Players…' : `${players.length} connected`}
        </span>
        <Icon name="mdi-chevron-down" size={16} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-56 rounded-md border border-rule bg-bg-primary py-1 shadow-lg"
        >
          {players.length === 0 ? (
            <p className="px-4 py-2 text-sm text-muted">No connected players</p>
          ) : (
            players.map((player) => (
              <div key={player.id} className="px-4 py-2 text-sm">
                <p className="font-medium text-fg-primary">{player.clientId}</p>
                <p className="truncate text-xs text-muted">{player.songTitle}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, onOpenProfile, onLogout }: TopBarProps) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
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

  const navigate = (to: string) => {
    setOpen(false);
    setLocation(to);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md p-1.5 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Avatar user={user} className="h-8 w-8" />
        <span className="hidden max-w-[8rem] truncate text-sm font-medium md:block">{displayName}</span>
        <Icon name="mdi-chevron-down" size={16} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-48 rounded-md border border-rule bg-bg-primary py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenProfile(); }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <Icon name="mdi-account" size={18} />
            Profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => navigate('/settings/profile')}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <Icon name="mdi-cog" size={18} />
            Settings
          </button>
          {user.isAdmin && (
            <button
              type="button"
              role="menuitem"
              onClick={() => navigate('/admin')}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
            >
              <Icon name="mdi-account-group" size={18} />
              Admin
            </button>
          )}
          <div className="my-1 border-t border-rule" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <Icon name="mdi-logout" size={18} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ user, onOpenProfile, onLogout }: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-rule bg-bg-primary px-4">
      <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-fg-primary hover:text-fg-primary">
        Sonarly
      </Link>

      <div className="flex flex-1 items-center justify-end gap-3">
        <div className="relative hidden max-w-md flex-1 sm:block">
          <Icon name="mdi-magnify" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search…"
            readOnly
            className="input w-full pl-9"
          />
        </div>

        <button
          type="button"
          className="btn-ghost hidden sm:inline-flex"
        >
          <Icon name="mdi-filter-variant" size={18} className="mr-2" />
          Filters
        </button>

        <PlayersDropdown />
        <UserMenu user={user} onOpenProfile={onOpenProfile} onLogout={onLogout} />
      </div>
    </header>
  );
}
