"""Writes the 2D CAD fixtures (DXF, DWF, DWFx) for the CAD Drawing Preview. Every drawing is made
from scratch by this script, so the files carry this repository's licence (MIT). DXF files are
written with ezdxf (MIT, used only here at generation time); DWF/W2D and DWFx/XPS packages are
assembled byte by byte.

    python -m pip install ezdxf
    python tools/make-cad2d-samples.py

Outputs:
    samples/sample.dxf            R2018 ASCII: every supported entity, Korean text, 2 layouts
    samples/sample-r12.dxf        R12 ASCII in code page ANSI_949 (Korean), POLYLINE/VERTEX
    samples/sample-binary.dxf     binary DXF (R2013)
    samples/broken.dxf            truncated/garbled DXF (must end in a friendly error)
    samples/cad2d/*.dxf           one feature per file, for the fidelity comparison
    samples/sample.dwf            DWF 6 package: two sheets (W2D), thumbnails, a PNG image
    samples/sample-legacy.dwf     single-stream DWF V00.55 (W2D opcodes, zlib-compressed part)
    samples/sample-thumbonly.dwf  DWF 6 sheet whose stream uses an unsupported opcode → thumbnail
    samples/broken.dwf / broken.dwfx
    samples/sample.dwfx           DWFx: two FixedPages (paths, fills, glyphs, an image, an
                                  obfuscated embedded font)
"""
import math
import os
import struct
import sys
import zlib
import zipfile
import io

import ezdxf
from ezdxf import units
from ezdxf.enums import TextEntityAlignment, MTextEntityAlignment
from ezdxf.math import Vec2

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'samples')
FEAT = os.path.join(OUT, 'cad2d')
os.makedirs(FEAT, exist_ok=True)

KO = '한글 도면 제목: 배치도 (1:100)'


def setup_layers(doc):
    doc.layers.add('외곽선', color=7, lineweight=50)
    doc.layers.add('CENTER', color=1, linetype='CENTER')
    doc.layers.add('HIDDEN', color=3, linetype='HIDDEN')
    doc.layers.add('DIM', color=4)
    doc.layers.add('HATCH', color=8)
    doc.layers.add('TEXT', color=2)
    doc.layers.add('BLOCKS', color=5)
    off = doc.layers.add('OFF-LAYER', color=6)
    off.off()
    fz = doc.layers.add('FROZEN', color=6)
    fz.freeze()
    doc.layers.add('TRUECOLOR', true_color=ezdxf.rgb2int((255, 128, 0)))


def add_text_style(doc):
    doc.styles.add('KOREAN', font='malgun.ttf')
    doc.styles.add('ROMANS', font='romans.shx')


def lines_and_curves(msp, ox=0.0, oy=0.0):
    msp.add_line((ox, oy), (ox + 40, oy), dxfattribs={'layer': '외곽선'})
    msp.add_line((ox, oy + 5), (ox + 40, oy + 5), dxfattribs={'layer': 'CENTER'})
    msp.add_line((ox, oy + 10), (ox + 40, oy + 10), dxfattribs={'layer': 'HIDDEN'})
    msp.add_line((ox, oy + 15), (ox + 40, oy + 15), dxfattribs={'color': 1, 'lineweight': 70})
    msp.add_line((ox, oy + 20), (ox + 40, oy + 20), dxfattribs={'layer': 'TRUECOLOR'})
    msp.add_line((ox, oy + 25), (ox + 40, oy + 25), dxfattribs={'layer': 'OFF-LAYER'})
    msp.add_circle((ox + 55, oy + 12), 10, dxfattribs={'color': 3})
    msp.add_arc((ox + 80, oy + 12), 10, 30, 240, dxfattribs={'color': 5})
    msp.add_ellipse((ox + 105, oy + 12), major_axis=(12, 4), ratio=0.5, dxfattribs={'color': 6})
    msp.add_ellipse((ox + 130, oy + 12), major_axis=(0, 10), ratio=0.4, start_param=0, end_param=math.pi, dxfattribs={'color': 1})
    # OCS: an arc and circle with extrusion (0, 0, -1) (mirrored)
    msp.add_arc((-(ox + 150), oy + 12), 8, 0, 120, dxfattribs={'extrusion': (0, 0, -1), 'color': 2})


