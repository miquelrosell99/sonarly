import { Router, Route } from 'wouter';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout.js';
import { Login } from './pages/Login.js';
import { Library } from './pages/Library.js';
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
        <Route path="/songs" component={() => <div>Songs</div>} />
        <Route path="/playlists" component={() => <div>Playlists</div>} />
        <Route path="/ingest" component={() => <div>Ingest</div>} />
        <Route path="/organize" component={() => <div>Organize</div>} />
        <Route path="/users" component={() => <div>Users</div>} />
      </Layout>
    </Router>
  );
}
