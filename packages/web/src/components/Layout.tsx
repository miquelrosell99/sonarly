import { useLocation, useSearch } from 'wouter';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../lib/api.js';
import { ProfileModal } from '../features/profile/index.js';
import { CreatePlaylistModal } from '../features/playlists/index.js';
import { NowPlaying, useNowPlaying } from '../features/now-playing/index.js';
import { usePreferences } from '../hooks/usePreferences.js';
import { usePlaylists } from '../hooks/usePlaylists.js';
import { useCreatePlaylistModal } from '../hooks/useCreatePlaylistModal.js';
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
  const currentSong = usePlayer((state) => state.currentSong);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // Start each page at the top. Virtualized lists only render the window at
  // the current scroll offset, so inheriting a deep offset from the previous
  // page would show a blank region. The now-playing overlay swaps the URL
  // while open (Immich-style) — never reset underneath it.
  const mainRef = useRef<HTMLElement | null>(null);
  const nowPlayingOpen = useNowPlaying((state) => state.isOpen);
  const pathname = location.split('?')[0] ?? location;
  const previousPathRef = useRef(pathname);
  useEffect(() => {
    if (previousPathRef.current !== pathname && !nowPlayingOpen) {
      mainRef.current?.scrollTo?.({ top: 0 });
    }
    previousPathRef.current = pathname;
  }, [pathname, nowPlayingOpen]);

  // FF8: preferences never write into the theme store here. The single writer
  // is useUpdatePreferences' onSuccess, which applies the server response;
  // the store itself drives the DOM classes on every change.

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
          user={user}
          mobileOpen={mobileNavOpen}
          onMobileClose={closeMobileNav}
        />
        <main
          id="main-content"
          ref={mainRef}
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
