import { useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { getShareToken, withShareToken } from '../lib/shareToken.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayer, getNextSong } from '../stores/playerStore.js';
import { useAutoDj } from '../hooks/useAutoDj.js';
import { useSleepTimer, SLEEP_TIMER_ENDED_MESSAGE } from '../hooks/useSleepTimer.js';

// Subsonic-style scrobble rule: 50% of the track or 4 minutes, whichever
// comes first.
const SCROBBLE_MIN_FRACTION = 0.5;
const SCROBBLE_MAX_SECONDS = 240;
// How long playback may stall before surfacing an error.
const STALLED_ERROR_DELAY_MS = 15000;
// Start buffering the next track when this much of the current one remains.
const PRELOAD_REMAINING_SECONDS = 30;

// /rest/stream.view needs a session; anonymous share-link viewers use
// the token-scoped /api/stream endpoint instead. The gapless preloader
// uses this too so both audio elements always request identical URLs.
function streamUrl(songId: string): string {
  const shareToken = getShareToken();
  return shareToken
    ? `/api/stream/${songId}?shareToken=${encodeURIComponent(shareToken)}`
    : `/rest/stream.view?id=${songId}`;
}

export function AudioController() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const preloadRef = useRef<HTMLAudioElement>(null);
  const preloadedUrlRef = useRef<string | null>(null);
  const lastScrobbledRef = useRef<string | null>(null);
  const stalledTimerRef = useRef<number | null>(null);
  const { notify } = useNotification();

  const currentSong = usePlayer((state) => state.currentSong);
  const status = usePlayer((state) => state.status);
  const volume = usePlayer((state) => state.volume);
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  const queue = usePlayer((state) => state.queue);
  const queueIndex = usePlayer((state) => state.queueIndex);
  const shuffle = usePlayer((state) => state.shuffle);
  const repeat = usePlayer((state) => state.repeat);
  const shuffledIndices = usePlayer((state) => state.shuffledIndices);

  const play = usePlayer((state) => state.play);
  const setStatus = usePlayer((state) => state.setStatus);
  const setDuration = usePlayer((state) => state.setDuration);
  const setCurrentTime = usePlayer((state) => state.setCurrentTime);
  const onEnded = usePlayer((state) => state.onEnded);

  useAutoDj();
  useSleepTimer();

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
      audio.src = streamUrl(currentSong.id);
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

  // Gapless aid: when the current track is almost over, silently buffer the
  // next queue item on a second audio element so the browser cache is warm
  // when `ended` fires. Track changes and rapid skips re-run this effect and
  // replace or abort any in-flight preload; pausing keeps it.
  useEffect(() => {
    const preloader = preloadRef.current;
    if (!preloader) return;

    const trackDuration = duration || currentSong?.duration || 0;
    const remaining = trackDuration - currentTime;
    let url: string | null = null;
    if (currentSong && trackDuration > 0 && remaining <= PRELOAD_REMAINING_SECONDS) {
      const nextSong = getNextSong({ queue, queueIndex, shuffle, repeat, shuffledIndices });
      if (nextSong) {
        url = streamUrl(nextSong.id);
      }
    }

    if (url === preloadedUrlRef.current) return;
    preloadedUrlRef.current = url;
    if (url) {
      preloader.src = url;
    } else {
      preloader.removeAttribute('src');
    }
    // load() starts the fetch for a new src and aborts it when src was removed.
    preloader.load();
  }, [currentTime, duration, currentSong?.id, queue, queueIndex, shuffle, repeat, shuffledIndices]);

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
      ['seekto', (details) => {
        if (details.seekTime !== undefined) usePlayer.getState().seek(details.seekTime);
      }],
      ['seekbackward', () => {
        const s = usePlayer.getState();
        s.seek(Math.max(0, s.currentTime - 10));
      }],
      ['seekforward', () => {
        const s = usePlayer.getState();
        s.seek(Math.min(s.duration || s.currentTime + 10, s.currentTime + 10));
      }],
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

  // Lock-screen/notification playback state + progress bar.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = status === 'playing' ? 'playing' : 'paused';
  }, [status]);

  const positionSecond = Math.floor(currentTime);
  useEffect(() => {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    if (!duration || !Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {
      // Invalid position state (e.g. position beyond duration) — ignore.
    }
  }, [positionSecond, duration]);

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
      scrobble(currentSong.id, audio.currentTime, duration);
    }
  };

  const scrobble = (songId: string, listenedSeconds?: number, trackDuration?: number) => {
    if (songId === lastScrobbledRef.current) return;
    const body: Record<string, unknown> = { client: 'web', source: 'web' };
    if (listenedSeconds !== undefined && trackDuration && trackDuration > 0) {
      body.durationListened = Math.round(listenedSeconds);
      body.completion = Math.min(1, listenedSeconds / trackDuration);
    }
    api(`/songs/${songId}/scrobble`, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
    lastScrobbledRef.current = songId;
  };

  const handleEnded = () => {
    clearStalledTimer();
    if (currentSong) {
      const duration = audioRef.current?.duration || currentSong.duration || 0;
      scrobble(currentSong.id, duration, duration);
    }
    // Repeat-one replays the same song id, so the song-change effect never
    // resets the scrobble guard; reset it here or replays never scrobble.
    if (usePlayer.getState().repeat === 'one') {
      lastScrobbledRef.current = null;
    }
    onEnded();
    // Sleep timer "end of track": the current song has finished and the
    // store has advanced; stop playback here instead of playing on.
    const afterAdvance = usePlayer.getState();
    if (afterAdvance.sleepTimer.mode === 'endOfTrack') {
      if (afterAdvance.status === 'playing') {
        afterAdvance.pause();
      }
      afterAdvance.clearSleepTimer();
      notify(SLEEP_TIMER_ENDED_MESSAGE, 'info');
    }
  };

  const handleError = () => {
    clearStalledTimer();
    setStatus('error');
    notify('Could not play track', 'error');
  };

  return (
    <>
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
      {/* Gapless aid: hidden preloader for the next track; never plays. */}
      <audio ref={preloadRef} preload="auto" aria-hidden="true" className="hidden" />
    </>
  );
}
