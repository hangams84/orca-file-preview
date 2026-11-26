"""Generates the diagram samples: draw.io files (samples/diagram/*.drawio, samples/sample.drawio,
samples/sample.dio, samples/broken.drawio) and Visio packages (samples/diagram/*.vsdx,
samples/sample.vsdx, samples/broken.vsdx). Everything is written from scratch here, so the files are
public-safe (MIT, like the repository).

    python tools/make-diagram-samples.py
"""
import base64
import io
import struct
import urllib.parse
import zlib
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "samples" / "diagram"
OUT.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------------------- small PNG

def png(w, h, pixel):
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PICTURE = png(48, 32, lambda x, y: (40 + x * 4, 120 + y * 3, 200 - x * 2) if (x // 8 + y // 8) % 2 else (250, 200, 60))


# ---------------------------------------------------------------------------- draw.io

class Model:
    def __init__(self, background=None):
        self.cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
        self.n = 1
        self.background = background

    def nid(self):
        self.n += 1
        return f"c{self.n}"

    def vertex(self, value, style, x, y, w, h, parent="1", wrap=None, cid=None):
        cid = cid or self.nid()
        cell = f'<mxCell id="{cid}" value={quoteattr(value)} style={quoteattr(style)} vertex="1" parent="{parent}"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        if wrap:
            attrs = " ".join(f"{k}={quoteattr(v)}" for k, v in wrap.items())
            cell = f'<UserObject label={quoteattr(value)} {attrs} id="{cid}">' + cell.replace(f'<mxCell id="{cid}" value={quoteattr(value)} ', "<mxCell ") + "</UserObject>"
        self.cells.append(cell)
        return cid

    def edge(self, src, tgt, style, value="", points=(), parent="1", sp=None, tp=None, label_geo=None):
        cid = self.nid()
        geo = '<mxGeometry relative="1" as="geometry"'
        if label_geo:
            geo += f' x="{label_geo[0]}" y="{label_geo[1]}"'
        geo += ">"
        if sp:
            geo += f'<mxPoint x="{sp[0]}" y="{sp[1]}" as="sourcePoint"/>'
        if tp:
            geo += f'<mxPoint x="{tp[0]}" y="{tp[1]}" as="targetPoint"/>'
        if points:
            geo += '<Array as="points">' + "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in points) + "</Array>"
        geo += "</mxGeometry>"
        st = f' source="{src}"' if src else ""
        tt = f' target="{tgt}"' if tgt else ""
        self.cells.append(f'<mxCell id="{cid}" value={quoteattr(value)} style={quoteattr(style)} edge="1" parent="{parent}"{st}{tt}>{geo}</mxCell>')
        return cid

    def edge_label(self, edge_id, value, x, y=0):
        cid = self.nid()
        self.cells.append(
            f'<mxCell id="{cid}" value={quoteattr(value)} style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="{edge_id}">'
            f'<mxGeometry x="{x}" y="{y}" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>'
        )

    def layer(self, name, visible=True):
        cid = self.nid()
        self.cells.append(f'<mxCell id="{cid}" value={quoteattr(name)} parent="0"{"" if visible else " visible=\"0\""}/>')
        return cid

    def xml(self):
        bg = f' background="{self.background}"' if self.background else ""
        return f'<mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100"{bg}><root>' + "".join(self.cells) + "</root></mxGraphModel>"


def compress(xml):
    enc = urllib.parse.quote(xml, safe="-_.!~*'()")
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return base64.b64encode(c.compress(enc.encode("ascii")) + c.flush()).decode("ascii")


def mxfile(pages, compressed=False):
    out = ['<mxfile host="make-diagram-samples" agent="File Preview samples" version="24.7.17">']
    for i, (name, model) in enumerate(pages):
        body = compress(model.xml()) if compressed else model.xml()
        out.append(f'<diagram id="p{i + 1}" name={quoteattr(name)}>{body}</diagram>')
    out.append("</mxfile>")
    return "\n".join(out)


def drawio_shapes():
    m = Model()
    data = "data:image/png," + base64.b64encode(PICTURE).decode()
    shapes = [
        ("Rectangle", "rounded=0;whiteSpace=wrap;html=1;"),
        ("Rounded", "rounded=1;whiteSpace=wrap;html=1;"),
        ("Ellipse", "ellipse;whiteSpace=wrap;html=1;"),
        ("Rhombus", "rhombus;whiteSpace=wrap;html=1;"),
        ("Triangle", "triangle;whiteSpace=wrap;html=1;"),
        ("Hexagon", "shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;"),
        ("Cylinder", "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;"),
        ("Cloud", "ellipse;shape=cloud;whiteSpace=wrap;html=1;"),
        ("Document", "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;"),
        ("Process", "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;"),
        ("Parallelogram", "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;"),
        ("Trapezoid", "shape=trapezoid;perimeter=trapezoidPerimeter;whiteSpace=wrap;html=1;fixedSize=1;"),
        ("Step", "shape=step;perimeter=stepPerimeter;whiteSpace=wrap;html=1;fixedSize=1;"),
        ("Note", "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=15;"),
        ("Card", "shape=card;whiteSpace=wrap;html=1;"),
        ("Internal storage", "shape=internalStorage;whiteSpace=wrap;html=1;backgroundOutline=1;"),
        ("Double ellipse", "ellipse;shape=doubleEllipse;whiteSpace=wrap;html=1;"),
        ("Cube", "shape=cube;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;"),
        ("Callout", "shape=callout;whiteSpace=wrap;html=1;perimeter=calloutPerimeter;"),
        ("Tape", "shape=tape;whiteSpace=wrap;html=1;"),
        ("Terminator", "shape=mxgraph.flowchart.terminator;whiteSpace=wrap;html=1;strokeWidth=1;"),
        ("Delay", "shape=mxgraph.flowchart.delay;whiteSpace=wrap;html=1;"),
        ("", "sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=#ED7100;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.lambda_function;"),
        ("Triangle south", "triangle;whiteSpace=wrap;html=1;direction=south;"),
    ]
    for i, (label, style) in enumerate(shapes):
        x = 20 + (i % 6) * 140
        y = 20 + (i // 6) * 110
        m.vertex(label, style, x, y, 110, 70)
    y = 470
    m.vertex("Text only", "text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;", 20, y, 110, 30)
    m.vertex("Actor", "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;", 180, y - 10, 30, 60)
    m.vertex("Picture", f"shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image={data};", 260, y - 10, 72, 48)
    m.vertex("Remote picture", "shape=image;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=0;image=https://example.invalid/logo.png;", 380, y - 10, 72, 48)
    m.vertex("Star", "shape=mxgraph.basic.star;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;", 500, y - 10, 70, 60)
    m.vertex("Swimlane", "swimlane;whiteSpace=wrap;html=1;", 620, y - 20, 200, 120)
    return mxfile([("Shapes", m)])


def drawio_edges():
    m = Model()
    box = "rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"
    a = m.vertex("A", box, 40, 40, 100, 50)
    b = m.vertex("B", box, 300, 40, 100, 50)
    c = m.vertex("C", box, 300, 180, 100, 50)
    d = m.vertex("D", "ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;", 40, 180, 100, 60)
    e = m.vertex("E", "rhombus;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;", 560, 160, 100, 80)
    f = m.vertex("F", box, 560, 40, 100, 50)
    g = m.vertex("G", box, 40, 330, 100, 50)
    hh = m.vertex("H", box, 300, 330, 100, 50)
    i = m.vertex("I", box, 560, 330, 100, 50)
    j = m.vertex("J", box, 300, 470, 100, 50)
    k = m.vertex("K", box, 560, 470, 100, 50)
    m.edge(a, b, "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;", "straight ortho")
    m.edge(b, c, "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;")
    m.edge(a, d, "endArrow=open;html=1;rounded=0;startArrow=oval;startFill=1;", "straight")
    m.edge(d, c, "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;dashed=1;strokeColor=#b85450;strokeWidth=2;endArrow=diamond;endFill=0;")
    m.edge(b, e, "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;", "L route")
    m.edge(f, e, "endArrow=classic;html=1;rounded=0;startArrow=classic;startFill=1;", "both ends")
    m.edge(c, hh, "curved=1;endArrow=classic;html=1;", "curved", points=[(450, 260), (420, 300)])
    m.edge(g, hh, "edgeStyle=elbowEdgeStyle;elbow=horizontal;endArrow=classic;html=1;rounded=0;", "elbow", points=[(200, 300)])
    e1 = m.edge(hh, i, "edgeStyle=entityRelationEdgeStyle;fontSize=12;html=1;endArrow=ERmany;startArrow=ERmandOne;rounded=0;endFill=0;")
    m.edge_label(e1, "1..n", -0.5, 0)
    m.edge(d, g, "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;endArrow=classic;", "waypoint", points=[(20, 280), (90, 280)])
    m.edge(hh, j, "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=blockThin;endFill=1;strokeWidth=3;")
    m.edge(j, k, "endArrow=none;html=1;rounded=0;dashed=1;dashPattern=8 4;", "no arrows")
    m.edge(e, i, "edgeStyle=orthogonalEdgeStyle;html=1;endArrow=async;endFill=1;", "")
    m.edge(None, None, "endArrow=classic;html=1;", "dangling", sp=(60, 560), tp=(220, 600))
    m.edge(k, f, "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;exitX=1;exitY=0.5;entryX=1;entryY=0.5;endArrow=classic;strokeColor=#9673a6;", "U turn")
    return mxfile([("Edges", m)])


def drawio_styles():
    m = Model()
    m.vertex("Solid fill", "rounded=0;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;", 20, 20, 120, 60)
    for i, d in enumerate(["south", "north", "east", "west"]):
        m.vertex(f"Gradient {d}", f"rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;gradientColor=#7ea6e0;gradientDirection={d};strokeColor=#6c8ebf;", 160 + i * 140, 20, 120, 60)
    m.vertex("Dashed 3 px", "rounded=0;whiteSpace=wrap;html=1;dashed=1;strokeWidth=3;fillColor=none;", 20, 110, 120, 60)
    m.vertex("Opacity 40", "rounded=0;whiteSpace=wrap;html=1;fillColor=#60a917;strokeColor=#2D7600;opacity=40;fontColor=#000000;", 160, 110, 120, 60)
    m.vertex("Shadow", "rounded=1;whiteSpace=wrap;html=1;shadow=1;fillColor=#fff2cc;strokeColor=#d6b656;", 300, 110, 120, 60)
    m.vertex("Rotated 30°", "rounded=0;whiteSpace=wrap;html=1;rotation=30;fillColor=#e1d5e7;strokeColor=#9673a6;", 440, 110, 120, 60)
    m.vertex("No stroke", "rounded=0;whiteSpace=wrap;html=1;strokeColor=none;fillColor=#b1ddf0;", 580, 110, 120, 60)
    m.vertex("Bold", "text;html=1;fontStyle=1;fontSize=16;align=center;verticalAlign=middle;", 20, 200, 120, 30)
    m.vertex("Italic", "text;html=1;fontStyle=2;fontSize=16;align=center;verticalAlign=middle;", 160, 200, 120, 30)
    m.vertex("Underline", "text;html=1;fontStyle=4;fontSize=16;align=center;verticalAlign=middle;", 300, 200, 120, 30)
    m.vertex("Courier 14", "text;html=1;fontFamily=Courier New;fontSize=14;align=center;verticalAlign=middle;fontColor=#CC0000;", 440, 200, 120, 30)
    m.vertex("Large 24", "text;html=1;fontSize=24;align=center;verticalAlign=middle;fontColor=#0050ef;", 580, 200, 120, 30)
    for r, va in enumerate(["top", "middle", "bottom"]):
        for c, al in enumerate(["left", "center", "right"]):
            m.vertex(f"{va}-{al}", f"rounded=0;whiteSpace=wrap;html=1;align={al};verticalAlign={va};fillColor=#f5f5f5;strokeColor=#666666;", 20 + c * 110, 260 + r * 70, 100, 60)
    m.vertex("label below", "ellipse;whiteSpace=wrap;html=1;verticalLabelPosition=bottom;verticalAlign=top;fillColor=#ffe6cc;strokeColor=#d79b00;", 380, 270, 50, 50)
    m.vertex("label right", "ellipse;whiteSpace=wrap;html=1;labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;fillColor=#ffe6cc;strokeColor=#d79b00;", 470, 270, 50, 50)
    m.vertex("Vertical text", "rounded=0;whiteSpace=wrap;html=1;horizontal=0;fillColor=#d0cee2;strokeColor=#56517e;", 380, 360, 40, 120)
    m.vertex("<b>HTML</b> label with <i>italic</i>, <font color=\"#d80073\">colour</font>,<br><ul><li>a list</li><li>two items</li></ul><a href=\"https://www.drawio.com\">a link</a>",
             "rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=6;fillColor=#ffffff;", 440, 360, 200, 120)
    m.vertex("A long label that wraps inside its shape because whiteSpace is wrap", "rounded=1;whiteSpace=wrap;html=1;", 660, 360, 120, 80)
    m.vertex("Plain text\nwith newline (html=0)", "rounded=0;fillColor=#f5f5f5;", 660, 260, 140, 60)
    m.vertex("<script>alert(1)</script><img src=x onerror=alert(2)>Sanitised", "rounded=0;whiteSpace=wrap;html=1;", 20, 480, 140, 40)
    return mxfile([("Styles", m)])


def drawio_containers():
    m = Model()
    pool = m.vertex("Pool", "swimlane;html=1;childLayout=stackLayout;resizeParent=1;resizeParentMax=0;horizontal=0;startSize=20;horizontalStack=0;", 20, 20, 520, 280)
    lane1 = m.vertex("Lane 1", "swimlane;html=1;startSize=20;horizontal=0;fillColor=#dae8fc;strokeColor=#6c8ebf;", 20, 0, 500, 140, parent=pool)
    lane2 = m.vertex("Lane 2", "swimlane;html=1;startSize=20;horizontal=0;fillColor=#d5e8d4;strokeColor=#82b366;", 20, 140, 500, 140, parent=pool)
    s1 = m.vertex("Start", "ellipse;whiteSpace=wrap;html=1;", 40, 40, 60, 60, parent=lane1)
    t1 = m.vertex("Task", "rounded=1;whiteSpace=wrap;html=1;", 160, 45, 100, 50, parent=lane1)
    t2 = m.vertex("Review", "rounded=1;whiteSpace=wrap;html=1;", 160, 45, 100, 50, parent=lane2)
    e1 = m.vertex("End", "ellipse;whiteSpace=wrap;html=1;strokeWidth=3;", 360, 40, 60, 60, parent=lane2)
    m.edge(s1, t1, "edgeStyle=orthogonalEdgeStyle;html=1;", parent=lane1)
    m.edge(t1, t2, "edgeStyle=orthogonalEdgeStyle;html=1;", parent="1")
    m.edge(t2, e1, "edgeStyle=orthogonalEdgeStyle;html=1;", parent=lane2)
    cont = m.vertex("Container (rounded swimlane)", "swimlane;whiteSpace=wrap;html=1;rounded=1;fillColor=#f8cecc;strokeColor=#b85450;swimlaneFillColor=#fff5f5;startSize=30;", 580, 20, 240, 180)
    m.vertex("Child", "rounded=0;whiteSpace=wrap;html=1;", 30, 60, 80, 40, parent=cont)
    inner = m.vertex("Nested", "swimlane;whiteSpace=wrap;html=1;startSize=20;", 120, 60, 100, 100, parent=cont)
    m.vertex("Deep", "ellipse;whiteSpace=wrap;html=1;", 20, 35, 60, 50, parent=inner)
    grp = m.vertex("", "group", 580, 240, 240, 80)
    ga = m.vertex("Grouped A", "rounded=0;whiteSpace=wrap;html=1;fillColor=#fff2cc;", 0, 0, 100, 80, parent=grp)
    gb = m.vertex("Grouped B", "rounded=0;whiteSpace=wrap;html=1;fillColor=#fff2cc;", 140, 0, 100, 80, parent=grp)
    m.edge(ga, gb, "edgeStyle=orthogonalEdgeStyle;html=1;", parent=grp)
    notes = m.layer("Notes")
    m.vertex("On the 'Notes' layer", "shape=note;whiteSpace=wrap;html=1;size=12;fillColor=#fff2cc;strokeColor=#d6b656;", 40, 330, 160, 60, parent=notes)
    hidden = m.layer("Hidden", visible=False)
    m.vertex("Must NOT be drawn", "rounded=0;whiteSpace=wrap;html=1;fillColor=#ff0000;", 260, 330, 160, 60, parent=hidden)
    m.vertex("Invisible cell", "rounded=0;whiteSpace=wrap;html=1;fillColor=#ff0000;", 460, 330, 100, 60)
    m.cells[-1] = m.cells[-1].replace('vertex="1"', 'vertex="1" visible="0"')
    return mxfile([("Containers", m)])


def drawio_pages():
    p1 = Model()
    a = p1.vertex("Go to page 2", "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;", 40, 40, 140, 50, wrap={"link": "data:page/id,p2", "tooltip": "Jumps to the second page"})
    b = p1.vertex("Website", "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;", 260, 40, 140, 50, wrap={"link": "https://www.drawio.com/"})
    p1.edge(a, b, "edgeStyle=orthogonalEdgeStyle;html=1;")
    p1.vertex("Placeholder: %owner%", "rounded=0;whiteSpace=wrap;html=1;", 40, 140, 200, 40, wrap={"placeholders": "1", "owner": "Diagram team"})
    p1.cells[-1] = p1.cells[-1].replace('style="rounded=0;whiteSpace=wrap;html=1;"', 'style="rounded=0;whiteSpace=wrap;html=1;placeholders=1;"')
    p2 = Model(background="#FFF8E1")
    c = p2.vertex("Page 2", "ellipse;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;", 60, 40, 140, 80)
    d = p2.vertex("Back to page 1", "rounded=1;whiteSpace=wrap;html=1;", 280, 55, 140, 50, wrap={"link": "data:page/id,p1"})
    p2.edge(c, d, "html=1;endArrow=classic;")
    p3 = Model()
    p3.vertex("한글 레이블 · 第三页 · Ünïcödé", "rounded=1;whiteSpace=wrap;html=1;fontSize=16;", 40, 40, 260, 60)
    return mxfile([("Links", p1), ("Second", p2), ("Unicode", p3)], compressed=True)


def drawio_flowchart():
    m = Model()
    S = "whiteSpace=wrap;html=1;"
    start = m.vertex("Start", "ellipse;" + S + "fillColor=#d5e8d4;strokeColor=#82b366;", 160, 20, 120, 50)
    inp = m.vertex("Read order", "shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;" + S + "fillColor=#dae8fc;strokeColor=#6c8ebf;", 150, 110, 140, 50)
    dec = m.vertex("In stock?", "rhombus;" + S + "fillColor=#fff2cc;strokeColor=#d6b656;", 160, 200, 120, 80)
    ship = m.vertex("Ship", "rounded=1;" + S + "fillColor=#dae8fc;strokeColor=#6c8ebf;", 160, 330, 120, 50)
    back = m.vertex("Back-order", "shape=process;" + S + "backgroundOutline=1;fillColor=#f8cecc;strokeColor=#b85450;", 360, 215, 120, 50)
    db = m.vertex("Orders DB", "shape=cylinder3;" + S + "boundedLbl=1;size=10;fillColor=#e1d5e7;strokeColor=#9673a6;", 380, 320, 80, 70)
    doc = m.vertex("Invoice", "shape=document;" + S + "boundedLbl=1;", 160, 420, 120, 60)
    end = m.vertex("End", "ellipse;" + S + "fillColor=#f5f5f5;strokeColor=#666666;", 160, 520, 120, 50)
    O = "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;"
    m.edge(start, inp, O)
    m.edge(inp, dec, O)
    m.edge(dec, ship, O, "yes")
    m.edge(dec, back, O, "no")
    m.edge(back, db, O + "dashed=1;")
    m.edge(ship, doc, O)
    m.edge(doc, end, O)
    m.edge(db, ship, O + "exitX=0;exitY=0.5;entryX=1;entryY=0.5;", "")
    p2 = Model()
    p2.vertex("Notes page", "shape=note;whiteSpace=wrap;html=1;size=15;fillColor=#fff2cc;strokeColor=#d6b656;", 20, 20, 200, 100)
    return mxfile([("Flowchart", m), ("Notes", p2)], compressed=True)


def write(path, text):
    path.write_text(text, encoding="utf-8", newline="\n")
    print(path.relative_to(ROOT), len(text.encode("utf-8")))


def main_drawio():
    write(OUT / "shapes.drawio", drawio_shapes())
    write(OUT / "edges.drawio", drawio_edges())
    write(OUT / "styles.drawio", drawio_styles())
    write(OUT / "containers.drawio", drawio_containers())
    write(OUT / "pages-compressed.drawio", drawio_pages())
    write(ROOT / "samples" / "sample.drawio", drawio_flowchart())
    # .dio: the same format, a bare uncompressed mxGraphModel
    m = Model()
    a = m.vertex("Hello", "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;", 20, 20, 120, 60)
    b = m.vertex("World", "ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;", 220, 20, 120, 60)
    m.edge(a, b, "edgeStyle=orthogonalEdgeStyle;html=1;", "says")
    write(ROOT / "samples" / "sample.dio", m.xml())
    write(ROOT / "samples" / "broken.drawio", '<mxfile><diagram id="x" name="Broken">!!!not-base64-deflate!!!</diagram></mxfile>')


# ------------------------------------------------------------------------------- Visio

import math
import zipfile

VNS = "http://schemas.microsoft.com/office/visio/2012/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_VISIO = "http://schemas.microsoft.com/visio/2010/relationships"
REL_OD = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PT = 1 / 72


def emf_picture():
    """A tiny EMF: a filled rectangle and an ellipse (EMR_HEADER, pens, brushes, shapes, EOF)."""
    recs = []

    def rec(t, payload):
        recs.append(struct.pack("<II", t, 8 + len(payload)) + payload)

    rec(39, struct.pack("<IIII", 1, 0, 0x00C47244, 0))  # CREATEBRUSHINDIRECT #4472c4
    rec(37, struct.pack("<I", 1))  # SELECTOBJECT
    rec(38, struct.pack("<IIiiI", 2, 0, 3, 0, 0x00203040))  # CREATEPEN 3px
    rec(37, struct.pack("<I", 2))
    rec(43, struct.pack("<iiii", 10, 10, 190, 90))  # RECTANGLE
    rec(39, struct.pack("<IIII", 3, 0, 0x0031C0FF, 0))  # brush #ffc031
    rec(37, struct.pack("<I", 3))
    rec(42, struct.pack("<iiii", 60, 25, 140, 75))  # ELLIPSE
    rec(14, struct.pack("<III", 0, 16, 20))  # EOF
    body = b"".join(recs)
    n_records = len(recs) + 1
    size = 108 + len(body)
    header = struct.pack(
        "<II4i4iIIIIHHIIIiiii",
        1, 108, 0, 0, 199, 99, 0, 0, 5292, 2646, 0x464D4520, 0x10000, size, n_records, 4, 0, 0, 0, 0, 1920, 1080, 508, 286,
    )
    header += struct.pack("<IIIii", 0, 0, 0, 508000, 285750)
    assert len(header) == 108, len(header)
    return header + body


def c(n, v, u=None, f=None):
    a = f' U="{u}"' if u else ""
    fa = f" F={quoteattr(f)}" if f is not None else ""
    va = f" V={quoteattr(str(v))}" if v is not None else ""
    return f"<Cell N=\"{n}\"{va}{a}{fa}/>"


def row(t, ix, **cells):
    inner = "".join(c(k, *(v if isinstance(v, tuple) else (v,))) for k, v in cells.items())
    return f'<Row T="{t}" IX="{ix}">{inner}</Row>'


def geometry(ix, rows, no_fill=0, no_line=0):
    return f'<Section N="Geometry" IX="{ix}">{c("NoFill", no_fill)}{c("NoLine", no_line)}{c("NoShow", 0)}{c("NoSnap", 0)}' + "".join(rows) + "</Section>"


def rect_rows(w, h):
    return [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=w, Y=0), row("LineTo", 3, X=w, Y=h), row("LineTo", 4, X=0, Y=h), row("LineTo", 5, X=0, Y=0)]


def ellipse_rows(w, h):
    return [row("Ellipse", 1, X=w / 2, Y=h / 2, A=w, B=h / 2, C=w / 2, D=h)]


def xform(px, py, w, h, angle=0, locx=None, locy=None, flipx=0, flipy=0):
    return (
        c("PinX", px) + c("PinY", py) + c("Width", w) + c("Height", h) + c("LocPinX", w / 2 if locx is None else locx)
        + c("LocPinY", h / 2 if locy is None else locy) + c("Angle", angle) + c("FlipX", flipx) + c("FlipY", flipy)
    )


class VShape:
    _id = 0

    def __init__(self, px=0, py=0, w=1, h=1, cells="", sections="", text=None, master=None, master_shape=None,
                 styles=("3", "3", "3"), children=(), typ="Shape", foreign=None, angle=0, flip=(0, 0), sid=None, name=None):
        VShape._id += 1
        self.id = sid or VShape._id
        self.px, self.py, self.w, self.h = px, py, w, h
        self.cells, self.sections, self.text = cells, sections, text
        self.master, self.master_shape, self.styles = master, master_shape, styles
        self.children, self.typ, self.foreign, self.angle, self.flip, self.name = list(children), typ, foreign, angle, flip, name

    def xml(self, with_xform=True):
        a = f'ID="{self.id}" Type="{self.typ}"'
        if self.name:
            a += f" NameU={quoteattr(self.name)} Name={quoteattr(self.name)}"
        if self.master is not None:
            a += f' Master="{self.master}"'
        if self.master_shape is not None:
            a += f' MasterShape="{self.master_shape}"'
        if self.styles:
            a += f' LineStyle="{self.styles[0]}" FillStyle="{self.styles[1]}" TextStyle="{self.styles[2]}"'
        body = (xform(self.px, self.py, self.w, self.h, self.angle, flipx=self.flip[0], flipy=self.flip[1]) if with_xform else "") + self.cells + self.sections
        if self.text is not None:
            body += f"<Text>{self.text}</Text>"
        if self.foreign:
            kind, rid = self.foreign
            body += f'<ForeignData ForeignType="{kind}"{" CompressionType=\"PNG\"" if kind == "Bitmap" else ""}><Rel r:id="{rid}"/></ForeignData>'
        if self.children:
            body += "<Shapes>" + "".join(ch.xml() for ch in self.children) + "</Shapes>"
        return f"<Shape {a}>{body}</Shape>"


def char_row(ix, font="Calibri", color="#000000", style=0, size=12, **more):
    extra = "".join(c(k, v) for k, v in more.items())
    return f'<Row IX="{ix}">{c("Font", font)}{c("Color", color)}{c("Style", style)}{c("Size", size * PT, "PT")}{c("Case", 0)}{c("Pos", 0)}{c("Strikethru", 0)}{extra}</Row>'


def para_row(ix, align=1, **more):
    extra = "".join(c(k, v) for k, v in more.items())
    return f'<Row IX="{ix}">{c("IndFirst", 0)}{c("IndLeft", 0)}{c("IndRight", 0)}{c("SpLine", -1.2)}{c("SpBefore", 0)}{c("SpAfter", 0)}{c("HorzAlign", align)}{c("Bullet", 0)}{extra}</Row>'


def section(name, rows):
    return f'<Section N="{name}">' + "".join(rows) + "</Section>"


STYLESHEETS = (
    '<StyleSheets>'
    '<StyleSheet ID="0" NameU="No Style" Name="No Style">'
    + c("EnableLineProps", 1) + c("EnableFillProps", 1) + c("EnableTextProps", 1)
    + c("LineWeight", 0.75 * PT, "PT") + c("LineColor", "#000000") + c("LinePattern", 1) + c("Rounding", 0) + c("EndArrowSize", 2)
    + c("BeginArrow", 0) + c("EndArrow", 0) + c("LineCap", 0) + c("BeginArrowSize", 2) + c("LineColorTrans", 0)
    + c("FillForegnd", "#ffffff") + c("FillBkgnd", "#000000") + c("FillPattern", 1) + c("ShdwForegnd", "#000000") + c("ShdwPattern", 0)
    + c("FillForegndTrans", 0) + c("FillBkgndTrans", 0) + c("ShdwForegndTrans", 0)
    + c("LeftMargin", 0) + c("RightMargin", 0) + c("TopMargin", 0) + c("BottomMargin", 0) + c("VerticalAlign", 1) + c("TextBkgnd", 0)
    + section("Character", [char_row(0)]) + section("Paragraph", [para_row(0, 1)])
    + "</StyleSheet>"
    '<StyleSheet ID="1" NameU="Text Only" Name="Text Only" LineStyle="3" FillStyle="3" TextStyle="3">'
    + c("LinePattern", 0) + c("FillPattern", 0) + "</StyleSheet>"
    '<StyleSheet ID="3" NameU="Normal" Name="Normal" LineStyle="0" FillStyle="0" TextStyle="0">'
    + c("LeftMargin", 4 * PT, "PT") + c("RightMargin", 4 * PT, "PT") + c("TopMargin", 4 * PT, "PT") + c("BottomMargin", 4 * PT, "PT")
    + "</StyleSheet>"
    '<StyleSheet ID="6" NameU="Accent" Name="Accent" LineStyle="3" FillStyle="3" TextStyle="3">'
    + c("FillForegnd", "#ed7d31") + c("LineColor", "#843c0c") + c("LineWeight", 2 * PT, "PT")
    + section("Character", [char_row(0, color="#ffffff", style=1, size=11)]) + "</StyleSheet>"
    '<StyleSheet ID="7" NameU="Accent dashed" Name="Accent dashed" LineStyle="6" FillStyle="6" TextStyle="6">'
    + c("LinePattern", 2) + "</StyleSheet>"
    "</StyleSheets>"
)

THEME = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>'
    '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="5B9BD5"/></a:accent1>'
    '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>'
    '<a:accent5><a:srgbClr val="4472C4"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>'
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
    '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
    "</a:themeElements></a:theme>"
)


class VPage:
    def __init__(self, name, w=11, h=8.5, shapes=(), background=False, back_page=None, connects=(), images=()):
        self.name, self.w, self.h, self.shapes = name, w, h, list(shapes)
        self.background, self.back_page, self.connects, self.images = background, back_page, list(connects), list(images)


class VMaster:
    def __init__(self, mid, name, shapes, w=1, h=1):
        self.id, self.name, self.shapes, self.w, self.h = mid, name, shapes, w, h


MAIN_TYPES = {
    "vsdx": "application/vnd.ms-visio.drawing.main+xml",
    "vsdm": "application/vnd.ms-visio.drawing.macroEnabled.main+xml",
    "vstx": "application/vnd.ms-visio.template.main+xml",
    "vssx": "application/vnd.ms-visio.stencil.main+xml",
}


def vsdx(path, pages, masters=(), colors=(), kind="vsdx"):
    """Writes a Visio package. `pages[*].images` is a list of (rId, filename, bytes)."""
    files = {}
    ct = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
        '<Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/x-emf"/>',
        f'<Override PartName="/visio/document.xml" ContentType="{MAIN_TYPES[kind]}"/>',
        '<Override PartName="/visio/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>',
    ]
    files["_rels/.rels"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_VISIO}/document" Target="visio/document.xml"/></Relationships>'
    doc_rels = [f'<Relationship Id="rId1" Type="{REL_OD}/theme" Target="theme/theme1.xml"/>', f'<Relationship Id="rId2" Type="{REL_VISIO}/windows" Target="windows.xml"/>']
    if pages:
        doc_rels.append(f'<Relationship Id="rId3" Type="{REL_VISIO}/pages" Target="pages/pages.xml"/>')
        ct.append('<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>')
    if masters:
        doc_rels.append(f'<Relationship Id="rId4" Type="{REL_VISIO}/masters" Target="masters/masters.xml"/>')
        ct.append('<Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>')
    files["visio/_rels/document.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(doc_rels) + "</Relationships>"
    color_xml = "<Colors>" + "".join(f'<ColorEntry IX="{24 + i}" RGB="{col}"/>' for i, col in enumerate(colors)) + "</Colors>" if colors else ""
    files["visio/document.xml"] = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><VisioDocument xmlns="{VNS}" xmlns:r="{RNS}" xml:space="preserve">'
        '<DocumentSettings TopPage="0" DefaultTextStyle="3" DefaultLineStyle="3" DefaultFillStyle="3" DefaultGuideStyle="4"><GlueSettings>9</GlueSettings><SnapSettings>295</SnapSettings>'
        '<SnapExtensions>34</SnapExtensions><SnapAngles/><DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>'
        '<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings>'
        + color_xml
        + '<FaceNames><FaceName NameU="Calibri" UnicodeRanges="-536859905 -1073732485 9 0" CharSets="536871423 0" Panose="2 15 5 2 2 2 4 3 2 4" Flags="325"/>'
        '<FaceName NameU="Courier New" UnicodeRanges="-536859905 -1073711037 9 0" CharSets="1073742335 -65536" Panose="2 7 3 9 2 2 5 2 4 4" Flags="261"/>'
        '<FaceName NameU="Georgia" UnicodeRanges="647 0 0 0" CharSets="536870913 0" Panose="2 4 5 2 5 4 5 2 3 3" Flags="325"/></FaceNames>'
        + STYLESHEETS + "</VisioDocument>"
    )
    files["visio/theme/theme1.xml"] = THEME
    files["visio/windows.xml"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Windows ClientWidth="1600" ClientHeight="900" xmlns="{VNS}" xmlns:r="{RNS}"/>'
    if masters:
        mrels, mlist = [], []
        for i, m in enumerate(masters, 1):
            mrels.append(f'<Relationship Id="rId{i}" Type="{REL_VISIO}/master" Target="master{i}.xml"/>')
            mlist.append(
                f'<Master ID="{m.id}" NameU={quoteattr(m.name)} Name={quoteattr(m.name)} Prompt="" IconSize="1" AlignName="2" MatchByName="0" IconUpdate="1" PatternFlags="0">'
                f'<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">{c("PageWidth", m.w)}{c("PageHeight", m.h)}{c("PageScale", 1, "IN_F")}{c("DrawingScale", 1, "IN_F")}</PageSheet>'
                f'<Rel r:id="rId{i}"/></Master>'
            )
            files[f"visio/masters/master{i}.xml"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><MasterContents xmlns="{VNS}" xmlns:r="{RNS}" xml:space="preserve"><Shapes>' + "".join(s.xml() for s in m.shapes) + "</Shapes></MasterContents>"
            ct.append(f'<Override PartName="/visio/masters/master{i}.xml" ContentType="application/vnd.ms-visio.master+xml"/>')
        files["visio/masters/_rels/masters.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(mrels) + "</Relationships>"
        files["visio/masters/masters.xml"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Masters xmlns="{VNS}" xmlns:r="{RNS}" xml:space="preserve">' + "".join(mlist) + "</Masters>"
    if pages:
        prels, plist = [], []
        for i, p in enumerate(pages, 1):
            prels.append(f'<Relationship Id="rId{i}" Type="{REL_VISIO}/page" Target="page{i}.xml"/>')
            attrs = f'ID="{i - 1}" NameU={quoteattr(p.name)} Name={quoteattr(p.name)}'
            if p.background:
                attrs += ' Background="1"'
            if p.back_page is not None:
                attrs += f' BackPage="{p.back_page}"'
            plist.append(
                f'<Page {attrs} ViewScale="1" ViewCenterX="{p.w / 2}" ViewCenterY="{p.h / 2}"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">'
                f'{c("PageWidth", p.w)}{c("PageHeight", p.h)}{c("ShdwOffsetX", 0.125)}{c("ShdwOffsetY", -0.125)}{c("PageScale", 1, "IN_F")}{c("DrawingScale", 1, "IN_F")}'
                f'{c("DrawingSizeType", 0)}{c("DrawingScaleType", 0)}{c("InhibitSnap", 0)}{c("PageLockReplace", 0, "BOOL")}{c("PageLockDuplicate", 0, "BOOL")}'
                f'{c("UIVisibility", 0)}{c("ShdwType", 0)}{c("ShdwObliqueAngle", 0)}{c("ShdwScaleFactor", 1)}{c("DrawingResizeType", 1)}{c("PageShapeSplit", 1)}'
                f'</PageSheet><Rel r:id="rId{i}"/></Page>'
            )
            connects = "".join(f'<Connect FromSheet="{a}" FromCell="{fc}" FromPart="{9 if fc == "BeginX" else 12}" ToSheet="{b}" ToCell="PinX" ToPart="3"/>' for a, fc, b in p.connects)
            files[f"visio/pages/page{i}.xml"] = (
                f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><PageContents xmlns="{VNS}" xmlns:r="{RNS}" xml:space="preserve"><Shapes>'
                + "".join(s.xml() for s in p.shapes) + "</Shapes>" + (f"<Connects>{connects}</Connects>" if connects else "") + "</PageContents>"
            )
            ct.append(f'<Override PartName="/visio/pages/page{i}.xml" ContentType="application/vnd.ms-visio.page+xml"/>')
            rels = [f'<Relationship Id="rIdM{j}" Type="{REL_VISIO}/master" Target="../masters/master{j}.xml"/>' for j in range(1, len(masters) + 1)]
            for rid, name, data in p.images:
                rels.append(f'<Relationship Id="{rid}" Type="{REL_OD}/image" Target="../media/{name}"/>')
                files[f"visio/media/{name}"] = data
            if rels:
                files[f"visio/pages/_rels/page{i}.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(rels) + "</Relationships>"
        files["visio/pages/_rels/pages.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(prels) + "</Relationships>"
        files["visio/pages/pages.xml"] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Pages xmlns="{VNS}" xmlns:r="{RNS}" xml:space="preserve">' + "".join(plist) + "</Pages>"
    ct.append("</Types>")
    files["[Content_Types].xml"] = "".join(ct)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ["[Content_Types].xml"] + [n for n in files if n != "[Content_Types].xml"]:
            data = files[name]
            z.writestr(zipfile.ZipInfo(name, (2026, 11, 26, 0, 0, 0)), data if isinstance(data, bytes) else data.encode("utf-8"), zipfile.ZIP_DEFLATED)
    path.write_bytes(buf.getvalue())
    print(path.relative_to(ROOT), path.stat().st_size)


def box(px, py, w, h, text=None, fill=None, line=None, extra="", styles=("3", "3", "3"), **kw):
    cells = ""
    if fill:
        cells += c("FillForegnd", fill)
    if line:
        cells += c("LineColor", line)
    return VShape(px, py, w, h, cells + extra, geometry(0, rect_rows(w, h)), text=text, styles=styles, **kw)


def label(px, py, text, size=10):
    return VShape(px, py, 2.4, 0.3, "", section("Character", [char_row(0, size=size, color="#404040")]), text=escape(text), styles=("1", "1", "1"))


def visio_geometry():
    s = []
    s.append(box(1.2, 7.4, 1.4, 0.8, "Rectangle"))
    s.append(VShape(3.2, 7.4, 1.4, 0.8, "", geometry(0, ellipse_rows(1.4, 0.8)), text="Ellipse row"))
    w, h, r = 1.4, 0.8, 0.2
    rr = [row("MoveTo", 1, X=r, Y=0), row("LineTo", 2, X=w - r, Y=0), row("ArcTo", 3, X=w, Y=r, A=-r * (1 - math.sqrt(0.5))),
          row("LineTo", 4, X=w, Y=h - r), row("ArcTo", 5, X=w - r, Y=h, A=-r * (1 - math.sqrt(0.5))), row("LineTo", 6, X=r, Y=h),
          row("ArcTo", 7, X=0, Y=h - r, A=-r * (1 - math.sqrt(0.5))), row("LineTo", 8, X=0, Y=r), row("ArcTo", 9, X=r, Y=0, A=-r * (1 - math.sqrt(0.5)))]
    s.append(VShape(5.2, 7.4, w, h, "", geometry(0, rr), text="ArcTo corners"))
    s.append(VShape(7.2, 7.4, 1.4, 0.8, "", geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1.4, Y=0), row("LineTo", 3, X=0.7, Y=0.8), row("LineTo", 4, X=0, Y=0)]), text="Triangle"))
    # PolylineTo: a pentagon in one row (relative x/y)
    pts = [(0.5 + 0.5 * math.sin(2 * math.pi * k / 5), 0.5 + 0.5 * math.cos(2 * math.pi * k / 5)) for k in range(5)]
    poly = ", ".join(f"{x:.4f}, {y:.4f}" for x, y in pts[1:])
    s.append(VShape(9.2, 7.4, 1.0, 1.0, "", geometry(0, [row("MoveTo", 1, X=pts[0][0], Y=pts[0][1]), row("PolylineTo", 2, X=pts[0][0], Y=pts[0][1], A=(None, None, f"POLYLINE(0, 0, {poly})"))]), text="PolylineTo"))
    # EllipticalArcTo: a half ellipse (flat side down) and a rotated arc
    s.append(VShape(1.2, 5.6, 1.4, 0.8, "", geometry(0, [row("MoveTo", 1, X=0, Y=0), row("EllipticalArcTo", 2, X=1.4, Y=0, A=0.7, B=0.8, C=0, D=1.75), row("LineTo", 3, X=0, Y=0)]), text="EllipticalArcTo"))
    s.append(VShape(3.2, 5.6, 1.4, 0.8, c("LineWeight", 2 * PT), geometry(0, [row("MoveTo", 1, X=0, Y=0.4), row("EllipticalArcTo", 2, X=1.4, Y=0.4, A=0.5, B=0.75, C=0.5, D=2)], no_fill=1), text="Rotated arc"))
    # NURBSTo: a cubic S curve (clamped knots)
    s.append(VShape(5.2, 5.6, 1.4, 0.8, c("LineWeight", 2 * PT) + c("LineColor", "#c00000"),
                    geometry(0, [row("MoveTo", 1, X=0, Y=0), row("NURBSTo", 2, X=1.4, Y=0.8, A=0, B=1, C=0, D=1, E=(None, None, "NURBS(1, 3, 0, 0, 0.9, 0, 0, 1, 0.1, 1, 0, 1)"))], no_fill=1), text="NURBSTo"))
    # SplineStart / SplineKnot: a quadratic B-spline through 5 control points
    s.append(VShape(7.2, 5.6, 1.4, 0.8, c("LineWeight", 2 * PT) + c("LineColor", "#2e75b6"),
                    geometry(0, [row("MoveTo", 1, X=0, Y=0), row("SplineStart", 2, X=0.35, Y=0.8, A=0, B=0, C=3, D=2), row("SplineKnot", 3, X=0.7, Y=0, A=1),
                                 row("SplineKnot", 4, X=1.05, Y=0.8, A=2), row("SplineKnot", 5, X=1.4, Y=0, A=3)], no_fill=1), text="Spline"))
    # Rel* rows: a drop shape with cubic and quadratic Béziers
    s.append(VShape(9.2, 5.6, 1.0, 1.0, c("FillForegnd", "#9dc3e6"),
                    geometry(0, [row("RelMoveTo", 1, X=0.5, Y=0), row("RelCubBezTo", 2, X=1, Y=0.6, A=0.95, B=0.05, C=1, D=0.3), row("RelQuadBezTo", 3, X=0.5, Y=1, A=0.8, B=1),
                                 row("RelLineTo", 4, X=0.5, Y=1), row("RelQuadBezTo", 5, X=0, Y=0.6, A=0.2, B=1), row("RelCubBezTo", 6, X=0.5, Y=0, A=0, B=0.3, C=0.05, D=0.05)]), text="Rel* rows"))
    # Two geometry sections: a ring (evenodd), and a section with NoFill
    ring = geometry(0, ellipse_rows(1.0, 1.0)) + geometry(1, [row("Ellipse", 1, X=0.5, Y=0.5, A=0.8, B=0.5, C=0.5, D=0.8)])
    s.append(VShape(1.2, 3.6, 1.0, 1.0, c("FillForegnd", "#ffc000"), ring, text=""))
    s.append(VShape(3.2, 3.6, 1.4, 0.8, c("FillForegnd", "#c5e0b4"), geometry(0, rect_rows(1.4, 0.8)) + geometry(1, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1.4, Y=0.8)], no_fill=1), text="2 sections"))
    # RelEllipticalArcTo (half circle on top of a rectangle: a tombstone)
    s.append(VShape(5.2, 3.6, 1.0, 1.0, c("FillForegnd", "#d9d9d9"),
                    geometry(0, [row("RelMoveTo", 1, X=0, Y=0), row("RelLineTo", 2, X=1, Y=0), row("RelLineTo", 3, X=1, Y=0.5),
                                 row("RelEllipticalArcTo", 4, X=0, Y=0.5, A=0.5, B=1, C=0, D=1), row("RelLineTo", 5, X=0, Y=0)]), text="RelEllipticalArcTo"))
    # InfiniteLine (a guide-like line through two points)
    s.append(VShape(8.2, 3.6, 2.0, 1.0, c("LineColor", "#7f7f7f") + c("LinePattern", 3), geometry(0, [row("InfiniteLine", 1, X=0, Y=0, A=2, B=1)], no_fill=1), text=None))
    s.append(label(8.2, 2.9, "InfiniteLine (dotted)"))
    # rotation, flip
    s.append(VShape(1.2, 1.6, 1.4, 0.6, c("FillForegnd", "#f4b183"), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1.4, Y=0), row("LineTo", 3, X=1.0, Y=0.6), row("LineTo", 4, X=0, Y=0.6), row("LineTo", 5, X=0, Y=0)]), text="Angle 30°", angle=math.radians(30)))
    s.append(VShape(3.4, 1.6, 1.4, 0.6, c("FillForegnd", "#f4b183"), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1.4, Y=0), row("LineTo", 3, X=1.0, Y=0.6), row("LineTo", 4, X=0, Y=0.6), row("LineTo", 5, X=0, Y=0)]), text="FlipX", flip=(1, 0)))
    s.append(VShape(5.6, 1.6, 1.4, 0.6, c("FillForegnd", "#f4b183"), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1.4, Y=0), row("LineTo", 3, X=1.0, Y=0.6), row("LineTo", 4, X=0, Y=0.6), row("LineTo", 5, X=0, Y=0)]), text="FlipY", flip=(0, 1)))
    return [VPage("Geometry", shapes=s)]


