const MAX_PEAK_BUCKETS = 2000;

// Session-level cache of decoded peak data per song (null = decoding failed,
// cached so we don't retry a broken decode on every editor open).
const peaksCache = new Map<string, Promise<Float32Array | null>>();

export function computePeaks(songId: string): Promise<Float32Array | null> {
  const cached = peaksCache.get(songId);
  if (cached) return cached;
  const promise = (async (): Promise<Float32Array | null> => {
    try {
      const AudioContextCtor = window.AudioContext;
      if (!AudioContextCtor) return null;
      const res = await fetch(`/rest/stream.view?id=${encodeURIComponent(songId)}`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const buffer = await res.arrayBuffer();
      const context = new AudioContextCtor();
      let audio: AudioBuffer;
      try {
        audio = await context.decodeAudioData(buffer);
      } finally {
        context.close().catch(() => {});
      }
      const data = audio.getChannelData(0);
      if (data.length === 0) return null;
      const buckets = Math.min(MAX_PEAK_BUCKETS, data.length);
      const bucketSize = Math.max(1, Math.floor(data.length / buckets));
      const peaks = new Float32Array(buckets);
      let max = 0;
      for (let b = 0; b < buckets; b += 1) {
        const start = b * bucketSize;
        let peak = 0;
        for (let i = start; i < Math.min(start + bucketSize, data.length); i += 8) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
        peaks[b] = peak;
        if (peak > max) max = peak;
      }
      if (max > 0) {
        for (let b = 0; b < buckets; b += 1) peaks[b] /= max;
      }
      return peaks;
    } catch {
      return null;
    }
  })();
  peaksCache.set(songId, promise);
  return promise;
}
