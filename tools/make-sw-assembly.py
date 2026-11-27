"""Writes samples/sw-assembly/: a synthetic SolidWorks assembly folder for the companion-file tests (stdlib only).

The structure follows public SolidWorks 2014-2025 files (docs/evidence/companions-eng/README.md):
swXmlContents/COMPINSTANCETREE (swFile / swModel / swReference with a column-major swTransform in metres,
swSuppressed, swHidden, a configuration display state) and FaceTessellations/Directory + one tessellation stream
whose blocks start with [u32 index][8-byte hash].

  Orca-Frame.SLDASM       2015+ container. Bracket-1/-2 have stored tessellations; Rail-1 has none (its mesh
                          comes from Orca-Rail.SLDPRT when the folder is given); Rail-2 is suppressed and
                          Bracket-3 hidden by the display state.
  Orca-Frame-2014.SLDASM  OLE layout, COMPINSTANCETREE__ZLB only: every mesh comes from the part files.
  Orca-Bracket.SLDPRT     part, DisplayLists of an L-bracket.
  Orca-Rail.SLDPRT        part, DisplayLists of a 300 mm rail.
  Orca-Frame.SLDDRW       drawing whose views reference both parts.

  python tools/make-sw-assembly.py
"""
import importlib.util
import sys
import math
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("prop", os.path.join(HERE, "make-prop-samples.py"))
prop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prop)

OUT = os.path.join(HERE, "..", "samples", "sw-assembly")
os.makedirs(OUT, exist_ok=True)

BRACKET = prop.BRACKET  # metres
RAIL = [(0.0, 0.0, 0.0, 0.3, 0.02, 0.02)]


def rot(axis, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    if axis == "x":
        return [[1, 0, 0], [0, c, -s], [0, s, c]]
    if axis == "y":
        return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def transform(r, t):
    """Column-major 4x4 as SolidWorks stores it: x-axis image, y-axis image, z-axis image, translation."""
    cols = [[r[0][j], r[1][j], r[2][j], 0] for j in range(3)] + [[t[0], t[1], t[2], 1]]
    return [v for col in cols for v in col]


def apply(m, p):
    return tuple(p[0] * m[i] + p[1] * m[4 + i] + p[2] * m[8 + i] + m[12 + i] for i in range(3))


def bbox(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), min(b[2] for b in boxes), max(b[3] for b in boxes), max(b[4] for b in boxes), max(b[5] for b in boxes)]


def fmt(v):
    s = repr(float(v))
    return "0" if s in ("0.0", "-0.0") else s.rstrip("0").rstrip(".") if "e" not in s else s


# name, number, part, transform, suppressed, hidden, swID
INSTANCES = [
    ("Orca-Bracket", 1, "bracket", transform(rot("z", 0), (0, 0, 0)), False, False, 17),
    ("Orca-Bracket", 2, "bracket", transform(rot("y", 180), (0.3, 0, 0.04)), False, False, 18),
    ("Orca-Rail", 1, "rail", transform(rot("z", 0), (0, 0.05, 0.01)), False, False, 21),
    ("Orca-Rail", 2, "rail", transform(rot("z", 0), (0, 0.05, -0.05)), True, False, 24),
    ("Orca-Bracket", 3, "bracket", transform(rot("x", 90), (0.15, 0.1, 0)), False, True, 27),
]
PARTS = {"bracket": ("Orca-Bracket", r"C:\Samples\Frame\Orca-Bracket.SLDPRT", BRACKET), "rail": ("Orca-Rail", r"C:\Samples\Frame\Orca-Rail.SLDPRT", RAIL)}