def visio_styles():
    s = []
    x0, y = 1.0, 7.6
    fills = [("#ff0000", "red"), ("2", "index 2"), ("#4472c4", "#4472c4"), ("24", "doc colour 24")]
    for i, (col, name) in enumerate(fills):
        s.append(box(x0 + i * 1.6, y, 1.3, 0.6, escape(name), fill=col))
    s.append(box(x0 + 4 * 1.6, y, 1.3, 0.6, "50% transparent", fill="#70ad47", extra=c("FillForegndTrans", 0.5)))
    s.append(box(x0 + 5 * 1.6, y, 1.3, 0.6, "No fill", extra=c("FillPattern", 0)))
    y = 6.5
    for i, pat in enumerate([2, 3, 4, 5, 6, 7]):
        s.append(box(x0 + i * 1.6, y, 1.3, 0.6, f"pattern {pat}", fill="#2e75b6", extra=c("FillBkgnd", "#ffffff") + c("FillPattern", pat)))
    y = 5.4
    for i, pat in enumerate([25, 28, 31, 35, 29, 26]):
        s.append(box(x0 + i * 1.6, y, 1.3, 0.6, f"gradient {pat}", fill="#2e75b6", extra=c("FillBkgnd", "#ffffff") + c("FillPattern", pat)))
    stops = section("FillGradient", [
        f'<Row IX="0">{c("GradientStopColor", "#ffc000")}{c("GradientStopColorTrans", 0)}{c("GradientStopPosition", 0)}</Row>',
        f'<Row IX="1">{c("GradientStopColor", "#ed7d31")}{c("GradientStopColorTrans", 0)}{c("GradientStopPosition", 0.5)}</Row>',
        f'<Row IX="2">{c("GradientStopColor", "#7030a0")}{c("GradientStopColorTrans", 0)}{c("GradientStopPosition", 1)}</Row>',
    ])
    for i, ang in enumerate([0, 90, 45]):
        g = VShape(x0 + i * 1.6, 4.3, 1.3, 0.6, c("FillGradientEnabled", 1) + c("FillGradientDir", 0) + c("FillGradientAngle", math.radians(ang), "DEG"), geometry(0, rect_rows(1.3, 0.6)) + stops, text=f"stops {ang}°")
        s.append(g)
    s.append(box(x0 + 3 * 1.6, 4.3, 1.3, 0.6, "Shadow", fill="#fff2cc", extra=c("ShdwPattern", 1) + c("ShdwForegnd", "#7f7f7f") + c("ShapeShdwOffsetX", 0.06) + c("ShapeShdwOffsetY", -0.06) + c("ShdwForegndTrans", 0.3)))
    s.append(box(x0 + 4 * 1.6, 4.3, 1.3, 0.6, "Style: Accent", styles=("6", "6", "6")))
    s.append(box(x0 + 5 * 1.6, 4.3, 1.3, 0.6, "Style: Accent dashed", styles=("7", "7", "7")))
    # Line patterns and weights
    for i, (pat, wt) in enumerate([(1, 0.75), (2, 1), (3, 1.5), (4, 2), (9, 3), (1, 6)]):
        y = 3.3 - i * 0.28
        s.append(VShape(2.0, y, 2.4, 0.01, c("LinePattern", pat) + c("LineWeight", wt * PT) + c("LineColor", "#203864"), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=2.4, Y=0)], no_fill=1)))
        s.append(label(4.6, y, f"pattern {pat}, {wt} pt", 9))
    # Arrow heads
    for i, (b, e) in enumerate([(0, 1), (0, 4), (0, 5), (2, 13), (10, 20), (22, 11), (0, 29)]):
        y = 3.3 - i * 0.28
        s.append(VShape(7.2, y, 2.0, 0.01, c("BeginArrow", b) + c("EndArrow", e) + c("LineWeight", 1 * PT) + c("EndArrowSize", 2) + c("BeginArrowSize", 2), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=2.0, Y=0)], no_fill=1)))
        s.append(label(9.3, y, f"arrows {b} → {e}", 9))
    return [VPage("Fill & line", shapes=s)]


