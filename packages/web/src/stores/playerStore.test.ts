import { describe, it, expect, beforeEach } from 'vitest';
import type { Song } from '@sonarly/shared';
import { usePlayer, resetPlayer, type PlayerSong } from './playerStore.js';

function createSong(id: string, title = `Song ${id}`): Song {
  return {
    id,
    filePath: `/music/${id}.mp3`,
    title,
    mtime: 0,
    checksum: `checksum-${id}`,
  };
}

beforeEach(() => {
  resetPlayer();
});

describe('playQueue', () => {
  it('sets the queue and starts playback at the given index', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3')];
    usePlayer.getState().playQueue(songs, 1);

    const state = usePlayer.getState();
    expect(state.queue).toEqual(songs);
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong).toEqual(songs[1]);
    expect(state.status).toBe('playing');
    expect(state.currentTime).toBe(0);
    expect(state.duration).toBe(0);
  });

  it('starts at the first song when startIndex is out of bounds', () => {
    const songs = [createSong('1'), createSong('2')];
    usePlayer.getState().playQueue(songs, 10);

    const state = usePlayer.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong).toEqual(songs[1]);
  });

  it('keeps the current song first when shuffle is enabled', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    usePlayer.getState().playQueue(songs, 2, true);

    const state = usePlayer.getState();
    expect(state.shuffle).toBe(true);
    expect(state.shuffledIndices).toHaveLength(songs.length);
    expect(state.shuffledIndices[0]).toBe(2);
    expect(new Set(state.shuffledIndices).size).toBe(songs.length);
  });
});

describe('next', () => {
  it('advances to the next song in the queue', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3')];
    usePlayer.getState().playQueue(songs, 0);
    usePlayer.getState().next();

    const state = usePlayer.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong).toEqual(songs[1]);
    expect(state.status).toBe('playing');
  });

  it('wraps to the start when repeat is all', () => {
    const songs = [createSong('1'), createSong('2')];
    const store = usePlayer.getState();
    store.playQueue(songs, 1);
    store.cycleRepeat(); // off -> all
    store.next();

    const state = usePlayer.getState();
    expect(state.queueIndex).toBe(0);
    expect(state.currentSong).toEqual(songs[0]);
  });

  it('stops playback when the queue ends with repeat off', () => {
    const songs = [createSong('1'), createSong('2')];
    const store = usePlayer.getState();
    store.playQueue(songs, 1);
    store.next();

    const state = usePlayer.getState();
    expect(state.status).toBe('idle');
    expect(state.currentSong).toEqual(songs[1]);
  });

  it('follows the shuffled order when shuffle is enabled', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    const store = usePlayer.getState();
    store.playQueue(songs, 0, true);
    const { shuffledIndices } = usePlayer.getState();

    store.next();
    expect(usePlayer.getState().queueIndex).toBe(shuffledIndices[1]);
  });
});

describe('toggleShuffle', () => {
  it('enables shuffle and keeps the current song first', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3')];
    const store = usePlayer.getState();
    store.playQueue(songs, 1);
    store.toggleShuffle();

    const state = usePlayer.getState();
    expect(state.shuffle).toBe(true);
    expect(state.shuffledIndices[0]).toBe(1);
    expect(new Set(state.shuffledIndices).size).toBe(songs.length);
  });

  it('disables shuffle and clears shuffled indices', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3')];
    const store = usePlayer.getState();
    store.playQueue(songs, 0, true);
    store.toggleShuffle();

    const state = usePlayer.getState();
    expect(state.shuffle).toBe(false);
    expect(state.shuffledIndices).toEqual([]);
  });
});

describe('cycleRepeat', () => {
  it('cycles through off, all, and one', () => {
    const store = usePlayer.getState();
    expect(store.repeat).toBe('off');

    store.cycleRepeat();
    expect(usePlayer.getState().repeat).toBe('all');

    store.cycleRepeat();
    expect(usePlayer.getState().repeat).toBe('one');

    store.cycleRepeat();
    expect(usePlayer.getState().repeat).toBe('off');
  });
});

describe('onEnded', () => {
  it('restarts the current song when repeat is one', () => {
    const songs = [createSong('1'), createSong('2')];
    const store = usePlayer.getState();
    store.playQueue(songs, 0);
    store.setDuration(120);
    store.setCurrentTime(100);
    store.cycleRepeat();
    store.cycleRepeat(); // one

    store.onEnded();

    const state = usePlayer.getState();
    expect(state.queueIndex).toBe(0);
    expect(state.currentSong).toEqual(songs[0]);
    expect(state.currentTime).toBe(0);
    expect(state.status).toBe('playing');
  });

  it('advances to the next song when repeat is not one', () => {
    const songs = [createSong('1'), createSong('2')];
    const store = usePlayer.getState();
    store.playQueue(songs, 0);
    store.onEnded();

    const state = usePlayer.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong).toEqual(songs[1]);
  });
});

const songA: PlayerSong = { id: 'a', title: 'A', duration: 100 } as PlayerSong;
const songB: PlayerSong = { id: 'b', title: 'B', duration: 100 } as PlayerSong;
const songC: PlayerSong = { id: 'c', title: 'C', duration: 100 } as PlayerSong;

describe('playerStore queue actions', () => {
  beforeEach(() => resetPlayer());

  it('playNext inserts after current index', () => {
    usePlayer.getState().playQueue([songA, songB], 0);
    usePlayer.getState().playNext(songC);
    const state = usePlayer.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(state.queueIndex).toBe(0);
    expect(state.currentSong?.id).toBe('a');
  });

  it('addToQueue appends to the end', () => {
    usePlayer.getState().playQueue([songA], 0);
    usePlayer.getState().addToQueue([songB, songC]);
    const state = usePlayer.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(state.queueIndex).toBe(0);
  });
});
