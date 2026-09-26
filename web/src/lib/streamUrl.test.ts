import { describe, it, expect, beforeEach } from 'vitest';
import { streamUrl } from './streamUrl.js';

describe('streamUrl', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('builds the session stream URL when no share token is present', () => {
    expect(streamUrl('song-1')).toBe('/rest/stream.view?id=song-1');
  });

  it('uses the server share param (not shareToken) for guest streams', () => {
    window.history.pushState({}, '', '/playlists/p1?shareToken=tok-123');
    const url = streamUrl('song-1');
    expect(url).toContain('/api/stream/song-1?share=');
    expect(url).not.toContain('shareToken=');
  });

  it('round-trips URL-encoded tokens', () => {
    const token = 'tok/+=abc';
    window.history.pushState({}, '', `/?shareToken=${encodeURIComponent(token)}`);
    expect(streamUrl('s')).toBe(`/api/stream/s?share=${encodeURIComponent(token)}`);
  });
});
