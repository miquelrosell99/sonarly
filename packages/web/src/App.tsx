import { Router, Route, useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout.js';
import { Login } from './pages/Login.js';
import { Setup } from './pages/Setup.js';
import { Library } from './pages/Library.js';
import { Songs } from './pages/Songs.js';
import { Playlists } from './pages/Playlists.js';
import { PlaylistDetail } from './pages/PlaylistDetail.js';
import { Ingest } from './pages/Ingest.js';
import { Organize } from './pages/Organize.js';
import { Users } from './pages/Users.js';
import { Settings } from './pages/Settings.js';
import { SettingsMedia } from './pages/SettingsMedia.js';
import { Artist } from './pages/Artist.js';
import { Album } from './pages/Album.js';
import { api } from './api.js';

function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);
  return null;
}

export default function App() {
  const [user, setUser] = useState<{ username: string; isAdmin: boolean } | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    Promise.all([
      api<{ needsSetup: boolean }>('/setup').catch(() => ({ needsSetup: false })),
      api<{ user: { username: string; isAdmin: boolean } }>('/me').catch(() => null),
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
      <Layout user={user}>
        <Route path="/" component={Library} />
        <Route path="/songs" component={Songs} />
        <Route path="/playlists" component={Playlists} />
        <Route path="/playlists/:id" component={PlaylistDetail} />
        <Route path="/ingest" component={Ingest} />
        <Route path="/organize" component={Organize} />
        <Route path="/settings" component={() => <Redirect to="/settings/media" />} />
        <Route path="/settings/media" component={() => (
          <Settings><SettingsMedia /></Settings>
        )} />
        <Route path="/settings/users" component={() => (
          <Settings><Users /></Settings>
        )} />
        <Route path="/users" component={() => <Redirect to="/settings/users" />} />
        <Route path="/artists/:id" component={Artist} />
        <Route path="/albums/:id" component={Album} />
        <Route path="*" component={() => <Redirect to="/" />} />
      </Layout>
    </Router>
  );
}