def visio_text():
    s = []
    rich = (
        section("Character", [char_row(0, size=12), char_row(1, style=1, color="#c00000", size=14), char_row(2, style=2, font="Georgia", size=12),
                              char_row(3, style=4, color="#2e75b6", size=12), char_row(4, font="Courier New", size=10)])
        + section("Paragraph", [para_row(0, 0), para_row(1, 1), para_row(2, 2)])
    )
    s.append(VShape(2.0, 6.6, 3.2, 1.6, c("FillForegnd", "#f2f2f2") + c("VerticalAlign", 0), geometry(0, rect_rows(3.2, 1.6)) + rich,
                    text='<cp IX="0"/><pp IX="0"/>Left aligned, <cp IX="1"/>bold red 14 pt<cp IX="0"/>\n<pp IX="1"/><cp IX="2"/>Centred italic Georgia\n<pp IX="2"/><cp IX="3"/>right, underlined blue\n<cp IX="4"/><pp IX="0"/>Courier 10 pt line'))
    for i, (va, name) in enumerate([(0, "top"), (1, "middle"), (2, "bottom")]):
        s.append(box(5.2 + i * 1.6, 6.6, 1.3, 1.6, f"align {name}", fill="#deebf7", extra=c("VerticalAlign", va)))
    bullets = section("Paragraph", [para_row(0, 0, IndLeft=0.25, IndFirst=-0.15, Bullet=1) .replace("</Row>", c("BulletStr", "•") + "</Row>")])
    s.append(VShape(2.0, 4.4, 3.2, 1.2, c("FillForegnd", "#fff2cc") + c("VerticalAlign", 0), geometry(0, rect_rows(3.2, 1.2)) + bullets, text="First bullet\nSecond bullet with more words that wrap onto the next line\nThird"))
    s.append(VShape(6.0, 4.4, 1.6, 0.8, c("FillForegnd", "#e2f0d9") + c("TxtAngle", math.radians(90)) + c("TxtWidth", 0.8) + c("TxtHeight", 1.6) + c("TxtPinX", 0.8) + c("TxtPinY", 0.4) + c("TxtLocPinX", 0.4) + c("TxtLocPinY", 0.8),
                    geometry(0, rect_rows(1.6, 0.8)), text="TxtAngle 90°"))
    s.append(VShape(8.2, 4.4, 1.6, 0.8, c("FillForegnd", "#fbe5d6") + c("TxtWidth", 2.0) + c("TxtHeight", 0.3) + c("TxtPinX", 0.8) + c("TxtPinY", -0.25) + c("TxtLocPinX", 1.0) + c("TxtLocPinY", 0.15),
                    geometry(0, rect_rows(1.6, 0.8)), text="Text block below"))
    s.append(VShape(2.0, 2.4, 3.2, 0.8, c("FillForegnd", "#ffffff") + c("TextBkgnd", 6), geometry(0, rect_rows(3.2, 0.8)), text='Field: <fld IX="0">Page-1</fld> · 한글 텍스트 · Ünïcödé'))
    s.append(VShape(6.4, 2.4, 2.4, 0.8, c("FillForegnd", "#ffffff") + c("LeftMargin", 0.3) + c("RightMargin", 0.3), geometry(0, rect_rows(2.4, 0.8)) + section("Character", [char_row(0, size=9)]),
                    text="Wide 0.3 in margins make this long text wrap inside a narrow column"))
    s.append(VShape(9.4, 2.4, 1.4, 0.8, c("FillForegnd", "#ffffff") + c("HideText", 1), geometry(0, rect_rows(1.4, 0.8)), text="HIDDEN TEXT"))
    return [VPage("Text", shapes=s)]


