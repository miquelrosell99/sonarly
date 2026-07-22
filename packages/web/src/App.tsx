import { Router, Route, useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { Layout } from './components/Layout.js';
import { Login } from './features/auth/index.js';
import { Setup } from './features/setup/index.js';
import { Library } from './features/library/index.js';
import { Songs } from './features/songs/index.js';
import { Playlists } from './features/playlists/index.js';
import { PlaylistDetail } from './features/playlists/index.js';
import { Organize } from './features/organize/index.js';
import { Admin } from './features/admin/index.js';
import { SettingsMedia } from './features/settings/index.js';
import { SettingsIngest } from './features/settings/index.js';
import { SettingsConflicts } from './features/settings/index.js';
import { SettingsProfile } from './features/settings/index.js';
import { Artist } from './features/artists/index.js';
import { Album } from './features/albums/index.js';
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
        <Route path="/" component={Library} />
        <Route path="/songs" component={() => <Songs user={user} />} />
        <Route path="/playlists" component={Playlists} />
        <Route path="/playlists/:id" component={PlaylistDetail} />
        <Route path="/organize" component={Organize} />
        <Route path="/admin" component={() => <Admin user={user} />} />
        <Route path="/settings" component={() => <Redirect to="/settings/profile" />} />
        <Route path="/settings/media" component={SettingsMedia} />
        <Route path="/settings/ingest" component={SettingsIngest} />
        <Route path="/settings/profile" component={() => <SettingsProfile user={user} onUserChange={setUser} />} />
        <Route path="/settings/conflicts" component={SettingsConflicts} />
        <Route path="/users" component={() => <Redirect to="/admin" />} />
        <Route path="/artists/:id" component={Artist} />
        <Route path="/albums/:id" component={Album} />
        <Route path="*" component={() => <Redirect to="/" />} />
      </Layout>
    </Router>
  );
}
