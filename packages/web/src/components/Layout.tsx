import { useLocation, useSearch } from 'wouter';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { ProfileModal } from '../features/profile/index.js';
import { CreatePlaylistModal } from '../features/playlists/index.js';
import { NowPlaying } from '../features/now-playing/index.js';
import { usePreferences } from '../hooks/usePreferences.js';
import { usePlaylists } from '../hooks/usePlaylists.js';
import { useCreatePlaylistModal } from '../hooks/useCreatePlaylistModal.js';
import { useTheme } from '../stores/themeStore.js';
import { usePlayer } from '../stores/playerStore.js';
import { useDominantColor } from '../hooks/useDominantColor.js';
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

  const close = () => {
    const next = new URLSearchParams(search);
    next.delete('profile');
    const query = next.toString();
    setLocation(query ? `${location}?${query}` : location);
  };

  return { isOpen, close };
}

export function Layout({ user, onUserChange, children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { isOpen, close } = useProfileModal(location, search, setLocation);
  const { isOpen: createPlaylistOpen, editingPlaylistId, close: closeCreatePlaylist } = useCreatePlaylistModal();
  const { data: preferences } = usePreferences();
  const { data: playlists } = usePlaylists();
  const { themeMode, accentColor, setThemeMode, setAccentColor } = useTheme();
  const currentSong = usePlayer((state) => state.currentSong);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  const themeModeRef = useRef(themeMode);
  const accentColorRef = useRef(accentColor);

  useEffect(() => {
    themeModeRef.current = themeMode;
    accentColorRef.current = accentColor;
  });

  useEffect(() => {
    if (!preferences) return;
    if (preferences.themeMode && preferences.themeMode !== themeModeRef.current) {
      setThemeMode(preferences.themeMode);
    }
    if (preferences.accentColor && preferences.accentColor !== accentColorRef.current) {
      setAccentColor(preferences.accentColor);
    }
  }, [preferences, setThemeMode, setAccentColor]);

  const handleLogout = async () => {
    try {
      await api('/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  };

  const coverUrl = currentSong?.coverArt ? `/api/cover-art/${currentSong.coverArt}` : undefined;
  const dominantColor = useDominantColor(coverUrl);

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden bg-bg-primary text-fg-primary"
      style={
        dominantColor
          ? ({ '--now-playing-color': dominantColor } as React.CSSProperties)
          : undefined
      }
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-bg-primary"
      >
        Skip to content
      </a>
      <TopBar user={user} onLogout={handleLogout} onMenuClick={openMobileNav} />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          config={preferences?.sidebarConfig}
          playlists={playlists}
          mobileOpen={mobileNavOpen}
          onMobileClose={closeMobileNav}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto motion-safe:scroll-smooth p-6 focus:outline-none"
        >
          {children}
        </main>
      </div>

      <PlayerBar user={user} />
      <AudioController />
      <NowPlaying user={user} />

      {isOpen && (
        <ProfileModal
          user={user}
          onUserChange={onUserChange}
          onClose={close}
        />
      )}

      <CreatePlaylistModal open={createPlaylistOpen} onClose={closeCreatePlaylist} editingPlaylistId={editingPlaylistId} />
    </div>
  );
}
