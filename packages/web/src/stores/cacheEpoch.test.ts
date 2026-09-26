import { describe, it, expect, beforeEach } from 'vitest';
import { useCacheEpochStore, useCacheEpoch, bumpCacheEpoch, resetCacheEpoch } from './cacheEpoch.js';

describe('cacheEpoch store', () => {
  beforeEach(() => {
    resetCacheEpoch();
  });

  it('starts at epoch 0', () => {
    expect(useCacheEpochStore.getState().epoch).toBe(0);
  });

  it('bump increments the epoch', () => {
    bumpCacheEpoch();
    bumpCacheEpoch();
    expect(useCacheEpochStore.getState().epoch).toBe(2);
  });

  it('useCacheEpoch subscribes to the epoch', () => {
    let seen = -1;
    const unsubscribe = useCacheEpochStore.subscribe((state) => {
      seen = state.epoch;
    });
    bumpCacheEpoch();
    expect(seen).toBe(1);
    expect(useCacheEpochStore.getState().epoch).toBe(1);
    unsubscribe();
  });
});