def polylines(msp, ox=0.0, oy=0.0):
    msp.add_lwpolyline([(ox, oy, 0, 0, 0.5), (ox + 20, oy, 0, 0, 0), (ox + 20, oy + 15, 0, 0, -1), (ox, oy + 15, 0, 0, 0)], format='xyseb', close=True, dxfattribs={'color': 1})
    msp.add_lwpolyline([(ox + 30, oy), (ox + 50, oy + 10), (ox + 70, oy)], dxfattribs={'const_width': 1.5, 'color': 3})
    p = msp.add_polyline2d([(ox + 80, oy), (ox + 95, oy + 12), (ox + 110, oy)], dxfattribs={'color': 4})
    p.vertices[0].dxf.bulge = 0.6
    msp.add_polyline3d([(ox + 120, oy, 0), (ox + 130, oy + 10, 5), (ox + 140, oy, 10)], dxfattribs={'color': 5})
    sp = msp.add_spline([(ox, oy - 20), (ox + 15, oy - 5), (ox + 30, oy - 25), (ox + 45, oy - 10), (ox + 60, oy - 22)], dxfattribs={'color': 2})
    sp2 = msp.add_spline_control_frame([(ox + 70, oy - 20), (ox + 85, oy - 5), (ox + 100, oy - 25), (ox + 115, oy - 10)], dxfattribs={'color': 6})
    msp.add_open_spline([(ox + 120, oy - 20), (ox + 130, oy - 5), (ox + 140, oy - 25), (ox + 150, oy - 10)], degree=3, dxfattribs={'color': 1})
    msp.add_rational_spline([(ox + 160, oy - 20), (ox + 170, oy - 5), (ox + 180, oy - 25), (ox + 190, oy - 10)], weights=[1, 3, 1, 1], degree=3, dxfattribs={'color': 3})
    return sp, sp2


def texts(msp, ox=0.0, oy=0.0):
    msp.add_text(KO, height=3.5, dxfattribs={'layer': 'TEXT', 'style': 'KOREAN'}).set_placement((ox, oy))
    msp.add_text('Center aligned', height=2.5, dxfattribs={'color': 1}).set_placement((ox + 60, oy - 8), align=TextEntityAlignment.CENTER)
    msp.add_text('Right aligned', height=2.5, dxfattribs={'color': 3}).set_placement((ox + 120, oy - 8), align=TextEntityAlignment.RIGHT)
    msp.add_text('Middle center', height=2.5, dxfattribs={'color': 5}).set_placement((ox + 60, oy - 16), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_text('Rotated 30°', height=2.5, rotation=30, dxfattribs={'color': 6}).set_placement((ox, oy - 25))
    msp.add_text('Fit text between points', height=2.5, dxfattribs={'color': 4}).set_placement((ox + 30, oy - 30), (ox + 110, oy - 30), align=TextEntityAlignment.FIT)
    msp.add_text('%%c50 %%p0.1 45%%d', height=2.5, dxfattribs={'color': 2, 'style': 'ROMANS'}).set_placement((ox + 120, oy - 25))
    mt = msp.add_mtext(
        '{\\fMalgun Gothic|b1;굵은 한글} 보통 글자\\P'
        '{\\C1;빨강} {\\H1.5x;큰 글씨} \\Lunderline\\l and \\Ooverline\\o\\P'
        'Stacked \\S1/2; and a long line that wraps inside the reference width of the MTEXT box.',
        dxfattribs={'char_height': 2.5, 'width': 60, 'layer': 'TEXT', 'style': 'KOREAN'},
    )
    mt.set_location((ox, oy - 40), attachment_point=MTextEntityAlignment.TOP_LEFT)
    mt2 = msp.add_mtext('Middle-centre\\Pattached MTEXT', dxfattribs={'char_height': 2.5, 'color': 6})
    mt2.set_location((ox + 120, oy - 50), attachment_point=MTextEntityAlignment.MIDDLE_CENTER, rotation=15)


def blocks(doc, msp, ox=0.0, oy=0.0):
    inner = doc.blocks.new('INNER', base_point=(0, 0))
    inner.add_circle((0, 0), 2)
    inner.add_line((-2, 0), (2, 0), dxfattribs={'color': 1})  # red regardless of the reference
    blk = doc.blocks.new('BOLT', base_point=(5, 5))
    blk.add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=True)  # layer 0 / BYLAYER → inherits
    blk.add_line((0, 0), (10, 10), dxfattribs={'color': 0})  # BYBLOCK colour
    blk.add_blockref('INNER', (5, 5))
    blk.add_attdef('TAG', (0, -3), dxfattribs={'height': 1.5})
    ref = msp.add_blockref('BOLT', (ox + 5, oy + 5), dxfattribs={'layer': 'BLOCKS', 'color': 3})
    ref.add_auto_attribs({'TAG': 'B-1'})
    msp.add_blockref('BOLT', (ox + 30, oy + 5), dxfattribs={'xscale': 1.5, 'yscale': 0.75, 'rotation': 30, 'layer': 'BLOCKS', 'color': 1})
    msp.add_blockref('BOLT', (ox + 60, oy + 5), dxfattribs={'xscale': -1, 'layer': 'BLOCKS'})  # mirrored
    arr = msp.add_blockref('INNER', (ox + 80, oy), dxfattribs={'layer': 'BLOCKS', 'color': 2})
    arr.dxf.column_count = 4
    arr.dxf.row_count = 3
    arr.dxf.column_spacing = 6
    arr.dxf.row_spacing = 6
    arr.dxf.rotation = 10


