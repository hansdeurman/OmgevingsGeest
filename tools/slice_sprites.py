"""Cut a generated sprite sheet into transparent sprite PNGs.

Gemini draws each object in its own cell on flat magenta, with white separator
lines between cells. Cells are the regions between those lines; everything in a
cell that isn't magenta is one sprite (so a cluster of pebbles stays together).
Magenta is keyed out with soft edges and removed from anti-aliased borders.

usage: python3 tools/slice_sprites.py SHEET OUT_DIR ROWS NAME [NAME ...]
  Names are matched to cells in reading order (row by row, left to right);
  use '-' to skip a cell. Needs Pillow, numpy and scipy.
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

MAX_SIDE = 256          # largest sprite of a sheet; others keep their relative size
SEPARATOR_RUN = 80      # white runs at least this long are cell separators
KEY_SOFT = (50, 130)    # colour distance from magenta: fully clear .. fully opaque
SPILL_EDGE = 10         # pixels from the edge in which magenta spill is removed


def separator_mask(rgb: np.ndarray) -> np.ndarray:
    white = rgb.min(axis=2) > 225
    lines = ndimage.binary_opening(white, np.ones((1, SEPARATOR_RUN))) | ndimage.binary_opening(
        white, np.ones((SEPARATOR_RUN, 1))
    )
    return ndimage.binary_dilation(lines, iterations=3)


def cells(rgb: np.ndarray, rows: int) -> list:
    labels, _ = ndimage.label(~separator_mask(rgb))
    h, w = labels.shape
    found = [s for s in ndimage.find_objects(labels) if s and (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 0.01 * h * w]
    centre = lambda s: ((s[0].start + s[0].stop) / 2, (s[1].start + s[1].stop) / 2)
    return sorted(found, key=lambda s: (int(centre(s)[0] * rows / h), centre(s)[1]))


def key_out(cell: np.ndarray) -> np.ndarray:
    """RGBA with magenta removed: alpha from colour distance, colour un-mixed from the key."""
    flat = cell.reshape(-1, 3)
    magenta = flat[(flat[:, 0] > 200) & (flat[:, 1] < 110) & (flat[:, 2] > 200)]
    key = np.median(magenta, axis=0) if len(magenta) else np.array([255.0, 0, 255])
    dist = np.linalg.norm(cell - key, axis=2)
    alpha = np.clip((dist - KEY_SOFT[0]) / (KEY_SOFT[1] - KEY_SOFT[0]), 0, 1)
    a = alpha[..., None]
    fg = np.clip((cell - (1 - a) * key) / np.maximum(a, 1e-3), 0, 255)
    return np.dstack([fg, alpha * 255]).astype(np.uint8)


def despill(rgba: np.ndarray) -> np.ndarray:
    """Near the edge, pull red and blue that exceed green back toward it (magenta spill)."""
    out = rgba.astype(float)
    near_edge = ndimage.distance_transform_edt(rgba[..., 3] > 128) <= SPILL_EDGE
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    spill = np.clip((np.minimum(r, b) - g) * 1.3, 0, None) * near_edge
    out[..., 0] -= spill
    out[..., 2] -= spill
    return out.astype(np.uint8)


def crop_to_content(rgba: np.ndarray, pad: int = 2) -> np.ndarray:
    ys, xs = np.nonzero(rgba[..., 3] > 128)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgba.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgba.shape[1])
    return rgba[y0:y1, x0:x1]


def main(sheet: str, out_dir: str, rows: int, names: list) -> None:
    rgb = np.asarray(Image.open(sheet).convert('RGB')).astype(float)
    found = cells(rgb, rows)
    if len(found) != len(names):
        sys.exit(f'{sheet}: found {len(found)} cells but got {len(names)} names')
    sprites = {n: Image.fromarray(crop_to_content(despill(key_out(rgb[s]))), 'RGBA') for s, n in zip(found, names) if n != '-'}
    # One factor per sheet, so a big oak stays bigger than a sapling.
    k = min(1.0, MAX_SIDE / max(max(im.size) for im in sprites.values()))
    for name, im in sprites.items():
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        im.save(f'{out_dir}/{name}.png', optimize=True)
        print(f'{name}: {im.width}x{im.height}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4:])
