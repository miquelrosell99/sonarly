import { Link, useLocation, useSearch } from 'wouter';
import type { User } from '@sonarly/shared';
import { api } from '../api.js';
import { UserSection, ProfileModal } from '../features/profile/index.js';

interface LayoutProps {
  user: User;
  onUserChange: (user: User) => void;
  children: React.ReactNode;
}

const nav = [
  { href: '/', label: 'Library' },
  { href: '/songs', label: 'Songs' },
  { href: '/playlists', label: 'Playlists' },
];

function isActive(location: string, href: string): boolean {
  if (location === href) return true;
  if (href !== '/' && location.startsWith(href)) return true;
  return false;
}

function useProfileModal(location: string, search: string, setLocation: (to: string) => void) {
  const params = new URLSearchParams(search);
  const isOpen = params.get('profile') === 'open';

  const open = () => {
    const next = new URLSearchParams(search);
    next.set('profile', 'open');
    setLocation(`${location}?${next.toString()}`);
  };

  const close = () => {
    const next = new URLSearchParams(search);
    next.delete('profile');
    const query = next.toString();
    setLocation(query ? `${location}?${query}` : location);
  };

  const expand = () => {
    setLocation('/settings/profile');
  };

  return { isOpen, open, close, expand };
}

export function Layout({ user, onUserChange, children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { isOpen, open, close, expand } = useProfileModal(location, search, setLocation);

  const handleLogout = async () => {
    try {
      await api('/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-gray-50 p-4">
        <h1 className="mb-6 text-xl font-bold tracking-tight">Sonarly</h1>
        <nav className="space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-2 py-1 text-sm ${isActive(location, item.href) ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-200'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <UserSection
          user={user}
          onSettings={open}
          onAdmin={() => setLocation('/admin')}
          onLogout={handleLogout}
        />
      </aside>
      <main className="flex-1 p-6">
        {children}
      </main>
      {isOpen && (
        <ProfileModal
          user={user}
          onUserChange={onUserChange}
          onClose={close}
          onExpand={expand}
        />
      )}
    </div>
  );
}
