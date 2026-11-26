"""Generates the DWG/DWT test drawings in samples/dwg/ (public-safe: everything is drawn here).

1. ezdxf (MIT) writes one rich R2004 DXF: layers (one off, one with a line type, one true colour),
   lines, circles, arcs, ellipses, bulged and wide polylines, splines, points, solid/pattern/gradient
   hatches with a hole, Korean TEXT/MTEXT, dimensions (with their geometry blocks), a leader, block
   references with attributes (rotated, scaled, mirrored, arrayed), and a paper-space layout with a
   viewport and a title block.
2. GNU LibreDWG 0.14 (GPL-3.0; dxf2dwg / dwgwrite, https://www.gnu.org/software/libredwg/) converts it to
   DWG in several versions. Set LIBREDWG_BIN to the folder holding dxf2dwg(.exe) and dwgwrite(.exe).
3. broken.dwg (a damaged file that must end in a friendly error) and preview-only.dwg (an AutoCAD 2000
   header whose drawing data is missing but which carries a PNG preview image) are written byte by byte.

Usage: python tools/make-dwg-samples.py    (needs `pip install ezdxf`)
"""
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

import ezdxf
from ezdxf.enums import TextEntityAlignment

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "samples", "dwg")
BIN = os.environ.get("LIBREDWG_BIN", os.path.join(ROOT, ".orca", "libredwg-win64"))


def exe(name):
    for cand in (name + ".exe", name):
        p = os.path.join(BIN, cand)
        if os.path.isfile(p):
            return p
    p = shutil.which(name)
    if p:
        return p
    sys.exit(f"{name} not found: set LIBREDWG_BIN to GNU LibreDWG's bin folder")


