import { useEffect, useRef } from 'react';
import { api } from '../api.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayer } from '../stores/playerStore.js';

export function AudioController() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastScrobbledRef = useRef<string | null>(null);
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

  useEffect(() => {
    lastScrobbledRef.current = null;
    const audio = audioRef.current;
    if (!audio) return;

    if (currentSong) {
      setStatus('loading');
      audio.src = `/rest/stream.view?id=${currentSong.id}`;
      audio.load();
      audio.play().catch(() => setStatus('error'));
    } else {
      audio.removeAttribute('src');
      audio.load();
    }
  }, [currentSong?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (status === 'playing') {
      audio.play().catch(() => setStatus('error'));
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
        audio.play().catch(() => setStatus('error'));
      }
    }
  }, [currentTime, currentSong?.id, status]);

  const handlePlay = () => {
    play();
    if (currentSong) {
      scrobble(currentSong.id);
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
    if (audio) {
      setCurrentTime(audio.currentTime);
    }
  };

  const scrobble = (songId: string) => {
    if (songId === lastScrobbledRef.current) return;
    api(`/songs/${songId}/scrobble`, { method: 'POST' }).catch(() => {});
    lastScrobbledRef.current = songId;
  };

  const handleEnded = () => {
    if (currentSong) {
      scrobble(currentSong.id);
    }
    onEnded();
  };

  const handleError = () => {
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
      onError={handleError}
      className="hidden"
    />
  );
}
