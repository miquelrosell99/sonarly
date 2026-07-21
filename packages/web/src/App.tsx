import { Router, Route } from 'wouter';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout.js';
import { Login } from './pages/Login.js';
import { Library } from './pages/Library.js';
import { Songs } from './pages/Songs.js';
import { Playlists } from './pages/Playlists.js';
import { PlaylistDetail } from './pages/PlaylistDetail.js';
import { Ingest } from './pages/Ingest.js';
import { Organize } from './pages/Organize.js';
import { Users } from './pages/Users.js';
import { Artist } from './pages/Artist.js';
import { Album } from './pages/Album.js';
import { api } from './api.js';

export default function App() {
  const [user, setUser] = useState<{ username: string } | null | undefined>(undefined);

  useEffect(() => {
    api<{ user: { username: string } }>('/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="p-8">Loading...</div>;
  if (!user) return <Login onLogin={(u) => setUser(u)} />;

  return (
    <Router>
      <Layout>
        <Route path="/" component={Library} />
        <Route path="/songs" component={Songs} />
        <Route path="/playlists" component={Playlists} />
        <Route path="/playlists/:id" component={PlaylistDetail} />
        <Route path="/ingest" component={Ingest} />
        <Route path="/organize" component={Organize} />
        <Route path="/users" component={Users} />
        <Route path="/artists/:id" component={Artist} />
        <Route path="/albums/:id" component={Album} />
      </Layout>
    </Router>
  );
}
