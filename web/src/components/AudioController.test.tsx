// Regression harness for the audio engine (audit F9). jsdom cannot play
// audio, so the media element is stubbed at the prototype (precedent:
// appsmoke.diag.test.tsx), `currentTime`/`duration` are made settable per
// element, and the Media Session API is stubbed because jsdom lacks it.
// Events are driven with fireEvent against the rendered <audio> elements;
// assertions run against the player store, the api mock, and the
// notification mock. Covers: F13 (stall timer vs pause, onPause sync),
// F14 (play-session scrobble re-arm), scrobble threshold/payload, ended
// advance, gapless preloader, Media Session wiring, autoplay-block handling.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { AudioController } from './AudioController.js';
import { usePlayer, resetPlayer, type PlayerSong } from '../stores/playerStore.js';
import { api } from '../lib/api.js';

const mockNotify = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
}));

vi.mock('../contexts/NotificationContext.js', () => ({
  useNotification: () => ({ notify: mockNotify }),
}));

// useAutoDj pulls react-query preferences; its logic has its own suite, so
// keep this harness focused on the controller itself.
vi.mock('../hooks/useAutoDj.js', () => ({
  useAutoDj: vi.fn(),
}));

const apiMock = vi.mocked(api);

const playMock = vi.fn<() => Promise<void>>();
const pauseMock = vi.fn();
const loadMock = vi.fn();

const mediaSessionStub = {
  metadata: null as unknown,
  playbackState: 'none' as string,
  setActionHandler: vi.fn(),
  setPositionState: vi.fn(),
};
const mediaMetadataInits: unknown[] = [];

class MediaMetadataMock {
  constructor(init: unknown) {
    mediaMetadataInits.push(init);
  }
}

function getActionHandler(action: string): (() => void) | undefined {
  const call = mediaSessionStub.setActionHandler.mock.calls.find(([a]) => a === action);
  return call?.[1] as (() => void) | undefined;
}

function createSong(id: string, duration = 100): PlayerSong {
  return { id, title: `Song ${id}`, duration, artistName: `Artist ${id}` } as PlayerSong;
}

function renderController() {
  const { container, unmount } = render(<AudioController />);
  const [audio, preloader] = Array.from(container.querySelectorAll('audio'));
  if (!audio || !preloader) throw new Error('expected both <audio> elements');
  return { audio: audio as HTMLMediaElement, preloader: preloader as HTMLMediaElement, unmount };
}

beforeAll(() => {
  // Media-element stub (appsmoke.diag.test.tsx pattern).
  window.HTMLMediaElement.prototype.play = playMock as unknown as () => Promise<void>;
  window.HTMLMediaElement.prototype.pause = pauseMock as () => void;
  window.HTMLMediaElement.prototype.load = loadMock as () => void;
  Object.defineProperty(window.HTMLMediaElement.prototype, 'canPlayType', {
    value: () => 'maybe',
  });
  // jsdom exposes `duration` as a read-only NaN; make both settable per
  // element so tests can simulate playback progress.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return (this as unknown as { __ct?: number }).__ct ?? 0;
    },
    set(this: HTMLMediaElement, value: number) {
      (this as unknown as { __ct?: number }).__ct = value;
    },
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return (this as unknown as { __dur?: number }).__dur ?? NaN;
    },
    set(this: HTMLMediaElement, value: number) {
      (this as unknown as { __dur?: number }).__dur = value;
    },
  });

  // Media Session stub: jsdom has neither mediaSession nor MediaMetadata.
  Object.defineProperty(navigator, 'mediaSession', {
    value: mediaSessionStub,
    configurable: true,
  });
  vi.stubGlobal('MediaMetadata', MediaMetadataMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  resetPlayer();
  window.localStorage.clear();
  mockNotify.mockClear();
  apiMock.mockReset();
  apiMock.mockResolvedValue(undefined as never);
  playMock.mockReset();
  playMock.mockResolvedValue(undefined);
  pauseMock.mockClear();
  loadMock.mockClear();
  mediaSessionStub.metadata = null;
  mediaSessionStub.playbackState = 'none';
  mediaSessionStub.setActionHandler.mockClear();
  mediaSessionStub.setPositionState.mockClear();
  mediaMetadataInits.length = 0;
});

