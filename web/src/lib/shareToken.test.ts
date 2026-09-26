import { describe, it, expect, beforeEach } from 'vitest';
import { getShareToken, withShareToken } from './shareToken.js';

describe('shareToken helpers', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('getShareToken reads the token from the URL', () => {
    window.history.pushState({}, '', '/playlists/p1?shareToken=tok-123');
    expect(getShareToken()).toBe('tok-123');
  });

  it('getShareToken is undefined without a token', () => {
    expect(getShareToken()).toBeUndefined();
  });

  it('withShareToken returns the path unchanged when no token is present', () => {
    expect(withShareToken('/playlists/p1')).toBe('/playlists/p1');
  });

  it('withShareToken appends shareToken by default (playlist endpoints)', () => {
    window.history.pushState({}, '', '/x?shareToken=tok-123');
    expect(withShareToken('/playlists/p1')).toBe('/playlists/p1?shareToken=tok-123');
  });

  it('withShareToken appends the playback share param on request', () => {
    window.history.pushState({}, '', '/x?shareToken=tok-123');
    expect(withShareToken('/api/cover-art/ca-1', 'share')).toBe('/api/cover-art/ca-1?share=tok-123');
  });

  it('withShareToken joins an existing query string with &', () => {
    window.history.pushState({}, '', '/x?shareToken=tok-123');
    expect(withShareToken('/playlists/p1/albums?limit=4')).toBe(
      '/playlists/p1/albums?limit=4&shareToken=tok-123',
    );
  });

  it('withShareToken URL-encodes the token', () => {
    const token = 'tok/+=abc';
    window.history.pushState({}, '', `/?shareToken=${encodeURIComponent(token)}`);
    expect(withShareToken('/api/cover-art/ca-1', 'share')).toBe(
      `/api/cover-art/ca-1?share=${encodeURIComponent(token)}`,
    );
  });
});