DIMO = {'dimtxt': 2.5, 'dimasz': 2.5, 'dimexe': 1.5, 'dimexo': 1.0, 'dimgap': 0.8}


def dims(doc, msp, ox=0.0, oy=0.0):
    a = msp.add_linear_dim(base=(ox, oy + 12), p1=(ox, oy), p2=(ox + 40, oy), dimstyle='EZDXF', override=DIMO, dxfattribs={'layer': 'DIM'})
    a.render()
    b = msp.add_aligned_dim(p1=(ox + 50, oy), p2=(ox + 80, oy + 20), distance=6, dimstyle='EZDXF', override=DIMO, dxfattribs={'layer': 'DIM'})
    b.render()
    msp.add_circle((ox + 105, oy + 8), 10)
    c = msp.add_radius_dim(center=(ox + 105, oy + 8), radius=10, angle=45, dimstyle='EZ_RADIUS', override=DIMO, dxfattribs={'layer': 'DIM'})
    c.render()
    msp.add_line((ox + 125, oy), (ox + 150, oy))
    msp.add_line((ox + 125, oy), (ox + 145, oy + 15))
    d = msp.add_angular_dim_2l(base=(ox + 140, oy + 6), line1=((ox + 125, oy), (ox + 150, oy)), line2=((ox + 125, oy), (ox + 145, oy + 15)), dimstyle='EZDXF', override=DIMO, dxfattribs={'layer': 'DIM'})
    d.render()


def hatches(msp, ox=0.0, oy=0.0):
    h = msp.add_hatch(color=1, dxfattribs={'layer': 'HATCH'})
    h.paths.add_polyline_path([(ox, oy), (ox + 25, oy), (ox + 25, oy + 20), (ox, oy + 20)], is_closed=True)
    h2 = msp.add_hatch(color=5, dxfattribs={'layer': 'HATCH'})
    h2.set_pattern_fill('ANSI31', scale=0.5)
    h2.paths.add_polyline_path([(ox + 35, oy), (ox + 65, oy), (ox + 65, oy + 20), (ox + 35, oy + 20)], is_closed=True, flags=1)
    h2.paths.add_polyline_path([(ox + 45, oy + 5), (ox + 55, oy + 5), (ox + 55, oy + 15), (ox + 45, oy + 15)], is_closed=True, flags=16)
    h3 = msp.add_hatch(color=3, dxfattribs={'layer': 'HATCH'})
    h3.set_pattern_fill('NET', scale=0.6, angle=15)
    ep = h3.paths.add_edge_path()
    ep.add_line((ox + 75, oy), (ox + 105, oy))
    ep.add_arc((ox + 105, oy + 10), 10, -90, 90, ccw=True)
    ep.add_line((ox + 105, oy + 20), (ox + 75, oy + 20))
    ep.add_ellipse((ox + 75, oy + 10), major_axis=(0, 10), ratio=0.5, start_angle=0, end_angle=180, ccw=True)
    h4 = msp.add_hatch(color=6, dxfattribs={'layer': 'HATCH'})
    h4.set_pattern_fill('DASH', scale=0.5)
    h4.paths.add_polyline_path([(ox + 125, oy), (ox + 145, oy + 20), (ox + 165, oy)], is_closed=True)
    g = msp.add_hatch(dxfattribs={'layer': 'HATCH'})
    g.set_gradient((0, 120, 255), (255, 255, 255))
    g.paths.add_polyline_path([(ox + 175, oy), (ox + 195, oy), (ox + 195, oy + 20), (ox + 175, oy + 20)], is_closed=True)


def misc(msp, ox=0.0, oy=0.0):
    msp.add_solid([(ox, oy), (ox + 15, oy), (ox, oy + 10), (ox + 15, oy + 10)], dxfattribs={'color': 4})
    msp.add_trace([(ox + 20, oy), (ox + 35, oy), (ox + 20, oy + 5), (ox + 35, oy + 5)], dxfattribs={'color': 2})
    msp.add_3dface([(ox + 40, oy), (ox + 55, oy), (ox + 55, oy + 10), (ox + 40, oy + 10)], dxfattribs={'color': 1})
    for i in range(5):
        msp.add_point((ox + 60 + i * 3, oy + 5), dxfattribs={'color': 7})
    msp.add_leader([(ox + 80, oy + 2), (ox + 90, oy + 10), (ox + 100, oy + 10)], dxfattribs={'color': 3})
    msp.add_text('LEADER', height=2).set_placement((ox + 101, oy + 9))
    ml = msp.add_multileader_mtext('Standard')
    ml.set_content('MLEADER 주석', char_height=2.5)
    ml.add_leader_line(ezdxf.render.mleader.ConnectionSide.left, [Vec2(ox + 115, oy + 2)])
    ml.build(insert=Vec2(ox + 120, oy + 10))
    msp.add_line((ox + 145, oy + 8), (ox + 175, oy + 8), dxfattribs={'color': 3})  # drawn before: hidden under the wipeout
    msp.add_wipeout([(ox + 150, oy - 2), (ox + 170, oy - 2), (ox + 170, oy + 12), (ox + 150, oy + 12)])
    msp.add_line((ox + 145, oy + 2), (ox + 175, oy + 2), dxfattribs={'color': 1})  # drawn after: on top
    msp.add_xline((ox + 185, oy), (1, 1), dxfattribs={'layer': 'CENTER'})


