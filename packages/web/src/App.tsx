import { Router, Route, Switch, useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import type { User } from '@sonarly/shared';
import { Layout } from './components/Layout.js';
import { Login } from './features/auth/index.js';
import { Setup } from './features/setup/index.js';
import { HomePage } from './features/home/index.js';
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
import { SettingsPlayback } from './features/settings/index.js';
import { SettingsSidebar } from './features/settings/index.js';
import { Artists, Artist } from './features/artists/index.js';
import { Albums, Album } from './features/albums/index.js';
import { Tracks, Track } from './features/tracks/index.js';
import { SearchResults } from './features/search/index.js';
import { AlbumArtists } from './features/album-artists/index.js';
import { Genres, Genre } from './features/genres/index.js';
import { Years, Year } from './features/years/index.js';
import { Composers } from './features/composers/index.js';
import { Composer } from './features/composers/pages/Composer.js';
import { Labels } from './features/labels/index.js';
import { Label } from './features/labels/pages/Label.js';
import { StatisticsPage } from './features/statistics/index.js';
import { AdminRefreshProvider } from './features/admin/contexts/AdminRefreshContext.js';
import { useServerEvents } from './hooks/useServerEvents.js';
import { api } from './lib/api.js';

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
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);

  useServerEvents({ enabled: Boolean(user) });

  const AdminRoute = (Component: React.ComponentType<{ user: User }>) => () => (
    <AdminRefreshProvider>
      <Component user={user as User} />
    </AdminRefreshProvider>
  );

  useEffect(() => {
    let cancelled = false;
    setBootError(false);
    Promise.all([
      api<{ needsSetup: boolean }>('/setup').catch(() => ({ needsSetup: false })),
      // Use fetch directly so a 401 (logged out) can be told apart from
      // network/server errors, which should not bounce the user to login.
      fetch('/api/me', { credentials: 'include' }).then(async (res) => {
        if (res.status === 401) return null;
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { user: User };
        return data.user;
      }),
    ])
      .then(([setup, me]) => {
        if (cancelled) return;
        setNeedsSetup(setup.needsSetup);
        setUser(me);
      })
      .catch(() => {
        if (!cancelled) setBootError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('sonarly:unauthorized', handler);
    return () => window.removeEventListener('sonarly:unauthorized', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        target instanceof HTMLImageElement ||
        target.getAttribute('role') === 'img' ||
        target.closest('a') !== null
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  useEffect(() => {
    const isInsideDropZone = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.closest('[data-upload-drop-zone]') !== null;
    };

    const preventDefault = (e: DragEvent) => {
      if (isInsideDropZone(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('dragover', preventDefault);
    document.addEventListener('drop', preventDefault);
    return () => {
      document.removeEventListener('dragover', preventDefault);
      document.removeEventListener('drop', preventDefault);
    };
  }, []);

  if (bootError) {
    return (
      <div
        role="alert"
        className="flex h-screen items-center justify-center bg-bg-primary text-fg-secondary"
      >
        <div className="flex flex-col items-center gap-3">
          <span className="font-display text-xl font-bold text-fg-primary">Sonarly</span>
          <span className="text-sm">Could not reach the server.</span>
          <button
            type="button"
            onClick={() => setBootAttempt((n) => n + 1)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (user === undefined || needsSetup === undefined) {
    return (
      <div
        role="status"
        className="flex h-screen items-center justify-center bg-bg-primary text-fg-secondary"
      >
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
        <Switch>
          <Route path="/setup" component={() => <Setup onSetup={(u) => { setUser(u); setNeedsSetup(false); }} />} />
          <Route path="*" component={() => <Redirect to="/setup" />} />
        </Switch>
      </Router>
    );
  }

  if (!user) {
    return (
      <Router>
        <Switch>
          <Route path="/login" component={() => <Login onLogin={(u) => setUser(u)} />} />
          <Route path="*" component={() => <Redirect to="/login" />} />
        </Switch>
      </Router>
    );
  }

  return (
    <Router>
      <Layout user={user} onUserChange={setUser}>
        <Switch>
          <Route path="/" component={() => <HomePage user={user} />} />
          <Route path="/home" component={() => <HomePage user={user} />} />
          <Route path="/tracks" component={() => <Tracks user={user} />} />
          <Route path="/tracks/:id" component={Track} />
          <Route path="/search" component={() => <SearchResults user={user} />} />
          <Route path="/playlists" component={Playlists} />
          <Route path="/playlists/:id" component={() => <PlaylistDetail user={user} />} />
          <Route path="/albums" component={() => <Albums user={user} />} />
          <Route path="/albums/:id" component={() => <Album user={user} />} />
          <Route path="/artists" component={Artists} />
          <Route path="/artists/:id" component={() => <Artist user={user} />} />
          <Route path="/album-artists" component={AlbumArtists} />
          <Route path="/album-artists/:id" component={() => <Artist user={user} />} />
          <Route path="/genres" component={Genres} />
          <Route path="/genres/:genre" component={Genre} />
          <Route path="/years" component={Years} />
          <Route path="/years/:year" component={Year} />
          <Route path="/composers" component={Composers} />
          <Route path="/composers/:name" component={Composer} />
          <Route path="/labels" component={Labels} />
          <Route path="/labels/:name" component={Label} />
          <Route path="/organize" component={Organize} />
          <Route path="/admin" component={() => <Redirect to="/admin/status" />} />
          <Route path="/admin/status" component={AdminRoute(AdminStatus)} />
          <Route path="/admin/libraries" component={AdminRoute(AdminLibraries)} />
          <Route path="/admin/media" component={AdminRoute(AdminMedia)} />
          <Route path="/admin/users" component={AdminRoute(AdminUsers)} />
          <Route path="/admin/system-tasks" component={AdminRoute(AdminSystemTasks)} />
          <Route path="/admin/genres" component={AdminRoute(AdminGenres)} />
          <Route path="/statistics" component={() => <StatisticsPage mode="me" />} />
          <Route path="/settings" component={() => <Redirect to="/settings/profile" />} />
          <Route path="/settings/profile" component={() => <SettingsProfile user={user} onUserChange={setUser} />} />
          <Route path="/settings/appearance" component={SettingsAppearance} />
          <Route path="/settings/playback" component={SettingsPlayback} />
          <Route path="/settings/sidebar" component={SettingsSidebar} />
          <Route path="/users" component={() => <Redirect to="/admin/users" />} />
          <Route path="*" component={() => <Redirect to="/" />} />
        </Switch>
      </Layout>
    </Router>
  );
}