def drawing():
    doc = ezdxf.new("R2004", setup=True)
    doc.header["$INSUNITS"] = 4  # mm
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LTSCALE"] = 1
    doc.header["$DWGCODEPAGE"] = "ANSI_949"
    msp = doc.modelspace()

    layers = [
        ("외곽선", 7, 50, "Continuous"),
        ("중심선", 4, 18, "CENTER"),
        ("치수", 1, 18, "Continuous"),
        ("해치", 3, 13, "Continuous"),
        ("문자", 5, 25, "Continuous"),
        ("블록", 6, 25, "Continuous"),
        ("숨김", 2, 25, "Continuous"),
        ("TrueColour", 7, 35, "Continuous"),
    ]
    for name, color, lw, lt in layers:
        layer = doc.layers.add(name, color=color, linetype=lt)
        layer.dxf.lineweight = lw
    doc.layers.get("숨김").off()
    doc.layers.get("TrueColour").rgb = (230, 120, 20)

    # sheet frame and part outline
    msp.add_lwpolyline([(0, 0), (297, 0), (297, 210), (0, 210)], close=True, dxfattribs={"layer": "외곽선"})
    msp.add_lwpolyline(
        [(20, 40, 0, 0, 0), (120, 40, 0, 0, 0.5), (140, 60, 0, 0, 0), (140, 120, 0, 0, 0), (20, 120, 0, 0, 0)],
        format="xyseb",
        close=True,
        dxfattribs={"layer": "외곽선"},
    )
    # wide polyline (constant width)
    pl = msp.add_lwpolyline([(160, 30), (280, 30)], dxfattribs={"layer": "TrueColour"})
    pl.dxf.const_width = 2.5
    # centre lines (dashed line type)
    msp.add_line((10, 80), (150, 80), dxfattribs={"layer": "중심선"})
    msp.add_line((80, 30), (80, 130), dxfattribs={"layer": "중심선"})
    # circles, arcs, ellipses
    msp.add_circle((80, 80), 25, dxfattribs={"layer": "외곽선"})
    msp.add_circle((40, 100), 6, dxfattribs={"layer": "외곽선"})
    msp.add_arc((80, 80), 32, 20, 160, dxfattribs={"layer": "외곽선", "color": 30})
    msp.add_ellipse((215, 95), major_axis=(35, 10), ratio=0.45, dxfattribs={"layer": "외곽선"})
    msp.add_ellipse((215, 95), major_axis=(0, 20), ratio=0.5, start_param=0, end_param=math.pi, dxfattribs={"layer": "TrueColour"})
    # mirrored arc (extrusion -Z, so the OCS centre (-250, 150) is WCS (250, 150)), common in real drawings
    msp.add_arc((-250, 150), 12, 0, 90, dxfattribs={"layer": "외곽선", "extrusion": (0, 0, -1), "color": 2})
    # splines: control points and fit points
    msp.add_spline_control_frame([(160, 150), (180, 185), (200, 140), (220, 185), (240, 150)], dxfattribs={"layer": "TrueColour"})
    msp.add_open_spline([(160, 120), (175, 135), (195, 115), (215, 135), (235, 120)], degree=3, dxfattribs={"layer": "외곽선", "color": 140})
    for x in range(165, 240, 15):
        msp.add_point((x, 60), dxfattribs={"layer": "외곽선"})
    # hatches: solid, pattern with a hole, gradient
    h = msp.add_hatch(color=3, dxfattribs={"layer": "해치"})
    h.set_pattern_fill("ANSI31", scale=1.5)
    h.paths.add_polyline_path([(25, 45), (60, 45), (60, 70), (25, 70)], is_closed=True, flags=1)
    h.paths.add_edge_path(flags=16).add_arc((42, 57), 6, 0, 360)
    s = msp.add_hatch(color=1, dxfattribs={"layer": "해치"})
    s.paths.add_polyline_path([(100, 100), (130, 100), (130, 115), (100, 115)], is_closed=True)
    g = msp.add_hatch(dxfattribs={"layer": "해치"})
    g.set_gradient((0, 90, 200), (220, 240, 255), rotation=30)
    g.paths.add_polyline_path([(160, 70), (200, 70), (200, 85), (160, 85)], is_closed=True)
    msp.add_solid([(205, 70), (230, 70), (205, 85), (230, 85)], dxfattribs={"layer": "해치", "color": 5})

    # text: Korean and alignments
    msp.add_text("한글 도면 미리보기 (DWG)", height=6, dxfattribs={"layer": "문자", "style": "Standard"}).set_placement((20, 190))
    msp.add_text("가운데 정렬 Center", height=3.5, dxfattribs={"layer": "문자"}).set_placement((80, 180), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_text("오른쪽 Right", height=3.5, dxfattribs={"layer": "문자"}).set_placement((140, 172), align=TextEntityAlignment.BOTTOM_RIGHT)
    msp.add_text("회전 30° %%d %%p0.1 %%c12", height=3, dxfattribs={"layer": "문자", "rotation": 30, "color": 4}).set_placement((150, 40))
    msp.add_mtext(
        "{\\fArial|b1;MTEXT 여러 줄}\\P두 번째 줄: 한글과 English\\P세 번째 줄 \\S1/2; 분수",
        dxfattribs={"layer": "문자", "char_height": 3.5, "width": 80, "insert": (160, 205), "attachment_point": 1},
    )
    msp.add_text("숨김 레이어 (보이면 안 됨)", height=5, dxfattribs={"layer": "숨김"}).set_placement((20, 140))

    # dimensions (ezdxf renders their geometry blocks)
    dim = msp.add_linear_dim(base=(20, 25), p1=(20, 40), p2=(120, 40), dimstyle="EZDXF", override={"dimlfac": 1}, dxfattribs={"layer": "치수"})
    dim.render()
    dim = msp.add_linear_dim(base=(150, 80), p1=(140, 60), p2=(140, 120), angle=90, dimstyle="EZDXF", override={"dimlfac": 1}, dxfattribs={"layer": "치수"})
    dim.render()
    dim = msp.add_radius_dim(center=(80, 80), radius=25, angle=45, dimstyle="EZ_RADIUS", override={"dimlfac": 1}, dxfattribs={"layer": "치수"})
    dim.render()
    dim = msp.add_diameter_dim(center=(40, 100), radius=6, angle=135, dimstyle="EZ_RADIUS", override={"dimlfac": 1}, dxfattribs={"layer": "치수"})
    dim.render()
    msp.add_leader([(55, 108), (65, 150), (75, 150)], dxfattribs={"layer": "치수"})
    msp.add_text("구멍 ⌀12", height=3, dxfattribs={"layer": "치수"}).set_placement((76, 149))

    # blocks with attributes
    blk = doc.blocks.new("부품표시")
    blk.add_circle((0, 0), 5, dxfattribs={"layer": "0", "color": 0})
    blk.add_line((-5, 0), (5, 0), dxfattribs={"layer": "0"})
    blk.add_line((0, -5), (0, 5), dxfattribs={"layer": "0"})
    blk.add_lwpolyline([(5, 0), (12, 4), (12, -4)], close=True, dxfattribs={"layer": "블록"})
    blk.add_attdef("NO", (0, -9), dxfattribs={"height": 2.5, "layer": "0"})
    for i, (x, y, rot, sc) in enumerate([(30, 160, 0, 1), (60, 160, 45, 1.5), (100, 160, 90, 0.8)]):
        ref = msp.add_blockref("부품표시", (x, y), dxfattribs={"rotation": rot, "xscale": sc, "yscale": sc, "layer": "블록", "color": 3 + i})
        ref.add_auto_attribs({"NO": f"P-{i + 1}"})
    # mirrored by an extrusion of -Z (OCS (-125, 160) is WCS (125, 160)); a negative X scale is not used
    # because LibreDWG 0.14 dxf2dwg writes the Y scale of such a reference wrongly
    msp.add_blockref("부품표시", (-125, 160), dxfattribs={"extrusion": (0, 0, -1), "layer": "블록"})
    arr = msp.add_blockref("부품표시", (175, 165), dxfattribs={"layer": "블록", "xscale": 0.5, "yscale": 0.5})
    arr.dxf.column_count = 4
    arr.dxf.row_count = 2
    arr.dxf.column_spacing = 15
    arr.dxf.row_spacing = 10

    # paper-space layout with a viewport and a title block
    lay = doc.layouts.new("배치1")
    lay.page_setup(size=(297, 210), margins=(10, 10, 10, 10), units="mm")
    lay.add_viewport(center=(140, 115), size=(250, 160), view_center_point=(148, 105), view_height=230)
    lay.add_lwpolyline([(0, 0), (277, 0), (277, 190), (0, 190)], close=True, dxfattribs={"layer": "외곽선"})
    lay.add_lwpolyline([(177, 0), (277, 0), (277, 30), (177, 30)], close=True, dxfattribs={"layer": "외곽선"})
    lay.add_text("표제란: 시험 도면", height=5, dxfattribs={"layer": "문자"}).set_placement((182, 18))
    lay.add_text("축척 1:1  ·  단위 mm", height=3, dxfattribs={"layer": "문자"}).set_placement((182, 8))
    return doc


def strip_mtext_rotation(path):
    """LibreDWG 0.14's DXF reader refuses group code 50 (rotation) in MTEXT, which ezdxf writes (also in
    dimension blocks); the rotation is 0 here, so the pair is dropped."""
    with open(path, "rb") as f:
        lines = f.read().split(b"\n")
    out = []
    entity = b""
    i = 0
    while i + 1 < len(lines):
        code, value = lines[i].strip(), lines[i + 1]
        if code == b"0":
            entity = value.strip()
        if not (entity == b"MTEXT" and code == b"50"):
            out += [lines[i], value]
        i += 2
    out += lines[i:]
    with open(path, "wb") as f:
        f.write(b"\n".join(out))


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(" ".join(cmd), "\n", r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit(f"failed: {cmd[0]}")


def png(width, height, pixel):
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(width)) for y in range(height))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def preview_only():
    """AC1015 file header + an image section with a PNG; the drawing sections are missing (zeros)."""
    w, h = 160, 110

    def px(x, y):
        # a little "drawing": frame, a circle and a diagonal, dark on white
        on = x in (4, w - 5) or y in (4, h - 5) or abs(math.hypot(x - 60, y - 55) - 30) < 1.2 or abs((y - 15) - (x - 100) * 0.9) < 1.0 and 100 <= x <= 150
        return (20, 60, 140) if on else (255, 255, 255)

    img = png(w, h, px)
    head = bytearray(b"AC1015" + bytes(7))
    seeker = 0x100
    head += struct.pack("<I", seeker)
    head += bytes(seeker - len(head))
    sentinel = bytes([0x1F, 0x25, 0x6D, 0x07, 0xD4, 0x36, 0x28, 0x28, 0x9D, 0x57, 0xCA, 0x3F, 0x9D, 0x44, 0x10, 0x2B])
    start = seeker + 16 + 4 + 1 + 9
    body = sentinel + struct.pack("<I", 1 + 9 + len(img)) + bytes([1]) + bytes([6]) + struct.pack("<II", start, len(img)) + img
    return bytes(head) + body + bytes(64)