def layouts(doc, msp):
    lay = doc.layouts.new('도면-A3')
    lay.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units='mm')
    lay.add_viewport(center=(140, 160), size=(240, 200), view_center_point=(100, 0), view_height=180)
    lay.add_viewport(center=(340, 200), size=(120, 110), view_center_point=(25, -40), view_height=40)
    lay.add_lwpolyline([(0, 0), (400, 0), (400, 277), (0, 277)], close=True, dxfattribs={'lineweight': 70})
    lay.add_text('표제란 TITLE BLOCK', height=6, dxfattribs={'style': 'KOREAN'}).set_placement((285, 20))
    lay.add_lwpolyline([(280, 5), (395, 5), (395, 45), (280, 45)], close=True)
    lay2 = doc.layouts.get('Layout1')
    lay2.page_setup(size=(297, 210), margins=(5, 5, 5, 5), units='mm')
    lay2.add_viewport(center=(148, 105), size=(270, 180), view_center_point=(100, 0), view_height=200)
    lay2.add_text('Layout1 sheet', height=5).set_placement((15, 15))


def showcase():
    doc = ezdxf.new('R2018', setup=True, units=units.MM)
    setup_layers(doc)
    add_text_style(doc)
    msp = doc.modelspace()
    lines_and_curves(msp, 0, 60)
    polylines(msp, 0, 30)
    texts(msp, 0, 0)
    blocks(doc, msp, 0, -80)
    dims(doc, msp, 0, -120)
    hatches(msp, 0, -160)
    misc(msp, 0, -190)
    msp.add_line((0, 95), (40, 95), dxfattribs={'layer': 'FROZEN'})
    layouts(doc, msp)
    doc.saveas(os.path.join(OUT, 'sample.dxf'))
    return doc


def r12():
    doc = ezdxf.new('R12', setup=True)
    doc.header['$DWGCODEPAGE'] = 'ANSI_949'
    doc.encoding = 'cp949'
    doc.layers.add('벽체', color=1)
    doc.layers.add('문자', color=3)
    msp = doc.modelspace()
    msp.add_polyline2d([(0, 0), (60, 0), (60, 40), (0, 40)], close=True, dxfattribs={'layer': '벽체'})
    p = msp.add_polyline2d([(70, 0), (90, 20), (110, 0)], dxfattribs={'color': 5})
    p.vertices[0].dxf.bulge = -0.5
    msp.add_circle((30, 20), 8, dxfattribs={'color': 2})
    msp.add_text('R12 한글 코드페이지 949', height=3, dxfattribs={'layer': '문자'}).set_placement((2, 45))
    blk = doc.blocks.new('MARK')
    blk.add_line((-2, -2), (2, 2))
    blk.add_line((-2, 2), (2, -2))
    for i in range(5):
        msp.add_blockref('MARK', (70 + i * 8, 30), dxfattribs={'color': i + 1})
    # Paper space entities (R12: 67=1 in ENTITIES)
    psp = doc.layout('Layout1') if 'Layout1' in doc.layouts else doc.paperspace()
    psp.add_lwpolyline([(0, 0), (120, 0), (120, 80), (0, 80)], close=True) if hasattr(psp, 'add_lwpolyline') and doc.dxfversion > 'AC1009' else psp.add_polyline2d([(0, 0), (120, 0), (120, 80), (0, 80)], close=True)
    psp.add_text('PAPER SPACE R12', height=4).set_placement((5, 5))
    doc.saveas(os.path.join(OUT, 'sample-r12.dxf'), encoding='cp949')


def binary():
    doc = ezdxf.new('R2013', setup=True, units=units.MM)
    msp = doc.modelspace()
    doc.layers.add('BIN', color=4)
    for i in range(12):
        a = i * math.pi / 6
        msp.add_line((0, 0), (40 * math.cos(a), 40 * math.sin(a)), dxfattribs={'color': i % 7 + 1})
    msp.add_circle((0, 0), 40, dxfattribs={'layer': 'BIN'})
    msp.add_text('Binary DXF 바이너리', height=4).set_placement((-30, -50))
    h = msp.add_hatch(color=1)
    h.paths.add_polyline_path([(-10, -10), (10, -10), (10, 10), (-10, 10)], is_closed=True)
    doc.saveas(os.path.join(OUT, 'sample-binary.dxf'), fmt='bin')


