import { useLocation, useSearch } from 'wouter';
import type { User } from '@sonarly/shared';
import { api } from '../api.js';
import { ProfileModal } from '../features/profile/index.js';
import { usePreferences } from '../hooks/usePreferences.js';
import { usePlaylists } from '../hooks/usePlaylists.js';
import { TopBar } from './TopBar.js';
import { Sidebar } from './Sidebar.js';
import { PlayerBar } from './PlayerBar.js';
import { AudioController } from './AudioController.js';

interface LayoutProps {
  user: User;
  onUserChange: (user: User) => void;
  children: React.ReactNode;
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
  const { data: preferences } = usePreferences();
  const { data: playlists } = usePlaylists();

  const handleLogout = async () => {
    try {
      await api('/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-primary text-fg-primary">
      <TopBar user={user} onOpenProfile={open} onLogout={handleLogout} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar config={preferences?.sidebarConfig} playlists={playlists} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      <PlayerBar />
      <AudioController />

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