def main():
    os.makedirs(OUT, exist_ok=True)
    doc = drawing()
    tmp = tempfile.mkdtemp(prefix="dwg-samples-")
    dxf = os.path.join(tmp, "drawing.dxf")
    doc.saveas(dxf)
    strip_mtext_rotation(dxf)
    outputs = [
        ("dxf2dwg", "r14", "drawing-r14.dwg"),
        ("dxf2dwg", "r2000", "drawing-r2000.dwg"),
        ("dxf2dwg", "r2004", "drawing-r2004.dwg"),
        ("dwgwrite", "r2010", "drawing-r2010.dwg"),
        ("dwgwrite", "r2013", "drawing-r2013.dwg"),
        ("dwgwrite", "r2018", "drawing-r2018.dwg"),
    ]
    for tool, ver, name in outputs:
        dst = os.path.join(OUT, name)
        if os.path.exists(dst):
            os.remove(dst)
        cmd = [exe(tool), "-y", "--as", ver, "-o", dst, dxf] if tool == "dwgwrite" else [exe(tool), "-y", "--as", ver, "-o", dst, dxf]
        try:
            run(cmd)
            print(f"{name:24} {os.path.getsize(dst):>8} bytes")
        except SystemExit as e:
            print(f"{name:24} skipped ({e})")
    # template: same format as a drawing
    shutil.copyfile(os.path.join(OUT, "drawing-r2000.dwg"), os.path.join(OUT, "template-r2000.dwt"))
    with open(os.path.join(OUT, "preview-only.dwg"), "wb") as f:
        f.write(preview_only())
    with open(os.path.join(OUT, "broken.dwg"), "wb") as f:
        f.write(b"AC1032" + bytes(range(256)) * 8)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