def comp_tree(asm_path, asm_name):
    files = [f'<swFile id="3" swDocType="ASSEMBLY" swCreationTime="1785695731" swPath="{asm_path}"/>']
    models = []
    ids = {}
    for i, (key, (name, path, boxes)) in enumerate(PARTS.items()):
        fid, mid = 6 + 3 * i, 5 + 3 * i
        ids[key] = mid
        files.append(f'<swFile id="{fid}" swDocType="PART" swCreationTime="1785425519" swPath="{path}"/>')
        b = " ".join(fmt(v) for v in bbox(boxes))
        models.append(f'<swModel id="{mid}" swName="{name}" swConfigurationName="Default" swConfigurationId="0" swLastModifiedStamp="135" swConfigurationFlags="-2143288960" swFileRef="{fid}" swBoundingBox="{b}"/>')
    refs = []
    placed = []
    for k, (name, num, part, m, sup, hid, sid) in enumerate(INSTANCES):
        refs.append(
            f'<swReference id="{40 + k}" swName="{name}" swReferenceNumber="{num}" swComponentReference="" swComponentName="{name}" swID="{sid}" '
            f'swIsVirtualComponent="NO" swConfigurationId="0" swConfigurationName="Default" swDisplayMode="6" swHlrDisplayQuality="1" '
            f'swSuppressed="{"YES" if sup else "NO"}" swHidden="NO" swEdgesInShadedMode="NO" swFlexible="NO" swExcludeFromBOM="NO" swZone="NO" '
            f'swModelRef="{ids[part]}" swTransform="{" ".join(fmt(v) for v in m)}" swTransformStamp="100"/>'
        )
        if not sup and not hid:
            for b in PARTS[part][2]:
                for corner in [(x, y, z) for x in (b[0], b[3]) for y in (b[1], b[4]) for z in (b[2], b[5])]:
                    placed.append(apply(m, corner))
    top = [min(p[i] for p in placed) for i in range(3)] + [max(p[i] for p in placed) for i in range(3)]
    models.append(
        f'<swModel id="2" swName="{asm_name}" swConfigurationName="Default" swConfigurationId="0" swLastModifiedStamp="364" swConfigurationFlags="-2147221376" swFileRef="3" '
        f'swBoundingBox="{" ".join(fmt(v) for v in top)}" swAssemblyFeatureEffectedComponents="">' + "".join(refs) + "</swModel>"
    )
    ids_list = ",".join(str(i[6]) for i in INSTANCES) + ","
    show = ",".join("No" if i[5] else "Yes" for i in INSTANCES) + ","
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<swSolidWorks xmlns="http://www.solidworks.com/sw2003/schema" swObjCount="40" swVersion="17000">'
        f'<swHeader swObjCount="{len(files)}">' + "".join(files) + "</swHeader>"
        f'<swModelList swObjCount="{len(models)}">' + "".join(models) + "</swModelList>"
        '<swConfigurationList swObjCount="1"><swConfiguration id="1" swName="Default" swID="0" swReference="' + asm_name + '" swMostRecentConfiguration="YES" '
        'swConfigurationNeedsUpdate="NO" swDefeatureConfiguration="NO" swModelRef="2">'
        f'<swDisplayStateList id="30" swCompNameList="{ids_list}"><swDisplayState id="31" swDisplayStateName="Display State-1" swShowState="{show}"/></swDisplayStateList>'
        '</swConfiguration></swConfigurationList><swExtFeatureList swObjCount="0"/></swSolidWorks>'
    )
    return xml.encode("utf-8"), top


def tessellations(asm_name):
    """Directory + one stream: owner blocks for Bracket-1 (Bracket-2/-3 reuse it); no block for the rails."""
    h_b1 = bytes.fromhex("b98dbe0d21634c21")
    entries = [("Orca-Bracket-1", h_b1, b"\0" * 8, "000-000-046", 0), ("Orca-Bracket-2", bytes.fromhex("d204c21ddd2b0829"), h_b1, "", -1), ("Orca-Bracket-3", bytes.fromhex("44d2950ec3c01d39"), h_b1, "", -1)]
    d = bytearray(struct.pack("<4I", 2, 46, 12, 1))
    for i, (name, own, src, stream, block) in enumerate(entries):
        d += prop.mfc_string(f"{name}@{asm_name}") + struct.pack("<I", 0x87) + bytes(8) + src + own
        d += prop.mfc_string(stream) + struct.pack("<i", block) + struct.pack("<5I", 1, 0x66, 0x50, 6, i + 2)
    stream = bytearray(struct.pack("<I", 0) + h_b1 + struct.pack("<II", 0x38, 0x30)) + prop.boxes_mesh(BRACKET)
    return bytes(d), bytes(stream)