describe('F13: stall detection vs pause', () => {
  it('surfaces an error when a stall outlives the deadline', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });

    fireEvent.waiting(audio);

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(usePlayer.getState().status).toBe('error');
    expect(mockNotify).toHaveBeenCalledWith('Playback stalled — check your connection', 'error');
  });

  it('does not surface a stall error when the user pauses while buffering', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });

    fireEvent.waiting(audio);
    act(() => {
      usePlayer.getState().pause();
    });

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(usePlayer.getState().status).toBe('paused');
    expect(mockNotify).not.toHaveBeenCalledWith(
      'Playback stalled — check your connection',
      'error',
    );
  });

  it('element-initiated pause syncs the store and Media Session to paused', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });
    // The element confirms it is actually rendering audio.
    fireEvent.playing(audio);
    expect(usePlayer.getState().status).toBe('playing');

    // jsdom elements report paused=true, so this models an OS/interrupt pause.
    fireEvent.pause(audio);

    expect(usePlayer.getState().status).toBe('paused');
    expect(mediaSessionStub.playbackState).toBe('paused');
  });
});

describe('scrobble triggering', () => {
  it('posts at 50% of the track with the completion percentage', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a', 300)], 0);
    });

    // 300s track: threshold is min(50% = 150s, 240s cap) = 150s.
    audio.currentTime = 149;
    fireEvent.timeUpdate(audio);
    expect(apiMock).not.toHaveBeenCalled();

    audio.currentTime = 150;
    fireEvent.timeUpdate(audio);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/songs/a/scrobble', {
      method: 'POST',
      body: JSON.stringify({ client: 'web', source: 'web', durationListened: 150, completion: 50 }),
    });
  });

  it('scrobbles once per play-through and re-arms on a same-song replay (F14)', () => {
    const { audio } = renderController();
    const song = createSong('a');
    act(() => {
      usePlayer.getState().playQueue([song], 0);
    });

    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    expect(apiMock).toHaveBeenCalledTimes(1);

    // Replay the same song: playNow bumps playSession and resets progress.
    act(() => {
      usePlayer.getState().playNow(song);
    });
    expect(usePlayer.getState().playSession).toBe(2);
    // The seek-sync effect rewound the element to the store's currentTime.
    expect(audio.currentTime).toBe(0);

    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenLastCalledWith('/songs/a/scrobble', {
      method: 'POST',
      body: JSON.stringify({ client: 'web', source: 'web', durationListened: 60, completion: 60 }),
    });
  });

  it('re-arms scrobbling when play() restarts the track from queue-end idle (F14)', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });

    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    expect(apiMock).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayer.getState().setStatus('idle');
      usePlayer.getState().play();
    });

    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('repeat-one still scrobbles exactly twice across the replay (regression)', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
      usePlayer.getState().cycleRepeat();
      usePlayer.getState().cycleRepeat(); // one
    });

    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    expect(apiMock).toHaveBeenCalledTimes(1);

    fireEvent.ended(audio);

    expect(usePlayer.getState().currentSong?.id).toBe('a');
    expect(usePlayer.getState().status).toBe('playing');

    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('scrobbles 100% completion and advances when the track ends', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a'), createSong('b')], 0);
    });

    fireEvent.ended(audio);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/songs/a/scrobble', {
      method: 'POST',
      body: JSON.stringify({ client: 'web', source: 'web', durationListened: 100, completion: 100 }),
    });
    expect(usePlayer.getState().currentSong?.id).toBe('b');
    // The new track is loading until the element confirms playback.
    fireEvent.playing(audio);
    expect(usePlayer.getState().status).toBe('playing');
  });
});

