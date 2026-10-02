"""Stack a top, a middle and a foot strip from a sprite sheet into one wall.

Generated wall strips are drawn separately and do not join cleanly, so this
builds one image the game can stretch to any height: the top (with its
capstone), a middle band that repeats seamlessly upward, and the foot (with
its rubble). Joins are cross-faded through the middle band, dark seams in the
top are lifted, the middle's light-to-dark drift is flattened so repeats do
not band, and (unless --window) the whole wall repeats seamlessly sideways.

usage: python3 tools/make_wall.py SHEET OUT.webp TOP MIDDLE FOOT [--window]
  Each part is a cell index in reading order, optionally with a row range:
  `4` or `4:14:` or `1:0:130`. Prints `lip` (where the capstone meets the
  wall face) and the repeating band, in rows of the output.
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

from slice_sprites import despill, key_out, line_cells

SEPARATOR_TRIM = 14     # light rows a cell keeps from the separator line above it
JOIN = 0.25             # share of the middle band used to fade into the top and the foot
SEAM_DIP = 0.88         # a full row this much darker than its surroundings is a seam
SIDE_FADE = 0.12        # share of the width cross-faded to repeat sideways
CAP_SEARCH = 40         # rows below the first opaque row in which the capstone ends


def part(rgb: np.ndarray, cells: list, spec: str) -> np.ndarray:
    index, *rows = spec.split(':')
    r, c = cells[int(index)]
    start, stop = (int(v) if v else None for v in (rows + ['', ''])[:2])
    return rgb[r, c][start:stop]


def row_means(rgba: np.ndarray) -> np.ndarray:
    return rgba[..., :3].astype(float).mean(axis=(1, 2))


def lift_seams(rgba: np.ndarray) -> np.ndarray:
    """Brighten fully opaque rows that are much darker than their neighbourhood (a drawn seam line)."""
    out = rgba.astype(float)
    solid = (rgba[..., 3] > 250).mean(axis=1) > 0.98
    means = row_means(rgba)
    base = ndimage.median_filter(means, size=41, mode='nearest')
    dark = solid & (means < SEAM_DIP * base)
    out[dark, :, :3] *= (base / np.maximum(means, 1))[dark, None, None]
    return out.clip(0, 255)


def flatten(rgb: np.ndarray) -> np.ndarray:
    """Remove slow top-to-bottom shading, so the band can repeat without stripes."""
    rows = ndimage.uniform_filter1d(rgb.mean(axis=1), size=31, axis=0, mode='nearest')
    return rgb * (rgb.reshape(-1, rgb.shape[2]).mean(axis=0) / np.maximum(rows, 1))[:, None, :]


def seamless(img: np.ndarray, overlap: int, axis: int) -> np.ndarray:
    """Blend the last `overlap` rows (or columns) into the first ones and drop them."""
    n = img.shape[axis] - overlap
    t = np.linspace(0, 1, overlap).reshape((-1, 1, 1) if axis == 0 else (1, -1, 1))
    head, tail = np.take(img, range(overlap), axis), np.take(img, range(n, n + overlap), axis)
    out = np.take(img, range(n), axis).copy()
    idx = [slice(None)] * 3
    idx[axis] = slice(0, overlap)
    out[tuple(idx)] = tail * (1 - t) + head * t
    return out


def fade(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rows going from a to b."""
    t = np.linspace(0, 1, len(a))[:, None, None]
    return a * (1 - t) + b * t


def crop_rows(rgba: np.ndarray) -> np.ndarray:
    """Drop the sheet border above the top's empty band, then the empty rows around the wall."""
    cover = (rgba[..., 3] > 128).mean(axis=1)
    empty = np.flatnonzero(cover < 0.02)
    start = empty[0] if len(empty) and empty[0] < len(cover) // 4 else 0
    full = np.flatnonzero(cover[start:] >= 0.02) + start
    return rgba[max(start, full[0] - 2):full[-1] + 1]


def lip_row(rgba: np.ndarray) -> int:
    """The row where the light capstone ends and the wall face begins: the steepest darkening below the top."""
    first = int(np.flatnonzero((rgba[..., 3] > 128).mean(axis=1) > 0.5)[0])
    means = ndimage.uniform_filter1d(row_means(rgba)[first:first + CAP_SEARCH], 5)
    return first + int(np.argmin(np.diff(means))) + 1


def main(sheet: str, out: str, top: str, middle: str, foot: str, *flags: str) -> None:
    rgb = np.asarray(Image.open(sheet).convert('RGB')).astype(float)
    cells = line_cells(rgb)
    parts = [part(rgb, cells, s) for s in (top, middle, foot)]
    width = min(p.shape[1] for p in parts)
    top_px, mid_px, foot_px = (p[:, :width] for p in parts)
    if ':' not in middle:
        mid_px = mid_px[SEPARATOR_TRIM:]
    if ':' not in foot:
        foot_px = foot_px[SEPARATOR_TRIM:]

    top_rgba = lift_seams(despill(key_out(top_px)))
    foot_rgba = despill(key_out(foot_px)).astype(float)
    mid = flatten(mid_px)
    band = seamless(np.dstack([mid, np.full(mid.shape[:2], 255.0)]), int(len(mid) * JOIN), 0)
    k = int(len(band) * JOIN)
    # The top's last rows become the band's last rows, the foot's first rows its first: every join is a repeat of the band.
    top_rgba[-k:] = fade(top_rgba[-k:], band[-k:])
    foot_rgba[:k] = fade(band[:k], foot_rgba[:k])
    top_rgba = crop_rows(top_rgba)
    wall = np.concatenate([top_rgba, band, foot_rgba])
    if '--window' not in flags:
        wall = seamless(wall, int(width * SIDE_FADE), 1)
    Image.fromarray(wall.clip(0, 255).astype(np.uint8), 'RGBA').save(out, quality=88)
    lip = lip_row(wall)
    print(f'{out}: {wall.shape[1]}x{wall.shape[0]} lip {lip} repeat {len(top_rgba)}..{len(top_rgba) + len(band)}')


if __name__ == '__main__':
    main(*sys.argv[1:])
