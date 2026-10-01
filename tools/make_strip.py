"""Turn a cut-out cliff sprite into a horizontally seamless wall strip.

Keeps the rows that are (almost) fully opaque, fills the few holes left with
the strip's mean colour, then cross-fades the ends so the strip repeats
sideways without a seam.

usage: python3 tools/make_strip.py SPRITE.png OUT.webp [OVERLAP_SHARE]
"""
import sys

import numpy as np
from PIL import Image

OPAQUE_ROWS = 0.9       # a row belongs to the wall when this share of it is opaque


def opaque_rows(rgba: np.ndarray) -> np.ndarray:
    share = (rgba[..., 3] > 128).mean(axis=1)
    ys = np.flatnonzero(share >= OPAQUE_ROWS)
    out = rgba[ys.min():ys.max() + 1].astype(float)
    a = out[..., 3:] / 255
    mean = (out[..., :3] * a).sum(axis=(0, 1)) / a.sum()
    return out[..., :3] * a + mean * (1 - a)


def seamless_x(rgb: np.ndarray, overlap: int) -> np.ndarray:
    """Blend the last `overlap` columns into the first ones and drop them."""
    w = rgb.shape[1] - overlap
    t = np.linspace(0, 1, overlap)[None, :, None]
    out = rgb[:, :w].copy()
    out[:, :overlap] = rgb[:, w:] * (1 - t) + rgb[:, :overlap] * t
    return out


def main(src: str, dst: str, overlap_share: float = 0.15) -> None:
    rgb = opaque_rows(np.asarray(Image.open(src).convert('RGBA')))
    strip = seamless_x(rgb, int(rgb.shape[1] * overlap_share))
    Image.fromarray(strip.clip(0, 255).astype(np.uint8), 'RGB').save(dst, quality=92)
    print(f'{dst}: {strip.shape[1]}x{strip.shape[0]}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], *map(float, sys.argv[3:]))