def visio_masters():
    VShape._id = 100
    # Master 1: a rounded process box with text and its own fill.
    m1shape = VShape(0.75, 0.375, 1.5, 0.75, c("FillForegnd", "#5b9bd5", f="THEMEVAL(\"FillColor\",0)") + c("LineColor", "#41719c") + c("Rounding", 0.1) + c("QuickStyleFillColor", 2),
                     geometry(0, rect_rows(1.5, 0.75)) + section("Character", [char_row(0, color="#ffffff", size=11)]), text="Process", sid=5, name="Process")
    m1 = VMaster(2, "Process", [m1shape], 1.5, 0.75)
    # Master 2: a group master (box + badge circle) whose instance overrides the badge colour.
    g_box = VShape(0.75, 0.5, 1.5, 1.0, c("FillForegnd", "#e2f0d9"), geometry(0, rect_rows(1.5, 1.0)), text="Group master", sid=6)
    g_dot = VShape(1.35, 0.85, 0.3, 0.3, c("FillForegnd", "#70ad47"), geometry(0, ellipse_rows(0.3, 0.3)), text="", sid=7)
    m2grp = VShape(0.75, 0.5, 1.5, 1.0, "", "", typ="Group", children=[g_box, g_dot], sid=8, styles=("3", "3", "3"), name="Badge")
    m2 = VMaster(3, "Badge", [m2grp], 1.5, 1.0)
    # Master 3: dynamic connector style (end arrow, 1 pt grey line).
    m3shape = VShape(0.5, 0, 1, 0, c("EndArrow", 4) + c("LineColor", "#404040") + c("LineWeight", 1 * PT) + c("FillPattern", 0), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1, Y=0)], no_fill=1), text=None, sid=9, name="Dynamic connector")
    m3 = VMaster(4, "Dynamic connector", [m3shape], 1, 0.1)
    VShape._id = 0
    s = []
    a = VShape(1.6, 6.8, 1.5, 0.75, "", "", master=2, styles=None)  # inherits everything
    b = VShape(4.6, 6.8, 1.5, 0.75, c("FillForegnd", "#c00000"), "", master=2, styles=None, text="Overridden fill")
    cc = VShape(7.6, 6.8, 2.0, 1.0, "", geometry(0, [row("LineTo", 3, X=2.0, Y=0.5)]), master=2, styles=None, text="Resized, row 3 moved")
    s += [a, b, cc]
    grp1 = VShape(2.0, 4.6, 1.5, 1.0, "", "", master=3, styles=None, typ="Group")  # sub-shapes from the master
    grp2 = VShape(5.0, 4.6, 1.5, 1.0, "", "", master=3, styles=None, typ="Group",
                  children=[VShape(0.75, 0.5, 1.5, 1.0, "", "", master_shape=6, styles=None, text="Instance text"),
                            VShape(1.35, 0.85, 0.3, 0.3, c("FillForegnd", "#ff0000"), "", master_shape=7, styles=None)])
    s += [grp1, grp2]
    themed = VShape(8.0, 4.6, 1.5, 0.75, c("FillForegnd", "#ffc000", f="THEMEVAL(\"AccentColor4\")"), geometry(0, rect_rows(1.5, 0.75)), text="Theme accent 4 (V)")
    s.append(themed)
    styled = box(2.0, 2.6, 1.6, 0.8, "Style sheet\n(Accent)", styles=("6", "6", "6"))
    styled2 = box(5.0, 2.6, 1.6, 0.8, "Accent + local line", styles=("6", "6", "6"), line="#00b050", extra=c("LineWeight", 4 * PT))
    s += [styled, styled2]
    # connectors from the connector master, with routed geometry stored like Visio does
    con1 = VShape(3.1, 6.8, 1.5 - 0, 0.0001, c("BeginX", 2.35) + c("BeginY", 6.8) + c("EndX", 3.85) + c("EndY", 6.8) + c("ObjType", 2), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1.5, Y=0)], no_fill=1), master=4, styles=None)
    con2 = VShape(3.5, 4.6, 1.5, 0.0001, c("BeginX", 2.75) + c("BeginY", 4.6) + c("EndX", 4.25) + c("EndY", 4.6) + c("ObjType", 2), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1.5, Y=0)], no_fill=1), master=4, styles=None)
    s += [con1, con2]
    page = VPage("Masters & styles", shapes=s, connects=[(con1.id, "BeginX", a.id), (con1.id, "EndX", b.id)])
    return [page], [m1, m2, m3]