describe('gapless preloader', () => {
  it('buffers the next track once under 30s remain and stops at the queue end', () => {
    const { audio, preloader } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a'), createSong('b')], 0);
    });

    audio.currentTime = 40;
    fireEvent.timeUpdate(audio);
    expect(preloader.getAttribute('src')).toBeNull();

    audio.currentTime = 80;
    fireEvent.timeUpdate(audio);
    expect(preloader.getAttribute('src')).toBe('/rest/stream.view?id=b');

    // Advance to the last track: nothing left to preload.
    act(() => {
      usePlayer.getState().next();
    });
    expect(preloader.getAttribute('src')).toBeNull();
  });
});

describe('Media Session', () => {
  it('publishes metadata and playback state for the current song', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });

    expect(mediaMetadataInits).toHaveLength(1);
    expect(mediaMetadataInits[0]).toEqual(
      expect.objectContaining({ title: 'Song a', artist: 'Artist a' }),
    );

    fireEvent.playing(audio);
    expect(mediaSessionStub.playbackState).toBe('playing');

    act(() => {
      usePlayer.getState().pause();
    });
    expect(mediaSessionStub.playbackState).toBe('paused');
  });

  it('routes hardware actions through the store and clears handlers on unmount', () => {
    const { unmount } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a'), createSong('b')], 0);
    });

    act(() => {
      getActionHandler('nexttrack')?.();
    });
    expect(usePlayer.getState().currentSong?.id).toBe('b');

    unmount();
    expect(mediaSessionStub.setActionHandler).toHaveBeenCalledWith('play', null);
  });
});

describe('autoplay handling', () => {
  it('a blocked autoplay pauses with a friendly notification instead of an error', async () => {
    renderController();

    playMock.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(usePlayer.getState().status).toBe('paused');
    expect(mockNotify).toHaveBeenCalledWith('Press play to start playback', 'info');
  });

  it('an aborted play() during rapid skips is swallowed', async () => {
    const { audio } = renderController();

    playMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.playing(audio);

    expect(usePlayer.getState().status).toBe('playing');
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('media element error (unplayable stream)', () => {
  it('skips ahead to the next track instead of dead-stopping the queue', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a'), createSong('b')], 0);
    });

    fireEvent.error(audio);

    const state = usePlayer.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('b');
    // The song-change effect reloads the element: loading until playback
    // events confirm it actually plays.
    expect(state.status).toBe('loading');
    expect(mockNotify).toHaveBeenCalledWith('Skipped a track that could not be played', 'info');
  });

  it('gives up with an error status when there is no next track', () => {
    const { audio } = renderController();
    act(() => {
      usePlayer.getState().playQueue([createSong('a')], 0);
    });

    fireEvent.error(audio);

    expect(usePlayer.getState().status).toBe('error');
    expect(mockNotify).toHaveBeenCalledWith('Could not play track', 'error');
  });

  it('stops skipping after a bounded run of consecutive failures', () => {
    const { audio } = renderController();
    const songs = Array.from({ length: 8 }, (_, i) => createSong(`s${i}`));
    act(() => {
      usePlayer.getState().playQueue(songs, 0, true);
    });

    for (let i = 0; i < 5; i += 1) {
      fireEvent.error(audio);
    }

    const state = usePlayer.getState();
    expect(state.status).toBe('error');
    expect(mockNotify).toHaveBeenLastCalledWith('Could not play track', 'error');
  });

  it('resets the failure count once a track plays successfully', () => {
    const { audio } = renderController();
    const songs = [createSong('a'), createSong('b'), createSong('c')];
    act(() => {
      usePlayer.getState().playQueue(songs, 0);
    });

    fireEvent.error(audio);
    expect(usePlayer.getState().currentSong?.id).toBe('b');
    fireEvent.playing(audio);

    // Two more failures would exceed the bound if the count had not reset.
    fireEvent.error(audio);
    expect(usePlayer.getState().currentSong?.id).toBe('c');
    fireEvent.error(audio);
    expect(usePlayer.getState().status).toBe('error');
  });
});
