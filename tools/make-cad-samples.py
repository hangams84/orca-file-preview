"""Writes the CAD (B-rep) fixtures for the 3D preview with OpenCascade itself (OCP, the Python
binding of OCCT, LGPL-2.1 with exception; used only here, at fixture-generation time). The models
are made from scratch by this script, so the files carry this repository's licence (MIT).

    uv venv -p 3.12 .orca/occvenv && VIRTUAL_ENV=.orca/occvenv uv pip install cadquery-ocp
    .orca/occvenv/Scripts/python tools/make-cad-samples.py [--perf]

Outputs (samples/):
    sample.step           AP214 assembly: plate, 4 bolts, bracket; named parts, colours (XCAF)
    sample-ap203.stp      AP203 single part (filleted block with holes), no colours
    sample-ap242.step     AP242 part with face colours
    sample.igs            IGES 5.3 part with colours
    sample.brep           OCCT native B-rep (text) of a revolved part
    broken.step           a STEP file cut off in the middle of its DATA section
    perf/large-assembly.step (--perf, git-ignored): a 12 x 12 grid of distinct filleted parts
"""
import math
import os
import sys

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
from OCP.BRepTools import BRepTools
from OCP.IFSelect import IFSelect_RetDone
from OCP.IGESCAFControl import IGESCAFControl_Writer
from OCP.IGESControl import IGESControl_Controller
from OCP.Interface import Interface_Static
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_DocumentTool
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'samples')


def rgb(r, g, b):
    return Quantity_Color(r / 255, g / 255, b / 255, Quantity_TOC_RGB)


def moved(shape, x=0.0, y=0.0, z=0.0, rot_z=0.0):
    t = gp_Trsf()
    if rot_z:
        t.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), rot_z)
    t2 = gp_Trsf()
    t2.SetTranslation(gp_Vec(x, y, z))
    t2.Multiply(t)
    return BRepBuilderAPI_Transform(shape, t2, True).Shape()


def fillet_edges(shape, radius, pick=lambda e: True):
    mk = BRepFilletAPI_MakeFillet(shape)
    ex = TopExp_Explorer(shape, TopAbs_EDGE)
    n = 0
    while ex.More():
        e = (TopoDS.Edge if hasattr(TopoDS, "Edge") else TopoDS.Edge_s)(ex.Current())
        if pick(e):
            mk.Add(radius, e)
            n += 1
        ex.Next()
    return mk.Shape() if n else shape


def cut(a, b):
    return BRepAlgoAPI_Cut(a, b).Shape()


def fuse(a, b):
    return BRepAlgoAPI_Fuse(a, b).Shape()


def cylinder(r, h, x=0.0, y=0.0, z=0.0):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1)), r, h).Shape()


def plate(w=120.0, d=80.0, t=10.0, hole=6.5, seed=0):
    """A filleted plate with four corner holes and a centre pocket (mm)."""
    s = BRepPrimAPI_MakeBox(gp_Pnt(-w / 2, -d / 2, 0), w, d, t).Shape()
    s = fillet_edges(s, min(4.0 + (seed % 3), t * 0.45))
    for sx in (-1, 1):
        for sy in (-1, 1):
            s = cut(s, cylinder(hole / 2, t * 3, sx * (w / 2 - 12), sy * (d / 2 - 12), -t))
    s = cut(s, BRepPrimAPI_MakeBox(gp_Pnt(-w / 6, -d / 6, t * 0.4), w / 3, d / 3, t).Shape())
    return s


def hexagon_prism(across_flats, h, z=0.0):
    r = across_flats / math.sqrt(3)
    poly = BRepBuilderAPI_MakePolygon()
    for i in range(6):
        a = math.pi / 6 + i * math.pi / 3
        poly.Add(gp_Pnt(r * math.cos(a), r * math.sin(a), z))
    poly.Close()
    face = BRepBuilderAPI_MakeFace(poly.Wire()).Face()
    return BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, h)).Shape()


def bolt(length=30.0, d=6.0):
    head = hexagon_prism(10.0, 4.0, 0.0)
    shank = cylinder(d / 2, length, 0, 0, -length)
    return fuse(head, shank)


def bracket():
    """An L-bracket with a stiffening rib, filleted inner edge."""
    base = BRepPrimAPI_MakeBox(gp_Pnt(-20, -15, 0), 40, 30, 6).Shape()
    wall = BRepPrimAPI_MakeBox(gp_Pnt(-20, -15, 0), 40, 6, 40).Shape()
    s = fuse(base, wall)
    s = cut(s, cylinder(4, 20, 0, 5, -5))
    return s


def turned_part():
    """A revolved shaft with collars (for the BREP sample)."""
    pts = [(0, 0), (12, 0), (12, 8), (8, 10), (8, 40), (14, 42), (14, 50), (6, 52), (6, 80), (0, 80)]
    poly = BRepBuilderAPI_MakePolygon()
    for r, z in pts:
        poly.Add(gp_Pnt(r, 0, z))
    poly.Close()
    face = BRepBuilderAPI_MakeFace(poly.Wire()).Face()
    return BRepPrimAPI_MakeRevol(face, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2 * math.pi).Shape()


def new_doc():
    doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf'))
    shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    colors = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    return doc, shapes, colors


def name(label, text):
    TDataStd_Name.Set_s(label, TCollection_ExtendedString(text))


def write_step_doc(doc, path, schema='AP214CD'):
    Interface_Static.SetCVal_s('write.step.schema', schema)
    Interface_Static.SetCVal_s('write.step.unit', 'MM')
    w = STEPCAFControl_Writer()
    w.SetColorMode(True)
    w.SetNameMode(True)
    w.Transfer(doc, STEPControl_AsIs)
    assert w.Write(path) == IFSelect_RetDone, path