def visio_groups_images():
    s = []
    inner = [box(0.5, 0.4, 0.8, 0.5, "A", fill="#9dc3e6"), box(1.5, 0.4, 0.8, 0.5, "B", fill="#f4b183"),
             VShape(1.0, 0.95, 1.8, 0.3, "", geometry(0, [row("MoveTo", 1, X=0, Y=0.15), row("LineTo", 2, X=1.8, Y=0.15)], no_fill=1) + c("LinePattern", 2), text="group text")]
    for ch in inner:
        ch.cells += c("LinePattern", 1) if "LinePattern" not in ch.cells else ""
    g1 = VShape(2.0, 6.5, 2.0, 1.2, "", "", typ="Group", children=inner, text=None)
    s.append(g1)
    inner2 = [box(0.5, 0.4, 0.8, 0.5, "C", fill="#a9d18e"), box(1.5, 0.4, 0.8, 0.5, "D", fill="#ffd966")]
    nested = VShape(1.0, 1.0, 2.0, 0.6, "", "", typ="Group", children=[box(0.5, 0.3, 0.8, 0.4, "E", fill="#d5a6bd"), box(1.5, 0.3, 0.8, 0.4, "F", fill="#b4c7e7")])
    g2 = VShape(5.6, 6.5, 2.0, 1.4, "", "", typ="Group", children=inner2 + [nested], angle=math.radians(20))
    s.append(g2)
    s.append(label(5.6, 5.4, "nested group rotated 20°"))
    # connector between two boxes (elbow), stored geometry
    p = box(1.4, 3.8, 1.2, 0.6, "Source", fill="#deebf7")
    q = box(4.4, 2.6, 1.2, 0.6, "Target", fill="#deebf7")
    s += [p, q]
    con = VShape(2.0, 3.8, 1.8, 1.2, c("LocPinX", 0) + c("LocPinY", 0) + c("EndArrow", 4) + c("LineWeight", 1 * PT) + c("BeginX", 2.0) + c("BeginY", 3.8) + c("EndX", 3.8) + c("EndY", 2.6),
                 geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=0.9, Y=0), row("LineTo", 3, X=0.9, Y=-1.2), row("LineTo", 4, X=1.8, Y=-1.2)], no_fill=1))
    s.append(con)
    # pictures: PNG and EMF, the EMF stretched and offset inside its frame
    pic = VShape(7.6, 3.6, 1.5, 1.0, c("ImgOffsetX", 0) + c("ImgOffsetY", 0) + c("ImgWidth", 1.5) + c("ImgHeight", 1.0), "", typ="Foreign", foreign=("Bitmap", "rIdImg1"))
    emf = VShape(9.6, 3.6, 1.6, 0.8, c("ImgOffsetX", 0) + c("ImgOffsetY", 0) + c("ImgWidth", 1.6) + c("ImgHeight", 0.8), "", typ="Foreign", foreign=("EnhMetaFile", "rIdImg2"))
    s += [pic, emf, label(7.6, 2.8, "PNG picture"), label(9.6, 2.8, "EMF picture")]
    return [VPage("Groups & pictures", shapes=s, images=[("rIdImg1", "image1.png", PICTURE), ("rIdImg2", "image2.emf", emf_picture())])]


