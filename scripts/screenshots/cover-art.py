#!/usr/bin/env python3
"""Generative cover art for the screenshot fixture library.

Deterministic per-album compositions (no gradients): overlapping discs,
diagonal stripes, sun/arch, or concentric rings, drawn supersampled and
downscaled, with a whisper of grain. Usage: cover-art.py <out.png> <album-index>
"""
import random
import sys

from PIL import Image, ImageDraw

# (background, fg1, fg2, fg3) — one curated palette per fixture album.
PALETTES = [
    ("#16161a", "#e0523f", "#e8c547", "#4f8f83"),  # Keystone Division — Low Orbit
    ("#f2ead8", "#b3452e", "#1f4e5f", "#d9a441"),  # Mireille Ash — Paper Lanterns
    ("#101418", "#cfd6dd", "#5f7d95", "#8a4a3a"),  # Vantablack Choir — Concrete Bloom
    ("#12272b", "#d98e9e", "#7fb5a8", "#e5d7b0"),  # Harborline — Salt & Static
    ("#1a1410", "#d9a441", "#8a6a4a", "#e8dcc8"),  # Atlas Minor — Cartographer's Dream
    ("#0d0d14", "#c94f8c", "#4f7fc9", "#9c5fd9"),  # Copper Veil — Neon Vespers
    ("#e6e3dc", "#2b2b2b", "#7a8a99", "#c46a4a"),  # Pond Society — Grayscale Summer
    ("#141414", "#e8c547", "#4a7a6e", "#d96a3d"),  # Tessellate — Feral Geometry
    ("#101820", "#5fd4c0", "#c9d6e8", "#e8833a"),  # Platform Nine — Midnight Commute
    ("#0b1f16", "#8fe0a8", "#d9e8c9", "#4a6a8a"),  # Svalbard Chorus — Aurora Tapes
    ("#1f1a14", "#c9a15a", "#8a5a3a", "#e0d0b0"),  # Foundry Workers Union — Rust Belt
    ("#120f1a", "#7a5fd9", "#4fc9a8", "#d94f7a"),  # Moss Algorithm — Digital Foliage
    ("#181c20", "#d95f3d", "#e8b84a", "#6a8a5a"),  # Marlow — The Quiet Engine
    ("#0e1418", "#9fc9d9", "#e0e8ec", "#5a7a8c"),  # Iridium Pool — Glass Harmonics
]

S = 1200          # output size
SS = 2            # supersample factor
N = S * SS


def grain(img):
    noise = Image.effect_noise(img.size, 22).convert("RGB")
    return Image.blend(img, noise, 0.045)


def t_discs(d, rng, cols, bg):
    for _ in range(rng.randint(4, 6)):
        c = rng.choice(cols)
        r = rng.randint(N // 5, N // 2)
        x = rng.randint(-N // 6, N + N // 6)
        y = rng.randint(-N // 6, N + N // 6)
        if rng.random() < 0.35:
            d.ellipse([x - r, y - r, x + r, y + r], outline=c, width=rng.randint(10, 22))
        else:
            d.ellipse([x - r, y - r, x + r, y + r], fill=c)


def t_stripes(d, rng, cols, bg, img):
    layer = Image.new("RGB", (N * 2, N * 2), bg)
    ld = ImageDraw.Draw(layer)
    y = -rng.randint(0, N // 2)
    while y < N * 2:
        w = rng.randint(N // 10, N // 4)
        ld.rectangle([0, y, N * 2, y + w], fill=rng.choice(cols))
        y += w + rng.randint(N // 14, N // 5)
    layer = layer.rotate(rng.choice([18, 24, -20, -28, 35]), fillcolor=bg)
    img.paste(layer.crop((N // 2, N // 2, N // 2 + N, N // 2 + N)), (0, 0))


def t_arch(d, rng, cols, bg):
    cx = N // 2 + rng.randint(-N // 8, N // 8)
    base = rng.randint(int(N * 0.55), int(N * 0.7))
    r = rng.randint(N // 3, N // 2)
    sun = rng.choice(cols)
    d.pieslice([cx - r, base - r, cx + r, base + r], 180, 360, fill=sun)
    for i in range(rng.randint(1, 2)):
        h = base + rng.randint(N // 12, N // 6)
        d.rectangle([rng.randint(0, N // 4), h, N - rng.randint(0, N // 4), h + rng.randint(14, 30)],
                    fill=rng.choice([c for c in cols if c != sun]))


def t_rings(d, rng, cols, bg):
    cx = N // 2 + rng.randint(-N // 3, N // 3)
    cy = N // 2 + rng.randint(-N // 3, N // 3)
    r = rng.randint(N // 2, int(N * 0.9))
    step = rng.randint(N // 6, N // 4)
    i = 0
    while r > N // 10:
        c = cols[i % len(cols)]
        if rng.random() < 0.5:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=rng.randint(14, 30))
        else:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
        r -= step
        i += 1


def cover(ai, out):
    rng = random.Random(20260927 + ai * 7919)
    bg, *cols = PALETTES[ai % len(PALETTES)]
    img = Image.new("RGB", (N, N), bg)
    d = ImageDraw.Draw(img)
    template = [t_discs, t_stripes, t_arch, t_rings][ai % 4]
    if template is t_stripes:
        template(d, rng, cols, bg, img)
    else:
        template(d, rng, cols, bg)
    grain(img).resize((S, S), Image.LANCZOS).save(out, "PNG")


if __name__ == "__main__":
    cover(int(sys.argv[2]), sys.argv[1])
