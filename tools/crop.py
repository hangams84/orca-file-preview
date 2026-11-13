"""Crops a window capture: python tools/crop.py <in.png> <out.png> x0 y0 x1 y1 (x1/y1 = 0: to the edge).
Used to drop the left sidebar (the person's project list) from evidence captures."""
import sys

from PIL import Image

src, dst, *box = sys.argv[1:]
im = Image.open(src)
x0, y0, x1, y1 = (int(v) for v in box)
# 0 for the right/bottom edge means "to the image edge" (the editor pane width depends on the layout).
im.crop((x0, y0, x1 or im.width, y1 or im.height)).save(dst)