def visio_pages():
    VShape._id = 0
    bg = VPage("Background", 11, 8.5, background=True, shapes=[
        VShape(5.5, 0.4, 10.6, 0.5, c("FillForegnd", "#1f4e79") + c("LinePattern", 0), geometry(0, rect_rows(10.6, 0.5)) + section("Character", [char_row(0, color="#ffffff", size=10)]), text="Background page footer"),
    ])
    link_ext = '<Section N="Hyperlink"><Row N="Row_1">' + c("Description", "Example") + c("Address", "https://example.com/") + c("SubAddress", "") + c("NewWindow", 0) + "</Row></Section>"
    link_page = '<Section N="Hyperlink"><Row N="Row_1">' + c("Description", "Go to Details") + c("Address", "") + c("SubAddress", "Details") + c("NewWindow", 0) + "</Row></Section>"
    p1 = VPage("Overview", 11, 8.5, back_page=0, shapes=[
        box(3.0, 5.0, 2.4, 1.0, "External link", fill="#deebf7", extra=link_ext),
        box(7.0, 5.0, 2.4, 1.0, "Page link → Details", fill="#e2f0d9", extra=link_page),
    ])
    p2 = VPage("Details", 8.5, 11, back_page=0, shapes=[box(4.25, 7.0, 3.0, 1.2, "Portrait page (8.5 × 11 in)", fill="#fff2cc")])
    return [bg, p1, p2]


