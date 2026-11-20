"""Input pictures for the PPTX picture corpus (tools/make-pptx-images.ps1 inserts them with PowerPoint).

Every picture shares one recognisable design (coloured quadrants, a circle, an arrow pointing up, a label),
so a renderer that shows the wrong orientation, crop or colours is easy to spot next to PowerPoint's export.
Writes samples/pptx-images/inputs/ (git-ignored; regenerated on demand).  Usage: python tools/pptx-images/make-inputs.py
"""
import io
import os
import struct

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = os.path.join(ROOT, "samples", "pptx-images", "inputs")
os.makedirs(OUT, exist_ok=True)


def font(size):
    for f in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def design(w=600, h=400, label="", alpha=False):
    """Quadrants (red, green, blue, yellow), a white circle, an up arrow and a label."""
    img = Image.new("RGBA" if alpha else "RGB", (w, h), (255, 255, 255, 0) if alpha else "white")
    d = ImageDraw.Draw(img)
    cols = [(220, 40, 40), (40, 170, 70), (40, 90, 220), (240, 200, 30)]
    for i, c in enumerate(cols):
        x, y = (i % 2) * w // 2, (i // 2) * h // 2
        if alpha and i == 3:
            continue  # bottom-right quadrant stays transparent
        d.rectangle([x, y, x + w // 2 - 1, y + h // 2 - 1], fill=c + ((255,) if alpha else ()))
    r = min(w, h) // 5
    if r < 6:
        return img  # tiny: quadrants only
    d.ellipse([w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r], fill=(255, 255, 255, 255) if alpha else "white")
    # arrow pointing up (orientation check)
    ax = w // 2
    d.polygon([(ax, h // 2 - r + 6), (ax - r // 2, h // 2), (ax + r // 2, h // 2)], fill=(20, 20, 20, 255) if alpha else (20, 20, 20))
    d.rectangle([ax - r // 6, h // 2, ax + r // 6, h // 2 + r - 8], fill=(20, 20, 20, 255) if alpha else (20, 20, 20))
    if label:
        d.text((10, 8), label, fill=(0, 0, 0, 255) if alpha else "black", font=font(max(10, h // 14)))
    return img


def save(img, name, **kw):
    path = os.path.join(OUT, name)
    img.save(path, **kw)
    return path


base = design(label="PNG RGB")
save(base, "png-rgb.png")
save(design(label="PNG RGBA", alpha=True), "png-rgba.png")
# 16-bit grayscale gradient
g16 = Image.new("I;16", (600, 400))
g16.putdata([int(65535 * x / 599) for y in range(400) for x in range(600)])
save(g16, "png-16bit.png")
save(design(label="PNG palette").convert("P", palette=Image.ADAPTIVE, colors=16), "png-palette.png")
save(design(label="JPEG baseline"), "jpg-baseline.jpg", quality=88)
save(design(label="JPEG progressive"), "jpg-progressive.jpg", quality=88, progressive=True)
save(design(label="JPEG CMYK").convert("CMYK"), "jpg-cmyk.jpg", quality=90)
save(design(label="JPEG gray").convert("L"), "jpg-gray.jpg", quality=90)
# EXIF orientation 6 (rotate 90 CW to display): store the design rotated 90 CCW so the viewer that
# honours EXIF shows it upright, one that ignores it shows the arrow pointing left.
ex = design(label="JPEG EXIF 6").rotate(90, expand=True)
exif = Image.Exif()
exif[0x0112] = 6
save(ex, "jpg-exif6.jpg", quality=88, exif=exif.tobytes())
save(design(label="GIF static").convert("P", palette=Image.ADAPTIVE), "gif-static.gif")
frames = [design(label=f"GIF frame {i + 1}").convert("P", palette=Image.ADAPTIVE) for i in range(3)]
frames[0].save(os.path.join(OUT, "gif-animated.gif"), save_all=True, append_images=frames[1:], duration=400, loop=0)
save(design(label="BMP 24-bit"), "bmp-24.bmp")
save(design(label="BMP 32-bit alpha", alpha=True), "bmp-32.bmp")
save(design(label="TIFF LZW"), "tif-lzw.tif", compression="tiff_lzw")
p1, p2 = design(label="TIFF page 1"), design(label="TIFF page 2")
p1.save(os.path.join(OUT, "tif-multipage.tif"), save_all=True, append_images=[p2], compression="tiff_lzw")
save(design(256, 256, "ICO"), "ico.ico", sizes=[(256, 256), (64, 64)])
save(design(label="WebP"), "webp.webp", quality=85)
try:
    save(design(label="AVIF"), "avif.avif", quality=70)
except Exception as e:  # Pillow without libavif
    print("avif skipped:", e)
# SVG (PowerPoint stores svgBlip + a PNG fallback)
svg = """<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
<rect x="0" y="0" width="300" height="200" fill="#dc2828"/><rect x="300" y="0" width="300" height="200" fill="#28aa46"/>
<rect x="0" y="200" width="300" height="200" fill="#285adc"/><rect x="300" y="200" width="300" height="200" fill="#f0c81e"/>
<circle cx="300" cy="200" r="80" fill="#fff"/><path d="M300 126 L260 200 L340 200 Z M287 200 H313 V272 H287 Z" fill="#141414"/>
<text x="10" y="34" font-family="Arial" font-weight="bold" font-size="28">SVG</text></svg>"""
open(os.path.join(OUT, "svg.svg"), "w", encoding="utf-8").write(svg)

# Specs
save(design(8, 8), "tiny-8x8.png")
save(design(2000, 40, "wide 50:1"), "aspect-wide.png")
save(design(40, 1200, ""), "aspect-tall.png")
for name, size in (("huge-8000x6000.jpg", (8000, 6000)), ("huge-8000x6000.png", (8000, 6000))):
    big = design(*size, label=name.split(".")[0])
    if name.endswith(".jpg"):
        save(big, name, quality=85)
    else:
        save(big, name, optimize=False, compress_level=1)
print("inputs ->", os.path.abspath(OUT))
for f in sorted(os.listdir(OUT)):
    print(f"  {f:28} {os.path.getsize(os.path.join(OUT, f)):>10,}")


# ---- WMF (PowerPoint COM cannot paste as a Windows metafile): write two by hand.
def wmf(records_fn, w=6000, h=4000):
    recs = []

    def rec(fn, *words, raw=b""):
        body = struct.pack(f"<{len(words)}h", *words) + raw
        if len(body) % 2:
            body += b"\0"
        recs.append(struct.pack("<IH", 3 + len(body) // 2, fn) + body)

    records_fn(rec)
    rec(0x0000)  # META_EOF
    body = b"".join(recs)
    nobj = 4
    header = struct.pack("<HHHIHIH", 1, 9, 0x0300, (18 + len(body)) // 2, nobj, max(len(r) for r in recs) // 2, 0)
    ph = struct.pack("<IHhhhhHI", 0x9AC6CDD7, 0, 0, 0, w, h, 1440, 0)
    chk = 0
    for (word,) in struct.iter_unpack("<H", ph):
        chk ^= word
    return ph + struct.pack("<H", chk) + header + body


def colorref(r, g, b):
    return struct.pack("<I", r | g << 8 | b << 16)


def shapes(rec):
    rec(0x0103, 8)  # SETMAPMODE anisotropic
    rec(0x020B, 0, 0)  # SETWINDOWORG y x
    rec(0x020C, 4000, 6000)  # SETWINDOWEXT y x
    rec(0x02FC, 0, raw=colorref(220, 40, 40) + b"\0\0")  # brush 0 red
    rec(0x02FA, 0, 60, 0, raw=colorref(20, 20, 20))  # pen 1 dark, width 60
    rec(0x012D, 0)
    rec(0x012D, 1)
    rec(0x041B, 2400, 3400, 400, 400)  # RECTANGLE bottom right top left
    rec(0x01F0, 0)
    rec(0x02FC, 0, raw=colorref(40, 90, 220) + b"\0\0")  # brush 0 blue
    rec(0x012D, 0)
    rec(0x0418, 3600, 4400, 1400, 2200)  # ELLIPSE
    rec(0x01F0, 0)
    rec(0x02FC, 0, raw=colorref(240, 200, 30) + b"\0\0")  # brush 0 yellow
    rec(0x012D, 0)
    pts = [(4200, 400), (5600, 2000), (4200, 3600), (3600, 2000)]
    rec(0x0324, len(pts), *[v for p in pts for v in p])  # POLYGON
    # font + text
    face = b"Arial".ljust(32, b"\0")
    rec(0x02FB, -600, 0, 0, 0, 700, raw=bytes([0, 0, 0, 0, 0, 0, 0, 0]) + face)  # font 2
    rec(0x012D, 2)
    rec(0x0209, raw=colorref(0, 0, 0))  # SETTEXTCOLOR
    rec(0x0102, 1)  # SETBKMODE transparent
    text = b"WMF text"
    rec(0x0521, len(text), raw=text + (b"\0" if len(text) % 2 else b"") + struct.pack("<hh", 3700, 500))  # TEXTOUT


def bitmap(rec):
    rec(0x0103, 8)
    rec(0x020B, 0, 0)
    rec(0x020C, 4000, 6000)
    img = design(120, 80).convert("RGB").transpose(Image.FLIP_TOP_BOTTOM)
    w, h = img.size
    row = (w * 3 + 3) & ~3
    bits = b"".join(img.tobytes()[y * w * 3:(y + 1) * w * 3][::-1][::-1] for y in range(h))
    # BGR order + row padding
    px = img.load()
    bits = bytearray()
    for y in range(h):
        line = bytearray()
        for x in range(w):
            r, g, b = px[x, y]
            line += bytes((b, g, r))
        bits += line + b"\0" * (row - len(line))
    bih = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, len(bits), 2835, 2835, 0, 0)
    # STRETCHDIB: rop(u32), usage, srcH, srcW, ySrc, xSrc, destH, destW, yDst, xDst, DIB
    rec(0x0F43, raw=struct.pack("<IHhhhhhhhh", 0x00CC0020, 0, h, w, 0, 0, 4000, 6000, 0, 0) + bih + bytes(bits))


open(os.path.join(OUT, "wmf-shapes.wmf"), "wb").write(wmf(shapes))
open(os.path.join(OUT, "wmf-bitmap.wmf"), "wb").write(wmf(bitmap))
print("wmf written")
