import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDominantColor } from './useDominantColor.js';

// jsdom has no real image decode or 2d canvas context — stub both stages and
// count constructions to prove cache/dedup behavior (audit F29, plan P8).
class FakeImage {
  static instances: FakeImage[] = [];
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';

  constructor() {
    FakeImage.instances.push(this);
  }

  get src() {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      if (failingUrls.has(value)) this.onerror?.();
      else this.onload?.();
    });
  }
}

const failingUrls = new Set<string>();

function fakeGetContext(this: HTMLCanvasElement) {
  return {
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 200;
        data[i + 1] = 50;
        data[i + 2] = 50;
        data[i + 3] = 255;
      }
      return { data, width: w, height: h };
    },
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  FakeImage.instances = [];
  failingUrls.clear();
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(fakeGetContext as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useDominantColor decode cache (audit F29)', () => {
  it('dedups concurrent decodes and replays settled results without re-decoding', async () => {
    const url = '/api/cover-art/shared-1';

    // Two always-mounted consumers (Layout + NowPlaying overlay) decode the
    // same cover at the same time: one shared decode.
    const first = renderHook(() => useDominantColor(url));
    const second = renderHook(() => useDominantColor(url));
    await waitFor(() => expect(first.result.current).toBeTruthy());
    await waitFor(() => expect(second.result.current).toBeTruthy());
    expect(FakeImage.instances).toHaveLength(1);
    expect(second.result.current).toBe(first.result.current);

    // A later consumer (e.g. overlay reopening on the same track) gets the
    // settled color without touching Image/canvas again.
    first.unmount();
    second.unmount();
    const third = renderHook(() => useDominantColor(url));
    await waitFor(() => expect(third.result.current).toBe(first.result.current));
    expect(FakeImage.instances).toHaveLength(1);
    third.unmount();
  });

  it('does not cache failed decodes so transient errors retry', async () => {
    const url = '/api/cover-art/flaky-1';
    failingUrls.add(url);

    const first = renderHook(() => useDominantColor(url));
    await waitFor(() => expect(first.result.current).toBeNull());
    expect(FakeImage.instances).toHaveLength(1);
    first.unmount();

    failingUrls.delete(url);
    const second = renderHook(() => useDominantColor(url));
    await waitFor(() => expect(second.result.current).toBeTruthy());
    expect(FakeImage.instances).toHaveLength(2);
    second.unmount();
  });

  it('evicts the oldest entry FIFO once the cache exceeds 200 URLs', async () => {
    const urls = Array.from({ length: 201 }, (_, i) => `/api/cover-art/fifo-${i}`);
    // One component holding all 201 consumers decodes them in a single pass.
    const all = renderHook(() => urls.map((url) => useDominantColor(url)));
    await waitFor(() => expect(all.result.current.every(Boolean)).toBe(true));
    expect(FakeImage.instances).toHaveLength(201);
    all.unmount();

    // URL #0 was evicted by #200 — decoding it again creates a new Image…
    const again = renderHook(() => useDominantColor(urls[0]!));
    await waitFor(() => expect(again.result.current).toBeTruthy());
    expect(FakeImage.instances).toHaveLength(202);
    again.unmount();

    // …while #2 is still cached (re-inserting #0 only evicted #1).
    const replay = renderHook(() => useDominantColor(urls[2]!));
    await waitFor(() => expect(replay.result.current).toBeTruthy());
    expect(FakeImage.instances).toHaveLength(202);
    replay.unmount();
  });

  it('resets to no color when the url goes away', async () => {
    const { result, rerender, unmount } = renderHook(({ url }) => useDominantColor(url), {
      initialProps: { url: '/api/cover-art/then-none' as string | undefined },
    });
    await waitFor(() => expect(result.current).toBeTruthy());
    rerender({ url: undefined });
    expect(result.current).toBeNull();
    unmount();
  });
});
