#!/usr/bin/env python3
"""Draw the step highlights on the raw captures and write optimised PNGs.

    python3 annotate.py <work-dir> <docs-dir> <work-lang> <docs-lang>

Reads <work-dir>/<work-lang>/steps.json (element boxes measured by capture.mjs in CSS pixels at
device scale 1) and writes <docs-dir>/<docs-lang>/NN-<slug>.png: a rounded rectangle around each
element to act on, with the step number in a badge on the primary one. Secondary boxes (context,
such as the "Can access" panel) get a thinner outline and no badge. pngquant is used when present.
"""
import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ACCENT = (229, 37, 98)       # primary highlight and badge
SECOND = (245, 158, 11)      # context outline
PAD, RADIUS, WIDTH = 6, 10, 4
BADGE = 34
FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def badge_position(x0, y0, x1, y1, w, h, W, H, avoid=()):
    """Place the badge just outside the highlight so it never hides the element: above, left,
    below, right (skipping spots that cover another highlight); on the corner only if none fits."""
    gap = 6
    candidates = [
        (x0 + w / 2, y0 - h / 2 - gap),
        (x0 - w / 2 - gap, (y0 + y1) / 2),
        (x0 + w / 2, y1 + h / 2 + gap),
        (x1 + w / 2 + gap, (y0 + y1) / 2),
    ]
    for cx, cy in candidates:
        bx0, by0, bx1, by1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
        if bx0 < 2 or by0 < 2 or bx1 > W - 2 or by1 > H - 2:
            continue
        if any(bx0 < a[2] and bx1 > a[0] and by0 < a[3] and by1 > a[1] for a in avoid):
            continue
        return cx, cy
    return min(max(x0, w / 2 + 2), W - w / 2 - 2), min(max(y0, h / 2 + 2), H - h / 2 - 2)


def draw_step(img, boxes, number, scale):
    W, H = img.size
    # Draw on a 2x canvas, then downsample, for smooth edges.
    ss = 2
    over = Image.new("RGBA", (W * ss, H * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    f = font(int(BADGE * 0.58 * ss))
    def rect_of(b):
        return (max(2, (b["x"] - PAD) * scale), max(2, (b["y"] - PAD) * scale),
                min(W - 3, (b["x"] + b["width"] + PAD) * scale), min(H - 3, (b["y"] + b["height"] + PAD) * scale))

    for b in sorted(boxes, key=lambda b: b["primary"]):
        x0, y0, x1, y1 = rect_of(b)
        others = [rect_of(o) for o in boxes if o is not b]
        rect = [x0 * ss, y0 * ss, x1 * ss, y1 * ss]
        if b["primary"]:
            d.rounded_rectangle(rect, radius=RADIUS * ss * scale, outline=ACCENT + (255,), width=WIDTH * ss * scale)
            label = str(number)
            h = BADGE * scale
            w = max(h, (len(label) * 0.62 * BADGE * 0.58 + 16) * scale)
            cx, cy = badge_position(x0, y0, x1, y1, w, h, W, H, others)
            d.rounded_rectangle([(cx - w / 2) * ss, (cy - h / 2) * ss, (cx + w / 2) * ss, (cy + h / 2) * ss],
                                radius=h / 2 * ss, fill=ACCENT + (255,), outline=(255, 255, 255, 255),
                                width=2 * ss * scale)
            d.text((cx * ss, cy * ss), label, font=f, fill=(255, 255, 255, 255), anchor="mm")
        else:
            d.rounded_rectangle(rect, radius=RADIUS * ss * scale, outline=SECOND + (235,), width=3 * ss * scale)
    over = over.resize((W, H), Image.LANCZOS)
    return Image.alpha_composite(img.convert("RGBA"), over).convert("RGB")


def main():
    work, docs, wlang, dlang = sys.argv[1:5]
    meta = json.load(open(os.path.join(work, wlang, "steps.json"), encoding="utf-8"))
    out = os.path.join(docs, dlang)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith(".png"):
            os.remove(os.path.join(out, f))
    pngquant = shutil.which("pngquant")
    for s in meta["steps"]:
        img = Image.open(os.path.join(work, wlang, s["file"]))
        scale = img.size[0] / s.get("viewportWidth", img.size[0]) if s.get("viewportWidth") else 1
        img = draw_step(img, s["boxes"], s["n"], scale)
        dst = os.path.join(out, s["file"])
        img.save(dst, optimize=True)
        if pngquant:
            subprocess.run([pngquant, "--force", "--skip-if-larger", "--quality=70-92", "--speed=1",
                            "--output", dst, dst], check=False)
    # The labels read from the DOM, for build-pages.mjs and for reviewing a re-run.
    labels = os.path.join(os.path.dirname(os.path.abspath(__file__)), "captured")
    os.makedirs(labels, exist_ok=True)
    json.dump(meta, open(os.path.join(labels, dlang + ".json"), "w", encoding="utf-8", newline="\n"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
