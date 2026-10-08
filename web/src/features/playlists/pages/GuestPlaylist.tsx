import { Link } from 'wouter';
import { PlaylistDetail } from './PlaylistDetail.js';
import { PlayerBar } from '../../../components/PlayerBar.js';
import { AudioController } from '../../../components/AudioController.js';
import type { UnderlayParams } from '../../../lib/types.js';

// Minimal shell for anonymous share-link visitors: no sidebar, no account
// chrome, just the shared playlist, a player bar, and a way to sign in.
// `underlay` is set when this shell mounts under the now-playing route —
// wouter params don't reach the detail page there (see lib/types.ts).
export function GuestPlaylist({ underlay }: { underlay?: UnderlayParams }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-primary text-fg-primary">
      <header className="flex shrink-0 items-center justify-between px-6 py-3">
        <span className="font-display text-lg font-semibold text-fg-primary">Sonarly</span>
        <Link
          href="/login"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-fg-secondary transition hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign in
        </Link>
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        <PlaylistDetail user={null} underlay={underlay} />
      </main>
      <PlayerBar />
      <AudioController />
    </div>
  );
}