def broken():
    src = open(os.path.join(OUT, 'sample.dxf'), 'rb').read()
    # Group codes replaced by garbage after the header: not a readable tag stream.
    cut = src[:4000] + b'\nNOT_A_CODE\nxyz\n'
    open(os.path.join(OUT, 'broken.dxf'), 'wb').write(cut)


def features():
    """One feature per drawing (light background compare against ezdxf's own renderer)."""
    def new():
        d = ezdxf.new('R2018', setup=True, units=units.MM)
        setup_layers(d)
        add_text_style(d)
        return d, d.modelspace()

    jobs = {
        'lines-curves': lambda d, m: lines_and_curves(m),
        'polylines-splines': lambda d, m: polylines(m),
        'text-mtext': lambda d, m: texts(m),
        'blocks-inserts': lambda d, m: blocks(d, m),
        'dimensions': lambda d, m: dims(d, m),
        'hatches': lambda d, m: hatches(m),
        'solid-point-leader': lambda d, m: misc(m),
    }
    for name, fn in jobs.items():
        d, m = new()
        fn(d, m)
        d.saveas(os.path.join(FEAT, f'{name}.dxf'))


# ---------------------------------------------------------------------------------------------
# DWF (WHIP! W2D)
# ---------------------------------------------------------------------------------------------

