import { Router, Route, useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { Layout } from './components/Layout.js';
import { Login } from './features/auth/index.js';
import { Setup } from './features/setup/index.js';
import { HomePage } from './features/home/index.js';
import { Songs } from './features/songs/index.js';
import { Playlists } from './features/playlists/index.js';
import { PlaylistDetail } from './features/playlists/index.js';
import { Organize } from './features/organize/index.js';
import {
  AdminStatus,
  AdminMedia,
  AdminUsers,
  AdminSystemTasks,
  AdminGenres,
  AdminLibraries,
} from './features/admin/index.js';
import { SettingsProfile } from './features/settings/index.js';
import { SettingsAppearance } from './features/settings/index.js';
import { Artists, Artist } from './features/artists/index.js';
import { Albums, Album } from './features/albums/index.js';
import { Tracks, Track } from './features/tracks/index.js';
import { SearchResults } from './features/search/index.js';
import { AlbumArtists } from './features/album-artists/index.js';
import { Genres, Genre } from './features/genres/index.js';
import { Years, Year } from './features/years/index.js';
import { Composers } from './features/composers/index.js';
import { Labels } from './features/labels/index.js';
import { AlbumTypes } from './features/album-types/index.js';
import { StatisticsPage } from './features/statistics/index.js';
import { api } from './api.js';

function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);
  return null;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    Promise.all([
      api<{ needsSetup: boolean }>('/setup').catch(() => ({ needsSetup: false })),
      api<{ user: User }>('/me').catch(() => null),
    ]).then(([setup, me]) => {
      setNeedsSetup(setup.needsSetup);
      setUser(me?.user ?? null);
    });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        target instanceof HTMLImageElement ||
        target.getAttribute('role') === 'img'
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  if (user === undefined || needsSetup === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary text-fg-secondary">
        <div className="flex items-center gap-3">
          <span className="font-display text-xl font-bold text-fg-primary">Sonarly</span>
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <Router>
        <Route path="/setup" component={() => <Setup onSetup={(u) => { setUser(u); setNeedsSetup(false); }} />} />
        <Route path="*" component={() => <Redirect to="/setup" />} />
      </Router>
    );
  }

  if (!user) {
    return (
      <Router>
        <Route path="/login" component={() => <Login onLogin={(u) => setUser(u)} />} />
        <Route path="*" component={() => <Redirect to="/login" />} />
      </Router>
    );
  }

  return (
    <Router>
      <Layout user={user} onUserChange={setUser}>
        <Route path="/" component={HomePage} />
        <Route path="/songs" component={() => <Songs user={user} />} />
        <Route path="/tracks" component={Tracks} />
        <Route path="/tracks/:id" component={Track} />
        <Route path="/search" component={SearchResults} />
        <Route path="/playlists" component={Playlists} />
        <Route path="/playlists/:id" component={() => <PlaylistDetail user={user} />} />
        <Route path="/albums" component={Albums} />
        <Route path="/albums/:id" component={() => <Album user={user} />} />
        <Route path="/artists" component={Artists} />
        <Route path="/artists/:id" component={Artist} />
        <Route path="/album-artists" component={AlbumArtists} />
        <Route path="/album-artists/:id" component={Artist} />
        <Route path="/genres" component={Genres} />
        <Route path="/genres/:genre" component={Genre} />
        <Route path="/years" component={Years} />
        <Route path="/years/:year" component={Year} />
        <Route path="/composers" component={Composers} />
        <Route path="/labels" component={Labels} />
        <Route path="/album-types" component={AlbumTypes} />
        <Route path="/organize" component={Organize} />
        <Route path="/admin" component={() => <Redirect to="/admin/status" />} />
        <Route path="/admin/status" component={() => <AdminStatus user={user} />} />
        <Route path="/admin/libraries" component={() => <AdminLibraries user={user} />} />
        <Route path="/admin/media" component={() => <AdminMedia user={user} />} />
        <Route path="/admin/users" component={() => <AdminUsers user={user} />} />
        <Route path="/admin/system-tasks" component={() => <AdminSystemTasks user={user} />} />
        <Route path="/admin/genres" component={() => <AdminGenres user={user} />} />
        <Route path="/statistics" component={() => <StatisticsPage mode="me" />} />
        <Route path="/settings" component={() => <Redirect to="/settings/profile" />} />
        <Route path="/settings/profile" component={() => <SettingsProfile user={user} onUserChange={setUser} />} />
        <Route path="/settings/appearance" component={SettingsAppearance} />
        <Route path="/users" component={() => <Redirect to="/admin/users" />} />
        <Route path="*" component={() => <Redirect to="/" />} />
      </Layout>
    </Router>
  );
}
