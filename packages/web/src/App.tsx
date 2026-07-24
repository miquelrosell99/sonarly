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
import { Admin } from './features/admin/index.js';
import { SettingsMedia } from './features/settings/index.js';
import { SettingsIngest } from './features/settings/index.js';
import { SettingsSystemTasks } from './features/settings/index.js';
import { SettingsConflicts } from './features/settings/index.js';
import { SettingsProfile } from './features/settings/index.js';
import { SettingsAppearance } from './features/settings/index.js';
import { SettingsMissing } from './features/settings/index.js';
import { Artists, Artist } from './features/artists/index.js';
import { Albums, Album } from './features/albums/index.js';
import { Tracks, Track } from './features/tracks/index.js';
import { AlbumArtists } from './features/album-artists/index.js';
import { Genres, Genre } from './features/genres/index.js';
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
    return <div className="p-8">Loading...</div>;
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
        <Route path="/playlists" component={Playlists} />
        <Route path="/playlists/:id" component={PlaylistDetail} />
        <Route path="/albums" component={Albums} />
        <Route path="/albums/:id" component={Album} />
        <Route path="/artists" component={Artists} />
        <Route path="/artists/:id" component={Artist} />
        <Route path="/album-artists" component={AlbumArtists} />
        <Route path="/album-artists/:id" component={Artist} />
        <Route path="/genres" component={Genres} />
        <Route path="/genres/:genre" component={Genre} />
        <Route path="/organize" component={Organize} />
        <Route path="/admin" component={() => <Admin user={user} />} />
        <Route path="/settings" component={() => <Redirect to="/settings/profile" />} />
        <Route path="/settings/media" component={SettingsMedia} />
        <Route path="/settings/ingest" component={SettingsIngest} />
        <Route path="/settings/system-tasks" component={SettingsSystemTasks} />
        <Route path="/settings/profile" component={() => <SettingsProfile user={user} onUserChange={setUser} />} />
        <Route path="/settings/appearance" component={SettingsAppearance} />
        <Route path="/settings/conflicts" component={SettingsConflicts} />
        <Route path="/settings/missing" component={SettingsMissing} />
        <Route path="/users" component={() => <Redirect to="/admin" />} />
        <Route path="*" component={() => <Redirect to="/" />} />
      </Layout>
    </Router>
  );
}
