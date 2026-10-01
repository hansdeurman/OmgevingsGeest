"""Cut every object out of a labelled, irregular sprite sheet.

Some generated sheets put a text label at the top of each cell and use cells
of different sizes. This finds the cells between the white separator lines,
blanks the label band at the top of each cell, keys out the magenta and saves
every separate object as its own sprite, plus a numbered contact sheet to
pick names from.

usage: python3 tools/cut_kit.py SHEET OUT_DIR PREFIX
  writes OUT_DIR/PREFIX-<cell>-<object>.png and OUT_DIR/PREFIX-contact.png.
  Needs Pillow, numpy and scipy, and slice_sprites.py next to it.
"""
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from slice_sprites import crop_to_content, despill, key_out, separator_mask

LABEL_BAND = 30         # pixels at the top of a cell that may hold a label
MIN_OBJECT = 400        # smaller opaque specks are noise or leftover text
MIN_CELL = 0.004        # share of the sheet a region must cover to be a cell


def blank_labels(cell: np.ndarray) -> np.ndarray:
    """Turn light text (white, or pink where it blends into magenta) in the top band into magenta."""
    out = cell.copy()
    band = out[:LABEL_BAND]
    r, g, b = band[..., 0], band[..., 1], band[..., 2]
    light = (band.min(axis=2) > 150) | ((r > 190) & (b > 190))
    band[ndimage.binary_dilation(light, iterations=2)] = (255, 0, 255)
    return out


def objects(rgba: np.ndarray) -> list:
    labels, n = ndimage.label(ndimage.binary_closing(rgba[..., 3] > 128, iterations=2))
    found = []
    for k, sl in enumerate(ndimage.find_objects(labels), start=1):
        mask = labels[sl] == k
        if mask.sum() < MIN_OBJECT:
            continue
        piece = rgba[sl].copy()
        piece[..., 3] = np.where(mask, piece[..., 3], 0)
        found.append(crop_to_content(piece))
    return found


def main(sheet: str, out_dir: str, prefix: str) -> None:
    rgb = np.asarray(Image.open(sheet).convert('RGB')).astype(float)
    labels, _ = ndimage.label(~separator_mask(rgb))
    h, w = labels.shape
    cells = [s for s in ndimage.find_objects(labels) if s and (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > MIN_CELL * h * w]
    cells.sort(key=lambda s: (s[0].start // 40, s[1].start))
    contact = Image.fromarray(rgb.astype(np.uint8)).convert('RGBA')
    draw = ImageDraw.Draw(contact)
    for c, sl in enumerate(cells):
        cell = blank_labels(rgb[sl])
        for o, piece in enumerate(objects(despill(key_out(cell)))):
            name = f'{prefix}-{c}-{o}'
            Image.fromarray(piece, 'RGBA').save(f'{out_dir}/{name}.png', optimize=True)
            print(f'{name}: {piece.shape[1]}x{piece.shape[0]}')
        draw.rectangle([sl[1].start, sl[0].start, sl[1].start + 40, sl[0].start + 22], fill=(0, 0, 0, 255))
        draw.text((sl[1].start + 4, sl[0].start + 4), str(c), fill=(255, 255, 0, 255))
    contact.save(f'{out_dir}/{prefix}-contact.png')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