def part(name, boxes):
    streams = [
        ("Contents/DisplayLists", prop.boxes_mesh(boxes)),
        ("Header2", b"\xff\xff\x01\x00\x0a\x00moHeader_c" + bytes(32)),
        ("PreviewPNG", prop.bracket_png()),
        ("_MO_VERSION_17000/History", prop.history([(17000, 2024157, True)])),
        ("swXmlContents/KeyWords", prop.keywords_xml(name, ["Default"], [("Boss-Extrude1", "Extrusion")])),
    ]
    streams += list(prop.docprops(name, "File Preview", [("PartNo", name.upper())]).items())
    return prop.modern_container(streams)


def main():
    asm_name = "Orca-Frame"
    tree, top = comp_tree(r"C:\Samples\Frame\Orca-Frame.SLDASM", asm_name)
    directory, stream = tessellations(asm_name)
    refs = [f"{n}-{k}" for (n, k, *_r) in INSTANCES]
    streams = [
        ("PreviewPNG", prop.bracket_png(bg=(240, 244, 255))),
        ("Contents/Config-0-MatesList", bytes(64)),
        ("Contents/DisplayLists", bytes(512)),
        ("FaceTessellations/Directory", directory),
        ("FaceTessellations/000-000-046", stream),
        ("_MO_VERSION_18000/History", prop.history([(18000, 2025261, True)])),
        ("swXmlContents/COMPINSTANCETREE", tree),
        ("swXmlContents/KeyWords", prop.keywords_xml(asm_name, ["Default"], [("Mates", "MateGroup")], refs)),
    ]
    streams += list(prop.docprops("Orca frame", "File Preview", [("Project", "Companion samples")]).items())
    with open(os.path.join(OUT, "Orca-Frame.SLDASM"), "wb") as f:
        f.write(prop.modern_container(streams))

    tree14, _ = comp_tree(r"E:\Samples\Frame\Orca-Frame-2014.SLDASM", "Orca-Frame-2014")
    ole = {
        "PreviewPNG": prop.bracket_png(bg=(255, 248, 236)),
        "Header2": b"\xff\xff\x01\x00\x0a\x00moHeader_c" + bytes(32),
        "_MO_VERSION_7000": {"History": prop.history([(7000, 2014161, True)])},
        "Contents": {"Config-0-MatesList": bytes(64), "DisplayLists__ZLB": prop.zlb(bytes(512))},
        "swXmlContents": {"COMPINSTANCETREE__ZLB": prop.zlb(tree14)},
    }
    with open(os.path.join(OUT, "Orca-Frame-2014.SLDASM"), "wb") as f:
        f.write(prop.cfb(ole))

    for key, (name, _path, boxes) in PARTS.items():
        with open(os.path.join(OUT, f"{name}.SLDPRT"), "wb") as f:
            f.write(part(name, boxes))

    drw = [
        ("PreviewPNG", prop.sheet_png(320, 226)),
        ("Images/Sheet_0", prop.sheet_png()),
        ("SheetPreviews/SheetNames", b"\x01\x00" + prop.mfc_string("Sheet1") + bytes(4)),
        ("_MO_VERSION_17000/History", prop.history([(17000, 2024078, True)])),
        ("swXmlContents/xmlstream-2", prop.sw_xml([("DRAWING", r"C:\Samples\Frame\Orca-Frame.SLDDRW"), ("PART", PARTS["bracket"][1]), ("PART", PARTS["rail"][1]), ("PART", r"C:\Samples\Frame\Missing-Plate.SLDPRT")])),
    ]
    with open(os.path.join(OUT, "Orca-Frame.SLDDRW"), "wb") as f:
        f.write(prop.modern_container(drw))
    print("top bounding box (m):", [round(v, 6) for v in top])
    print("wrote", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    main()