def visio_flowchart():
    VShape._id = 100
    proc = VMaster(2, "Process", [VShape(0.75, 0.375, 1.5, 0.75, c("FillForegnd", "#5b9bd5") + c("LineColor", "#41719c"), geometry(0, rect_rows(1.5, 0.75)) + section("Character", [char_row(0, color="#ffffff", size=11)]), sid=5)], 1.5, 0.75)
    dec_rows = [row("MoveTo", 1, X=0.75, Y=0), row("LineTo", 2, X=1.5, Y=0.5), row("LineTo", 3, X=0.75, Y=1.0), row("LineTo", 4, X=0, Y=0.5), row("LineTo", 5, X=0.75, Y=0)]
    dec = VMaster(3, "Decision", [VShape(0.75, 0.5, 1.5, 1.0, c("FillForegnd", "#ffc000") + c("LineColor", "#bf9000"), geometry(0, dec_rows) + section("Character", [char_row(0, size=11)]), sid=5)], 1.5, 1.0)
    w, h = 1.5, 0.6
    term_rows = [row("MoveTo", 1, X=0.3, Y=0), row("LineTo", 2, X=1.2, Y=0), row("EllipticalArcTo", 3, X=1.2, Y=0.6, A=1.5, B=0.3, C=0, D=1), row("LineTo", 4, X=0.3, Y=0.6),
                 row("EllipticalArcTo", 5, X=0.3, Y=0, A=0, B=0.3, C=0, D=1)]
    term = VMaster(4, "Start/End", [VShape(0.75, 0.3, w, h, c("FillForegnd", "#a9d18e") + c("LineColor", "#548235"), geometry(0, term_rows) + section("Character", [char_row(0, size=11)]), sid=5)], w, h)
    conn = VMaster(5, "Dynamic connector", [VShape(0.5, 0, 1, 0, c("EndArrow", 4) + c("LineColor", "#404040") + c("LineWeight", 1 * PT), geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=1, Y=0)], no_fill=1), sid=5)], 1, 0.1)
    VShape._id = 0
    S = lambda x, y, m, t: VShape(x, y, *( (1.5, 0.75) if m == 2 else (1.5, 1.0) if m == 3 else (1.5, 0.6)), "", "", master=m, styles=None, text=t)  # noqa: E731
    start = S(3.0, 9.8, 4, "Start")
    read = S(3.0, 8.6, 2, "Read order")
    check = S(3.0, 7.2, 3, "In stock?")
    ship = S(3.0, 5.6, 2, "Ship")
    back = S(5.8, 7.2, 2, "Back-order")
    end = S(3.0, 4.2, 4, "End")
    shapes = [start, read, check, ship, back, end]

    def vline(x, y1, y2):
        return VShape(x, (y1 + y2) / 2, 0.0001, abs(y1 - y2), "", geometry(0, [row("MoveTo", 1, X=0, Y=abs(y1 - y2) if y1 > y2 else 0), row("LineTo", 2, X=0, Y=0 if y1 > y2 else abs(y1 - y2))], no_fill=1), master=5, styles=None)

    def hline(x1, x2, y, text=None):
        return VShape((x1 + x2) / 2, y, abs(x2 - x1), 0.0001, "", geometry(0, [row("MoveTo", 1, X=0, Y=0), row("LineTo", 2, X=abs(x2 - x1), Y=0)], no_fill=1), master=5, styles=None, text=text)

    shapes += [vline(3.0, 9.5, 8.975), vline(3.0, 8.225, 7.7), vline(3.0, 6.7, 5.975), vline(3.0, 5.225, 4.5), hline(3.75, 5.05, 7.2, "no")]
    yes = label(3.3, 6.35, "yes")
    shapes.append(yes)
    p1 = VPage("Flowchart", 6.5, 10.5, shapes=shapes)
    p2 = VPage("Notes", 6.5, 4, shapes=[box(3.25, 2.0, 4.0, 1.5, "A second page with notes.\nPages are listed in the page picker.", fill="#f2f2f2", extra=c("VerticalAlign", 1))])
    return [p1, p2], [proc, dec, term, conn]


def main_visio():
    VShape._id = 0
    vsdx(OUT / "geometry.vsdx", visio_geometry())
    VShape._id = 0
    vsdx(OUT / "fill-line.vsdx", visio_styles(), colors=["#7030a0"])
    VShape._id = 0
    vsdx(OUT / "text.vsdx", visio_text())
    pages, masters = visio_masters()
    vsdx(OUT / "masters.vsdx", pages, masters)
    VShape._id = 0
    vsdx(OUT / "groups-pictures.vsdx", visio_groups_images())
    vsdx(OUT / "pages.vsdx", visio_pages())
    pages, masters = visio_flowchart()
    vsdx(ROOT / "samples" / "sample.vsdx", pages, masters)
    vsdx(ROOT / "samples" / "sample.vstx", pages[:1], masters, kind="vstx")
    vsdx(ROOT / "samples" / "sample.vssx", [], masters, kind="vssx")
    # broken: a zip that is not a Visio package, and truncated bytes
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "not a Visio package")
    (ROOT / "samples" / "broken.vsdx").write_bytes(buf.getvalue())
    print("samples/broken.vsdx")


if __name__ == "__main__":
    main_drawio()
    main_visio()