class W2D:
    """Minimal W2D stream writer: binary opcodes with 32-bit relative coordinates."""

    def __init__(self, header=b'(W2D V06.00)'):
        self.b = bytearray(header)
        self.cur = (0, 0)

    def rel(self, x, y):
        dx, dy = x - self.cur[0], y - self.cur[1]
        self.cur = (x, y)
        return struct.pack('<ii', dx, dy)

    def count(self, n):
        return struct.pack('<B', n) if 0 < n < 256 else b'\x00' + struct.pack('<H', n - 256)

    def ascii(self, s):
        self.b += s.encode('ascii')

    def color(self, r, g, b, a=255):
        self.b += b'\x03' + bytes([r, g, b, a])

    def color_index(self, i):
        self.b += b'c' + bytes([i])

    def weight(self, w):
        self.b += b'\x17' + struct.pack('<i', w)

    def fill(self, on):
        self.b += b'F' if on else b'f'

    def layer(self, num, name):
        # Non-ASCII names use the hex form: "XXXX..." (one UTF-16 code unit per four hex digits).
        q = f"'{name}'" if name.isascii() else '"' + ''.join('%04X' % ord(c) for c in name) + '"'
        self.ascii(f"(Layer {num} {q})")

    def set_layer(self, num):
        self.b += b'\xac' + self.count(num)

    def line(self, x0, y0, x1, y1):
        self.b += b'l' + self.rel(x0, y0) + self.rel(x1, y1)

    def line16(self, x0, y0, x1, y1):
        dx0, dy0 = x0 - self.cur[0], y0 - self.cur[1]
        self.cur = (x0, y0)
        dx1, dy1 = x1 - x0, y1 - y0
        self.cur = (x1, y1)
        self.b += b'\x0c' + struct.pack('<hhhh', dx0, dy0, dx1, dy1)

    def polyline(self, pts):
        self.b += b'p' + self.count(len(pts)) + b''.join(self.rel(x, y) for x, y in pts)

    def origin(self, x, y):
        self.b += b'O' + struct.pack('<ii', x, y)
        self.cur = (x, y)

    def polyline16(self, pts):
        self.origin(*pts[0])
        out = b'\x10' + self.count(len(pts))
        for x, y in pts:
            out += struct.pack('<hh', x - self.cur[0], y - self.cur[1])
            self.cur = (x, y)
        self.b += out

    def circle(self, x, y, r):
        self.b += b'r' + self.rel(x, y) + struct.pack('<I', r)

    def arc(self, x, y, r, start, end):
        self.b += b'\x92' + self.rel(x, y) + struct.pack('<IHH', r, start, end)

    def ellipse(self, x, y, major, minor, start, end, tilt):
        self.b += b'e' + self.rel(x, y) + struct.pack('<IIHHH', major, minor, start, end, tilt)

    def contour(self, loops):
        out = b'k' + self.count(len(loops))
        for lp in loops:
            out += self.count(len(lp))
        for lp in loops:
            for x, y in lp:
                out += self.rel(x, y)
        self.b += out

    def polytriangle(self, pts):
        self.b += b't' + self.count(len(pts)) + b''.join(self.rel(x, y) for x, y in pts)

    def font(self, name, height, rotation=0, width_scale=1024, oblique=0):
        # fields: name | height | rotation | width scale | oblique
        fields = 0x0001 | 0x0020 | 0x0040 | 0x0080 | 0x0200
        enc = name.encode('utf-16-le')
        self.b += b'\x06' + struct.pack('<H', fields) + b'{' + struct.pack('<i', len(name)) + enc + b'}'
        self.b += struct.pack('<i', height) + struct.pack('<H', rotation) + struct.pack('<H', width_scale) + struct.pack('<H', oblique)

    def text(self, x, y, s):
        enc = s.encode('utf-16-le')
        self.b += b'x' + self.rel(x, y) + b'{' + struct.pack('<i', len(enc) // 2) + enc + b'}'

    def ext_binary(self, op, payload):
        self.b += b'{' + struct.pack('<i', len(payload) + 3) + struct.pack('<H', op) + payload + b'}'

    def png(self, x0, y0, x1, y1, png, w, h):
        p = struct.pack('<HH', w, h)
        # corners are relative points too
        p += self.rel(x0, y0) + self.rel(x1, y1)
        p += struct.pack('<i', 1) + struct.pack('<i', len(png)) + png
        self.ext_binary(0x000C, p)

    def end(self):
        self.ascii('(EndOfDWF)')
        return bytes(self.b)


def png_bytes(w, h, fn):
    raw = b''
    for y in range(h):
        raw += b'\x00' + b''.join(bytes(fn(x, y)) for x in range(w))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def gradient_png(w=64, h=48):
    return png_bytes(w, h, lambda x, y: (int(255 * x / (w - 1)), int(255 * y / (h - 1)), 160))


def thumb_png(label_color=(30, 90, 200)):
    def f(x, y):
        if 8 <= x < 120 and 8 <= y < 88 and (x in (8, 119) or y in (8, 87) or abs((x - 8) * 80 / 112 - (y - 8)) < 1.2):
            return label_color
        return (255, 255, 255)
    return png_bytes(128, 96, f)


def sheet_stream(title, variant=0):
    w = W2D()
    w.ascii("(Units 'mm' ((1000 0 0 0)(0 1000 0 0)(0 0 1 0)(0 0 0 1)))")
    w.layer(1, 'Walls 벽체')
    w.layer(2, 'Furniture')
    w.layer(3, 'Annotation 주석')
    w.ascii('(ColorMap 4 255,255,255,255 0,0,0,255 200,0,0,255 0,120,0,255)')
    # Border (16-bit polyline, colour index 1 = black)
    w.set_layer(1)
    w.color_index(1)
    w.weight(400)
    w.polyline([(0, 0), (420000, 0), (420000, 297000), (0, 297000), (0, 0)])
    w.weight(0)
    # Walls: thick lines and a filled contour with a hole
    w.color(40, 40, 40)
    w.weight(1500)
    w.line(30000, 40000, 300000, 40000)
    w.line(300000, 40000, 300000, 250000)
    w.line16(300000, 250000, 300000 - 30000, 250000)
    w.weight(0)
    w.fill(True)
    w.color(180, 200, 230)
    w.contour([[(40000, 60000), (140000, 60000), (140000, 140000), (40000, 140000)], [(70000, 90000), (110000, 90000), (110000, 110000), (70000, 110000)]])
    w.fill(False)
    # Furniture layer: circles, arcs, ellipses, polytriangle
    w.set_layer(2)
    w.color_index(2)
    w.circle(200000, 100000, 30000)
    w.arc(200000, 100000, 40000, 0, 16384)
    w.color(0, 120, 0)
    w.ellipse(200000, 190000, 40000, 20000, 0, 0, 8192)
    w.fill(True)
    w.color(255, 160, 0)
    w.polytriangle([(160000, 230000), (200000, 230000), (180000, 260000)])
    w.fill(False)
    w.color(0, 0, 200)
    w.polyline16([(40000, 160000), (60000, 180000), (80000, 160000), (100000, 180000)])
    # Annotation: text with a font, image
    w.set_layer(3)
    w.color(0, 0, 0)
    w.font('Arial', 8000)
    w.text(320000, 260000, title)
    w.font('Malgun Gothic', 6000, rotation=16384 // 4)
    w.text(320000, 120000, '회전된 한글 문자')
    w.png(320000, 30000, 400000, 90000, gradient_png(), 64, 48)
    if variant == 1:
        # An opcode this preview does not know (Gouraud polyline 'q' is skipped; 0x01 is not an opcode)
        w.b += b'\x01'
    return w.end()


def dwf_package(path, sheets, unsupported=False):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        secs = []
        for i, (title, stream) in enumerate(sheets):
            sec = f'com.autodesk.dwf.ePlot_{i}'
            secs.append((sec, title))
            z.writestr(f'{sec}/sheet{i}.w2d', stream)
            z.writestr(f'{sec}/thumb{i}.png', thumb_png((30 + 80 * i, 90, 200)))
            z.writestr(
                f'{sec}/descriptor.xml',
                f'''<?xml version="1.0" encoding="UTF-8"?>
<ePlot:Page xmlns:ePlot="DWF-ePlot:6.0" version="1.2" name="{title}" objectId="p{i}">
  <ePlot:Paper units="mm" width="420" height="297" color="255 255 255"/>
  <dwf:Resources xmlns:dwf="DWF-DWF:6.0">
    <dwf:GraphicResource role="2d streaming graphics" mime="application/x-w2d" href="{sec}/sheet{i}.w2d" title="{title}"
      transform="0.001 0 0 0 0 0.001 0 0 0 0 1 0 0 0 0 1" extents="0 0 420000 297000"/>
    <dwf:ImageResource role="thumbnail" mime="image/png" href="{sec}/thumb{i}.png" extents="0 0 128 96"/>
  </dwf:Resources>
</ePlot:Page>''',
            )
        sections = '\n'.join(
            f'''    <dwf:Section type="com.autodesk.dwf.ePlot" name="{sec}" title="{title}" version="1.2" objectId="s{i}">
      <dwf:Source/>
      <dwf:Resources><dwf:Resource role="descriptor" mime="text/xml" href="{sec}/descriptor.xml"/></dwf:Resources>
    </dwf:Section>'''
            for i, (sec, title) in enumerate(secs)
        )
        z.writestr(
            'manifest.xml',
            f'''<?xml version="1.0" encoding="UTF-8"?>
<dwf:Manifest xmlns:dwf="DWF-Manifest:6.0" version="6.0" objectId="m">
  <dwf:Sections>
{sections}
  </dwf:Sections>
</dwf:Manifest>''',
        )
    open(path, 'wb').write(b'(DWF V06.00)' + buf.getvalue())


def legacy_dwf(path):
    w = W2D(b'(DWF V00.55)')
    w.ascii("(Bounds 0,0 100000,80000)")
    w.color(0, 0, 0)
    w.polyline([(0, 0), (100000, 0), (100000, 80000), (0, 80000), (0, 0)])
    head = bytes(w.b)
    # The rest goes through a zlib-compressed extended binary block, as older writers did.
    w2 = W2D(b'')
    w2.cur = w.cur
    w2.color(200, 0, 0)
    w2.circle(50000, 40000, 20000)
    w2.color(0, 0, 200)
    w2.line(10000, 10000, 90000, 70000)
    w2.ascii("(LineWeight 300)")
    w2.ascii("(Color 0,128,0,255)")
    w2.ascii("L 10000,70000 90000,10000")
    w2.font('Arial', 4000)
    w2.color(0, 0, 0)
    w2.text(5000, 5000, 'Legacy DWF V00.55')
    body = zlib.compress(bytes(w2.b))
    out = head + b'{' + struct.pack('<i', 0) + struct.pack('<H', 0x0011) + body + b'}' + b'(EndOfDWF)'
    open(path, 'wb').write(out)


# ---------------------------------------------------------------------------------------------
# DWFx (OPC + XPS FixedPage)
# ---------------------------------------------------------------------------------------------

FONT_GUID = '1B2C3D4E-5F60-4718-8293-A4B5C6D7E8F9'


def obfuscate(font, guid):
    g = guid.replace('-', '')
    key = bytes(int(g[i * 2:i * 2 + 2], 16) for i in range(16))
    data = bytearray(font)
    for i in range(32):
        data[i] ^= key[15 - (i % 16)]
    return bytes(data)


def find_font():
    """A tiny TrueType font drawn by this script (fontTools), so the embedded-font path is visible:
    every glyph is a slanted 'stencil' box, unlike any system font. None without fontTools."""
    try:
        from fontTools.fontBuilder import FontBuilder
        from fontTools.pens.ttGlyphPen import TTGlyphPen
    except ImportError:
        return None
    chars = sorted(set('DWFx sheet 12 시트'))
    names = ['.notdef'] + [f'g{ord(c):04x}' for c in chars]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({ord(c): f'g{ord(c):04x}' for c in chars})
    glyphs = {}
    for n in names:
        pen = TTGlyphPen(None)
        if n != '.notdef' and n != 'g0020':
            # outer slanted box with a window: clearly a custom font
            for (x0, y0, x1, y1, cw) in ((60, 0, 560, 700, True), (180, 160, 440, 540, False)):
                pts = [(x0, y0), (x1, y0), (x1 + 120, y1), (x0 + 120, y1)]
                if not cw:
                    pts = pts[::-1]
                pen.moveTo(pts[0])
                for p in pts[1:]:
                    pen.lineTo(p)
                pen.closePath()
        glyphs[n] = pen.glyph()
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({n: (700 if n != 'g0020' else 300, 0) for n in names})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': 'CAD2D Stencil Test', 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=800, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    out = io.BytesIO()
    fb.save(out)
    return out.getvalue()


def fpage(n, font_part):
    glyph_font = f' FontUri="/Resources/{FONT_GUID}.odttf"' if font_part else ' FontUri="/Resources/missing.odttf"'
    return f'''<FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key" Width="1587.4" Height="1122.5" xml:lang="ko-KR">
  <FixedPage.Resources>
    <ResourceDictionary>
      <SolidColorBrush x:Key="b0" Color="#FF1E5AA0"/>
      <PathGeometry x:Key="g0" Figures="M 100,100 L 300,100 L 300,250 L 100,250 Z"/>
    </ResourceDictionary>
  </FixedPage.Resources>
  <Path Data="M 20,20 L 1567,20 L 1567,1102 L 20,1102 Z" Stroke="#FF000000" StrokeThickness="3"/>
  <Canvas Name="Layer_Walls" RenderTransform="1,0,0,1,0,0">
    <Path Data="F1 M 400,300 L 900,300 L 900,700 L 400,700 Z M 500,400 L 800,400 L 800,600 L 500,600 Z" Fill="#FFB4C8E6" Stroke="#FF202020" StrokeThickness="2"/>
    <Path Data="{{StaticResource g0}}" Fill="{{StaticResource b0}}"/>
    <Path Data="M 1000,300 C 1100,200 1200,400 1300,300" Stroke="#FFC00000" StrokeThickness="4" StrokeDashArray="4 2"/>
    <Path Data="M 1000,500 A 100,60 30 1 1 1250,520" Stroke="#FF008000" StrokeThickness="3"/>
    <Path Stroke="#FF0000C8" StrokeThickness="2">
      <Path.Data><PathGeometry><PathFigure StartPoint="1000,700" IsClosed="true"><PolyLineSegment Points="1100,650 1200,750 1300,650"/></PathFigure></PathGeometry></Path.Data>
    </Path>
  </Canvas>
  <Canvas RenderTransform="0.866,0.5,-0.5,0.866,300,800">
    <Glyphs OriginX="0" OriginY="0" FontRenderingEmSize="40" UnicodeString="DWFx sheet {n} 시트"{glyph_font} Fill="#FF000000"/>
  </Canvas>
  <Glyphs OriginX="1100" OriginY="1050" FontRenderingEmSize="28" UnicodeString="Title block 표제란" FontUri="/Resources/missing.odttf" Fill="#FF333333" Indices=",60;,60;,60"/>
  <Path Data="M 1100,850 L 1500,850 L 1500,1000 L 1100,1000 Z">
    <Path.Fill><ImageBrush ImageSource="/Resources/img.png" Viewbox="0,0,64,48" ViewboxUnits="Absolute" Viewport="1100,850,400,150" ViewportUnits="Absolute"/></Path.Fill>
  </Path>
</FixedPage>'''


def dwfx(path):
    font = find_font()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/>
  <Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/>
  <Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="odttf" ContentType="application/vnd.ms-package.obfuscated-opentype"/>
</Types>''')
        z.writestr('_rels/.rels', '''<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocumentSequence.fdseq" Id="R1"/>
</Relationships>''')
        z.writestr('FixedDocumentSequence.fdseq', '''<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06"><DocumentReference Source="/Documents/1/FixedDocument.fdoc"/></FixedDocumentSequence>''')
        z.writestr('Documents/1/FixedDocument.fdoc', '''<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">
  <PageContent Source="Pages/1.fpage"/>
  <PageContent Source="Pages/2.fpage"/>
</FixedDocument>''')
        for n in (1, 2):
            z.writestr(f'Documents/1/Pages/{n}.fpage', fpage(n, font is not None))
        z.writestr('Resources/img.png', gradient_png())
        if font:
            z.writestr(f'Resources/{FONT_GUID}.odttf', obfuscate(font, FONT_GUID))
    open(path, 'wb').write(buf.getvalue())


def main():
    showcase()
    r12()
    binary()
    broken()
    features()
    dwf_package(os.path.join(OUT, 'sample.dwf'), [('Ground floor 1층', sheet_stream('Ground floor 1층 평면도')), ('Second floor', sheet_stream('Second floor'))])
    dwf_package(os.path.join(OUT, 'sample-thumbonly.dwf'), [('Unsupported', sheet_stream('Unsupported', variant=1))])
    legacy_dwf(os.path.join(OUT, 'sample-legacy.dwf'))
    open(os.path.join(OUT, 'broken.dwf'), 'wb').write(b'(DWF V06.00)PK\x03\x04' + b'\x00' * 40 + b'truncated')
    dwfx(os.path.join(OUT, 'sample.dwfx'))
    open(os.path.join(OUT, 'broken.dwfx'), 'wb').write(b'PK\x03\x04' + os.urandom(0) + b'\x14\x00not really a zip archive')
    print('ok')


if __name__ == '__main__':
    main()
