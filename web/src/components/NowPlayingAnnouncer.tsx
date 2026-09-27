import { usePlayer } from '../stores/playerStore.js';

// Audit F26: track changes update the player chrome silently. A polite live
// region announces each new track so screen-reader users pressing Next get
// feedback; only success/info toasts and this region may be polite — errors
// stay assertive in NotificationContext.
export function NowPlayingAnnouncer() {
  const currentSong = usePlayer((state) => state.currentSong);

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {currentSong ? `Now playing: ${currentSong.title} by ${currentSong.artistName || 'Unknown artist'}` : ''}
    </div>
  );
}