def assembly_doc(parts):
    """parts: list of (name, shape, colour) placed as components of one assembly."""
    from OCP.TopLoc import TopLoc_Location
    doc, shapes, colors = new_doc()
    asm = shapes.NewShape()
    name(asm, 'demo-assembly')
    protos = {}
    for pname, shape, col, trsf in parts:
        key = pname.split('#')[0]
        if key not in protos:
            lab = shapes.AddShape(shape, False)
            name(lab, key)
            if col is not None:
                colors.SetColor(lab, col, XCAFDoc_ColorGen)
            protos[key] = lab
        comp = shapes.AddComponent(asm, protos[key], TopLoc_Location(trsf))
        name(comp, pname)
    shapes.UpdateAssemblies()
    return doc


def trsf_at(x, y, z, rot_z=0.0):
    t = gp_Trsf()
    t.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), rot_z)
    t2 = gp_Trsf()
    t2.SetTranslation(gp_Vec(x, y, z))
    t2.Multiply(t)
    return t2


def report(path):
    print(f'{os.path.relpath(path, ROOT):34s} {os.path.getsize(path) / 1024:9.1f} KB')


def main():
    os.makedirs(OUT, exist_ok=True)
    if '--perf' in sys.argv:
        os.makedirs(os.path.join(OUT, 'perf'), exist_ok=True)
        parts = []
        palette = [rgb(70, 130, 180), rgb(205, 92, 92), rgb(60, 179, 113), rgb(218, 165, 32), rgb(147, 112, 219)]
        n = 12
        for i in range(n):
            for j in range(n):
                # every part is a distinct shape (different fillet radius / size), so nothing is instanced
                s = plate(60 + (i * n + j) % 7, 40 + (i + j) % 5, 8, 5.0, seed=i * n + j)
                if (i + j) % 4 == 0:
                    try:
                        s = fillet_edges(s, 0.6)
                    except Exception:
                        pass  # some edge combinations cannot take the extra fillet: keep the part as it is
                parts.append((f'plate-{i}-{j}', s, palette[(i + j) % len(palette)], trsf_at(i * 80.0, j * 60.0, 0)))
        doc = assembly_doc(parts)
        path = os.path.join(OUT, 'perf', 'large-assembly.step')
        write_step_doc(doc, path)
        report(path)
        return

    # 1. AP214 assembly with names and colours
    steel = rgb(176, 184, 196)
    parts = [('plate', plate(), rgb(52, 120, 200), trsf_at(0, 0, 0))]
    for k, (x, y) in enumerate([(-48, -28), (48, -28), (-48, 28), (48, 28)]):
        parts.append((f'bolt#{k + 1}', bolt(), steel, trsf_at(x, y, 10)))
    parts.append(('bracket', bracket(), rgb(230, 126, 34), trsf_at(0, 0, 10)))
    write_step_doc(assembly_doc(parts), os.path.join(OUT, 'sample.step'))
    report(os.path.join(OUT, 'sample.step'))

    # 2. AP203 single part, no colours
    Interface_Static.SetCVal_s('write.step.schema', 'AP203')
    w = STEPControl_Writer()
    w.Transfer(plate(90, 60, 14, 8.0, seed=1), STEPControl_AsIs)
    assert w.Write(os.path.join(OUT, 'sample-ap203.stp')) == IFSelect_RetDone
    report(os.path.join(OUT, 'sample-ap203.stp'))

    # 3. AP242 part with per-face colours (top faces red, the rest grey)
    doc, shapes, colors = new_doc()
    shape = bracket()
    lab = shapes.AddShape(shape, False)
    name(lab, 'bracket-ap242')
    colors.SetColor(lab, rgb(150, 150, 160), XCAFDoc_ColorGen)
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    k = 0
    while ex.More():
        if k % 3 == 0:
            sub = shapes.AddSubShape(lab, ex.Current())
            if not sub.IsNull():
                colors.SetColor(sub, rgb(200, 40, 40), XCAFDoc_ColorSurf)
        k += 1
        ex.Next()
    write_step_doc(doc, os.path.join(OUT, 'sample-ap242.step'), 'AP242DIS')
    report(os.path.join(OUT, 'sample-ap242.step'))

    # 4. IGES with colours
    IGESControl_Controller.Init_s()
    doc, shapes, colors = new_doc()
    lab = shapes.AddShape(fuse(cylinder(20, 10), moved(cylinder(8, 30), z=10)), False)
    name(lab, 'flange')
    colors.SetColor(lab, rgb(46, 160, 120), XCAFDoc_ColorGen)
    Interface_Static.SetCVal_s('write.iges.unit', 'MM')
    Interface_Static.SetIVal_s('write.iges.brep.mode', 1)
    wi = IGESCAFControl_Writer()
    wi.SetColorMode(True)
    wi.SetNameMode(True)
    assert wi.Transfer(doc)
    assert wi.Write(os.path.join(OUT, 'sample.igs'))
    report(os.path.join(OUT, 'sample.igs'))

    # 5. native BREP (text)
    path = os.path.join(OUT, 'sample.brep')
    assert BRepTools.Write_s(turned_part(), path)
    report(path)

    # 6. damaged STEP: cut in the middle of the DATA section
    with open(os.path.join(OUT, 'sample-ap203.stp'), 'rb') as f:
        data = f.read()
    with open(os.path.join(OUT, 'broken.step'), 'wb') as f:
        f.write(data[: len(data) // 3])
    report(os.path.join(OUT, 'broken.step'))


main()
