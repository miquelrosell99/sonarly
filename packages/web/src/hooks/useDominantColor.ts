import { useEffect, useState } from 'react';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

function sampleCoverArt(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, size, size);
      let data: ImageData;
      try {
        data = ctx.getImageData(0, 0, size, size);
      } catch {
        resolve(null);
        return;
      }

      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;

      for (let i = 0; i < data.data.length; i += 4) {
        const pr = data.data[i] ?? 0;
        const pg = data.data[i + 1] ?? 0;
        const pb = data.data[i + 2] ?? 0;

        // Ignore near-white and near-black pixels so the average isn't washed out.
        const isNearWhite = pr > 240 && pg > 240 && pb > 240;
        const isNearBlack = pr < 15 && pg < 15 && pb < 15;
        if (isNearWhite || isNearBlack) continue;

        r += pr;
        g += pg;
        b += pb;
        count++;
      }

      if (count === 0) {
        resolve(null);
        return;
      }

      r /= count;
      g /= count;
      b /= count;

      const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);

      // Mute the color so it works as an ambient wash, not a loud surface.
      const mutedS = Math.min(s * 0.55, 70);
      const clampedL = Math.max(35, Math.min(l, 65));

      resolve(`hsl(${Math.round(h)} ${Math.round(mutedS)}% ${Math.round(clampedL)}%)`);
    };

    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function useDominantColor(url: string | undefined) {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setColor(null);
      return;
    }

    let cancelled = false;
    sampleCoverArt(url).then((sampled) => {
      if (!cancelled) setColor(sampled);
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return color;
}
