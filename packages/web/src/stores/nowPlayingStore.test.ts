import { describe, it, expect, beforeEach } from 'vitest';
import { useNowPlaying, resetNowPlaying } from './nowPlayingStore.js';

beforeEach(() => {
  resetNowPlaying();
});

describe('nowPlayingStore', () => {
  it('starts closed with queue tab active', () => {
    const state = useNowPlaying.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeTab).toBe('queue');
  });

  it('opens and closes', () => {
    useNowPlaying.getState().open();
    expect(useNowPlaying.getState().isOpen).toBe(true);
    useNowPlaying.getState().close();
    expect(useNowPlaying.getState().isOpen).toBe(false);
  });

  it('toggles open state', () => {
    useNowPlaying.getState().toggle();
    expect(useNowPlaying.getState().isOpen).toBe(true);
    useNowPlaying.getState().toggle();
    expect(useNowPlaying.getState().isOpen).toBe(false);
  });

  it('sets active tab', () => {
    useNowPlaying.getState().setActiveTab('lyrics');
    expect(useNowPlaying.getState().activeTab).toBe('lyrics');
  });
});
