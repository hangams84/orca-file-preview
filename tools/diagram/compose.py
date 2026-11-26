"""Side-by-side images (reference | ours) for the diagram fidelity table, plus a rough similarity score.

    python tools/diagram/compose.py <evidence dir>

Reads <dir>/truth/*.png and <dir>/ours/*.png, writes <dir>/compare/*.png and <dir>/scores.json.
Score: both images are cropped to their drawn content, scaled to the same size, blurred a little
(anti-aliasing and font differences), and compared as grey levels; 100 = identical, it falls with
missing/misplaced shapes. It is a sorting aid; the verdicts in README.md come from looking.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

d = Path(sys.argv[1])
(d / "compare").mkdir(exist_ok=True)


def content(im):
    g = ImageOps.invert(im.convert("L"))
    box = g.point(lambda v: 255 if v > 40 else 0).getbbox()
    return im.crop(box) if box else im


scores = {}
for t in sorted((d / "truth").glob("*.png")):
    o = d / "ours" / t.name
    if not o.exists():
        continue
    a = content(Image.open(t).convert("RGB"))
    b = content(Image.open(o).convert("RGB"))
    W, H = 400, max(1, round(400 * a.height / a.width))
    ga = a.resize((W, H)).convert("L").filter(ImageFilter.GaussianBlur(2))
    gb = b.resize((W, H)).convert("L").filter(ImageFilter.GaussianBlur(2))
    diff = ImageChops.difference(ga, gb)
    mean = sum(i * n for i, n in enumerate(diff.histogram())) / (W * H)
    scores[t.stem] = round(100 - mean / 255 * 100 * 4, 1)
    pad = 16
    h = max(a.height, b.height) + 40
    canvas = Image.new("RGB", (a.width + b.width + pad * 3, h), "white")
    canvas.paste(a, (pad, 30))
    canvas.paste(b, (a.width + pad * 2, 30))
    dr = ImageDraw.Draw(canvas)
    dr.text((pad, 8), "reference", fill=(120, 120, 120))
    dr.text((a.width + pad * 2, 8), "File Preview", fill=(120, 120, 120))
    dr.line([(a.width + pad * 1.5, 0), (a.width + pad * 1.5, h)], fill=(210, 210, 210))
    canvas.save(d / "compare" / t.name, optimize=True)
(d / "scores.json").write_text(json.dumps(scores, indent=2))
for k, v in scores.items():
    print(f"{v:6.1f}  {k}")
