import { useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { getShareToken, withShareToken } from '../lib/shareToken.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayer } from '../stores/playerStore.js';
import { useAutoDj } from '../hooks/useAutoDj.js';

// Subsonic-style scrobble rule: 50% of the track or 4 minutes, whichever
// comes first.
const SCROBBLE_MIN_FRACTION = 0.5;
const SCROBBLE_MAX_SECONDS = 240;
// How long playback may stall before surfacing an error.
const STALLED_ERROR_DELAY_MS = 15000;

export function AudioController() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastScrobbledRef = useRef<string | null>(null);
  const stalledTimerRef = useRef<number | null>(null);
  const { notify } = useNotification();

  const currentSong = usePlayer((state) => state.currentSong);
  const status = usePlayer((state) => state.status);
  const volume = usePlayer((state) => state.volume);
  const currentTime = usePlayer((state) => state.currentTime);

  const play = usePlayer((state) => state.play);
  const setStatus = usePlayer((state) => state.setStatus);
  const setDuration = usePlayer((state) => state.setDuration);
  const setCurrentTime = usePlayer((state) => state.setCurrentTime);
  const onEnded = usePlayer((state) => state.onEnded);

  useAutoDj();

  const clearStalledTimer = () => {
    if (stalledTimerRef.current !== null) {
      window.clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = null;
    }
  };

  const handlePlayError = (err: unknown) => {
    if (err instanceof DOMException) {
      // Rapid track skips abort pending play() calls; that is expected.
      if (err.name === 'AbortError') return;
      // Autoplay was blocked; wait for a user gesture instead of erroring.
      if (err.name === 'NotAllowedError') {
        setStatus('paused');
        notify('Press play to start playback', 'info');
        return;
      }
    }
    setStatus('error');
  };

  useEffect(() => {
    lastScrobbledRef.current = null;
    clearStalledTimer();
    const audio = audioRef.current;
    if (!audio) return;

    if (currentSong) {
      setStatus('loading');
      // /rest/stream.view needs a session; anonymous share-link viewers use
      // the token-scoped /api/stream endpoint instead.
      const shareToken = getShareToken();
      audio.src = shareToken
        ? `/api/stream/${currentSong.id}?shareToken=${encodeURIComponent(shareToken)}`
        : `/rest/stream.view?id=${currentSong.id}`;
      audio.load();
      audio.play().catch(handlePlayError);
    } else {
      audio.removeAttribute('src');
      audio.load();
    }
  }, [currentSong?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (status === 'playing') {
      audio.play().catch(handlePlayError);
    } else if (status === 'paused') {
      audio.pause();
    }
  }, [status]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    if (Math.abs(audio.currentTime - currentTime) > 0.1) {
      audio.currentTime = currentTime;
      if (status === 'playing' && audio.paused) {
        audio.play().catch(handlePlayError);
      }
    }
  }, [currentTime, currentSong?.id, status]);

  // Media Session: hardware/OS media keys drive the player store.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => usePlayer.getState().play()],
      ['pause', () => usePlayer.getState().pause()],
      ['previoustrack', () => usePlayer.getState().previous()],
      ['nexttrack', () => usePlayer.getState().next()],
    ];
    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore.
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    if (!currentSong) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const coverId = currentSong.albumCoverArt ?? currentSong.coverArt;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.title,
      artist: currentSong.artistName || 'Unknown artist',
      album: currentSong.albumName || '',
      artwork: coverId ? [{ src: withShareToken(`/api/cover-art/${coverId}`), sizes: '512x512' }] : [],
    });
  }, [currentSong?.id]);

  useEffect(() => {
    return () => {
      if (stalledTimerRef.current !== null) {
        window.clearTimeout(stalledTimerRef.current);
      }
    };
  }, []);

  const armStalledTimer = () => {
    clearStalledTimer();
    stalledTimerRef.current = window.setTimeout(() => {
      stalledTimerRef.current = null;
      setStatus('error');
      notify('Playback stalled — check your connection', 'error');
    }, STALLED_ERROR_DELAY_MS);
  };

  const handlePlay = () => {
    clearStalledTimer();
    play();
  };

  const handlePlaying = () => {
    clearStalledTimer();
    play();
  };

  const handleWaiting = () => {
    const currentStatus = usePlayer.getState().status;
    if (currentStatus === 'playing') {
      setStatus('loading');
      armStalledTimer();
    } else if (currentStatus === 'loading') {
      armStalledTimer();
    }
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (audio) {
      setDuration(audio.duration || 0);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    // Progress means playback is healthy; cancel any pending stall error.
    clearStalledTimer();
    setCurrentTime(audio.currentTime);

    if (!currentSong || lastScrobbledRef.current === currentSong.id) return;
    const duration = audio.duration || currentSong.duration || 0;
    if (duration <= 0) return;
    const threshold = Math.min(duration * SCROBBLE_MIN_FRACTION, SCROBBLE_MAX_SECONDS);
    if (audio.currentTime >= threshold) {
      scrobble(currentSong.id);
    }
  };

  const scrobble = (songId: string) => {
    if (songId === lastScrobbledRef.current) return;
    api(`/songs/${songId}/scrobble`, { method: 'POST' }).catch(() => {});
    lastScrobbledRef.current = songId;
  };

  const handleEnded = () => {
    clearStalledTimer();
    if (currentSong) {
      scrobble(currentSong.id);
    }
    // Repeat-one replays the same song id, so the song-change effect never
    // resets the scrobble guard; reset it here or replays never scrobble.
    if (usePlayer.getState().repeat === 'one') {
      lastScrobbledRef.current = null;
    }
    onEnded();
  };

  const handleError = () => {
    clearStalledTimer();
    setStatus('error');
    notify('Could not play track', 'error');
  };

  return (
    <audio
      ref={audioRef}
      preload="metadata"
      onLoadedMetadata={handleLoadedMetadata}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
      onPlay={handlePlay}
      onPlaying={handlePlaying}
      onWaiting={handleWaiting}
      onStalled={handleWaiting}
      onError={handleError}
      className="hidden"
    />
  );
}
