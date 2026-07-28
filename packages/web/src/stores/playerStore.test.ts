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

  it('keeps the explicit start index first when shuffle is enabled', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    usePlayer.getState().playQueue(songs, 2, true);

    const state = usePlayer.getState();
    expect(state.shuffle).toBe(true);
    expect(state.shuffledIndices).toHaveLength(songs.length);
    expect(state.shuffledIndices[0]).toBe(2);
    expect(new Set(state.shuffledIndices).size).toBe(songs.length);
  });

  it('picks a random start index when shuffle is enabled and no start index is given', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    usePlayer.getState().playQueue(songs, undefined, true);

    const state = usePlayer.getState();
    expect(state.shuffle).toBe(true);
    expect(state.shuffledIndices).toHaveLength(songs.length);
    expect(new Set(state.shuffledIndices).size).toBe(songs.length);
    // The current song should be the one at the randomly selected start index.
    expect(state.currentSong).toEqual(songs[state.queueIndex]);
  });
});

describe('playAtIndex', () => {
  it('jumps to the given index without replacing the queue', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3')];
    usePlayer.getState().playQueue(songs, 0);
    usePlayer.getState().playAtIndex(2);

    const state = usePlayer.getState();
    expect(state.queue).toEqual(songs);
    expect(state.queueIndex).toBe(2);
    expect(state.currentSong).toEqual(songs[2]);
    expect(state.status).toBe('playing');
    expect(state.currentTime).toBe(0);
  });

  it('preserves shuffle order when jumping to an index', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    usePlayer.getState().playQueue(songs, 0, true);
    const { shuffledIndices } = usePlayer.getState();

    usePlayer.getState().playAtIndex(shuffledIndices[2]);

    const state = usePlayer.getState();
    expect(state.queue).toEqual(songs);
    expect(state.shuffledIndices).toEqual(shuffledIndices);
    expect(state.queueIndex).toBe(shuffledIndices[2]);
    expect(state.currentSong).toEqual(songs[shuffledIndices[2]]);
  });

  it('clamps out-of-bounds indices', () => {
    const songs = [createSong('1'), createSong('2')];
    usePlayer.getState().playQueue(songs, 0);
    usePlayer.getState().playAtIndex(10);

    const state = usePlayer.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong).toEqual(songs[1]);
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
  it('enables shuffle and keeps played items in their current positions', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    const store = usePlayer.getState();
    store.playQueue(songs, 1);
    store.toggleShuffle();

    const state = usePlayer.getState();
    expect(state.shuffle).toBe(true);
    // Played/current prefix (indices 0 and 1) should be preserved.
    expect(state.shuffledIndices.slice(0, 2)).toEqual([0, 1]);
    expect(new Set(state.shuffledIndices).size).toBe(songs.length);
  });

  it('disables shuffle and preserves the current shuffled order', () => {
    const songs = [createSong('1'), createSong('2'), createSong('3'), createSong('4')];
    const store = usePlayer.getState();
    store.playQueue(songs, 0, true);
    const { shuffledIndices } = usePlayer.getState();
    store.toggleShuffle();

    const state = usePlayer.getState();
    expect(state.shuffle).toBe(false);
    expect(state.shuffledIndices).toEqual([]);
    expect(state.queue.map((s) => s.id)).toEqual(shuffledIndices.map((i) => songs[i].id));
    expect(state.currentSong).toEqual(songs[0]);
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

const songA: PlayerSong = { id: 'a', title: 'A', duration: 100, starred: false, rating: 0 } as PlayerSong;
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

  it('marks songs as added by Auto DJ when requested', () => {
    usePlayer.getState().playQueue([songA], 0);
    usePlayer.getState().addToQueue([songB], { addedByAutoDj: true });
    const state = usePlayer.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b']);
    expect(state.queue[1]?.addedByAutoDj).toBe(true);
    expect(state.queue[0]?.addedByAutoDj).toBeUndefined();
  });

  it('removeAutoDjItems removes only unplayed Auto DJ items', () => {
    const autoA: PlayerSong = { ...songB, addedByAutoDj: true };
    const autoB: PlayerSong = { ...songC, addedByAutoDj: true };
    usePlayer.getState().playQueue([songA, autoA, autoB], 0);
    usePlayer.getState().removeAutoDjItems();
    const state = usePlayer.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['a']);
    expect(state.queueIndex).toBe(0);
  });

  it('removeAutoDjItems keeps the current song even if it was added by Auto DJ', () => {
    const autoCurrent: PlayerSong = { ...songA, addedByAutoDj: true };
    const autoNext: PlayerSong = { ...songB, addedByAutoDj: true };
    usePlayer.getState().playQueue([autoCurrent, autoNext], 0);
    usePlayer.getState().removeAutoDjItems();
    const state = usePlayer.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['a']);
    expect(state.queueIndex).toBe(0);
  });

  it('playNext shuffles new indices when shuffle is enabled', () => {
    usePlayer.getState().playQueue([songA, songB, songC], 0, true);
    const songD: PlayerSong = { id: 'd', title: 'D', duration: 100 } as PlayerSong;
    const songE: PlayerSong = { id: 'e', title: 'E', duration: 100 } as PlayerSong;
    usePlayer.getState().playNext([songD, songE]);
    const state = usePlayer.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'd', 'e', 'b', 'c']);
    expect(state.shuffledIndices.slice(0, 1)).toEqual([0]);
    expect(new Set(state.shuffledIndices).size).toBe(state.queue.length);
    // The two newly inserted indices should appear after the current position.
    const newIndices = state.shuffledIndices.slice(1, 3).sort((a, b) => a - b);
    expect(newIndices).toEqual([1, 2]);
  });

  it('addToQueue shuffles new indices when shuffle is enabled', () => {
    usePlayer.getState().playQueue([songA, songB], 0, true);
    usePlayer.getState().addToQueue([songC]);
    const state = usePlayer.getState();
    expect(state.queue.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(state.shuffledIndices).toHaveLength(3);
    expect(state.shuffledIndices).toContain(2);
  });
});

describe('updateCurrentSong', () => {
  beforeEach(() => resetPlayer());

  it('patches the current song and the matching queue item', () => {
    usePlayer.getState().playQueue([songA, songB], 0);
    usePlayer.getState().updateCurrentSong({ starred: true, rating: 5 });

    const state = usePlayer.getState();
    expect(state.currentSong).toEqual(expect.objectContaining({ id: 'a', starred: true, rating: 5 }));
    expect(state.queue[0]).toEqual(expect.objectContaining({ id: 'a', starred: true, rating: 5 }));
    expect(state.queue[1]).toEqual(expect.objectContaining({ id: 'b' }));
    expect(state.queue[1]).not.toHaveProperty('starred');
    expect(state.queue[1]).not.toHaveProperty('rating');
  });

  it('does nothing when no song is playing', () => {
    usePlayer.getState().updateCurrentSong({ starred: true });
    expect(usePlayer.getState().currentSong).toBeNull();
  });
});
