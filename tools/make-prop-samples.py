"""Synthetic SolidWorks and EPLAN samples for the File Preview harness and unit tests.

Everything here is generated from scratch with the Python standard library (zlib, lzma, struct):
no SolidWorks or EPLAN file, and no third-party content, goes into the samples. The containers
follow the layouts the viewers read (see plugin/editor/renderers/prop/sw.ts and eplan.ts):

  samples/sample.sldprt        SolidWorks 2015+ container: preview PNG, docProps XML, KeyWords,
                               History, and a display mesh of an L-bracket (DisplayLists)
  samples/sample-2014.sldprt   OLE compound file (SolidWorks 2014 layout): property sets,
                               _MO_VERSION_7000 storage, __ZLB-framed DisplayLists and KeyWords
  samples/sample.sldasm        assembly: COMPINSTANCETREE references, component instances
  samples/sample.slddrw        drawing: sheet image Images/Sheet_0, SheetNames, referenced model
  samples/sample.edz           EPLAN Data Portal package: 7z (LZMA, non-solid) with manifest.xml,
                               part XML, manufacturer, picture, PDF data sheet and a PXF macro
  samples/sample-zip.edz       the same package in a ZIP container
  samples/sample.zw1           EPLAN project backup: 7z (LZMA2, solid, encoded header) with
                               ProjectInfo.xml, A_BAKINFO.XML, Page.eod-like page texts, a picture
  samples/sample.elk           project link file (UTF-16LE)
  samples/damaged.sldprt, damaged.edz, damaged.zx1
                               unreadable files: the generic inspector must show them

Run: python tools/make-prop-samples.py
"""
import io
import lzma
import os
import struct
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "samples")


def p(name):
    return os.path.join(OUT, name)


# ---------------------------------------------------------------------------------------------
# PNG (RGB, no dependencies)


def png(w, h, pixel):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(pixel(x, y))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def bracket_png(w=320, h=240, bg=(255, 255, 255)):
    """A flat-shaded isometric L-bracket, like a CAD thumbnail."""

    def pixel(x, y):
        u = (x - w * 0.5) / (w * 0.32)
        v = (y - h * 0.62) / (h * 0.32)
        # base plate top (rhombus), front and side
        if abs(u) + abs(v * 2) < 1.0 and v < 0.35:
            return (170, 178, 196)
        if -1.0 < u < 0.0 and 0.0 < v - (-u) * -0.5 + 0.5 < 0.25:
            return (120, 128, 146)
        if -1.0 < u < -0.55 and -1.6 < v < 0.0 and v > -1.6 + (u + 1) * 0.5:
            return (140, 148, 166)
        return bg

    return png(w, h, pixel)


def sheet_png(w=420, h=297):
    def pixel(x, y):
        if x < 6 or y < 6 or x >= w - 6 or y >= h - 6:
            return (0, 0, 0) if (x in (6, w - 7) or y in (6, h - 7)) else (255, 255, 255)
        if y > h - 50 and x > w - 170 and (y in (h - 50, h - 30) or x in (w - 170, w - 90)):
            return (0, 0, 0)
        # front view rectangle and an L outline
        if (40 <= x <= 160 and y in (60, 120)) or (x in (40, 160) and 60 <= y <= 120):
            return (0, 0, 0)
        if (220 <= x <= 300 and y in (60, 200)) or (x in (220, 300) and 60 <= y <= 200):
            return (0, 0, 0)
        return (255, 255, 255)

    return png(w, h, pixel)


# ---------------------------------------------------------------------------------------------
# SolidWorks pieces


def boxes_mesh(boxes):
    """Face records ([4,8,2,S] strip lengths, [12,100,2,V] positions and normals, Block1..3, a
    132-byte bounding record) for axis-aligned boxes given in metres."""
    out = bytearray(struct.pack("<II", 1, 1))
    for (x0, y0, z0, x1, y1, z1) in boxes:
        quads = [
            ((0, 0, 1), [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
            ((0, 0, -1), [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)]),
            ((1, 0, 0), [(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)]),
            ((-1, 0, 0), [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)]),
            ((0, 1, 0), [(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)]),
            ((0, -1, 0), [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]),
        ]
        for n, (a, b, c, d) in quads:
            strip = [a, b, d, c]  # triangles (a,b,d) and (d,b,c): counter-clockwise from outside
            out += struct.pack("<4I", 4, 8, 2, 1) + struct.pack("<I", 4)
            out += struct.pack("<4I", 12, 100, 2, 4) + b"".join(struct.pack("<3f", *v) for v in strip)
            out += struct.pack("<4I", 12, 100, 2, 4) + b"".join(struct.pack("<3f", *n) for _ in strip)
            out += struct.pack("<4I", 4, 8, 2, 6) + struct.pack("<6I", 1, 11, 12, 0, 13, 14)
            out += struct.pack("<4I", 4, 8, 2, 1) + struct.pack("<I", 6)
            out += struct.pack("<4I", 1, 8, 2, 6) + bytes(6)
            xs = [v[0] for v in strip]
            ys = [v[1] for v in strip]
            zs = [v[2] for v in strip]
            mx = (max(xs), max(ys), max(zs))
            mn = (min(xs), min(ys), min(zs))
            ctr = tuple((a + b) / 2 for a, b in zip(mx, mn))
            rad = sum((a - b) ** 2 for a, b in zip(mx, ctr)) ** 0.5
            out += struct.pack("<3I", 0, 0, 1) + struct.pack("<10d", *ctr, *mx, *mn, rad) + bytes(40)
    return bytes(out)


BRACKET = [(0.0, 0.0, 0.0, 0.06, 0.01, 0.04), (0.0, 0.01, 0.0, 0.01, 0.05, 0.04)]


def mfc_string(s):
    u = s.encode("utf-16-le")
    return b"\xff\xfe\xff" + bytes([len(s)]) + u


def history(saves):
    """moVersionHistory_c with (release code, YYYYDDD build, created) saves."""
    b = bytearray(struct.pack("<HHH", 0xFFFF, 1, 18) + b"moVersionHistory_c")
    b += struct.pack("<I", len(saves))
    for i, (code, build, created) in enumerate(saves):
        b += struct.pack("<IHI", 0, 0, 1700000000) + mfc_string("")
        b += struct.pack("<I", code)
        if i == 0:
            b += struct.pack("<HHH", 0xFFFF, 1, 19) + b"moDateCodeHistory_c"
        else:
            b += struct.pack("<H", 0x8003)
        b += struct.pack("<II", 1, build | ((1 if created else 0) << 24))
    b += struct.pack("<Ii", 0, -1) + bytes(14)
    return bytes(b)


def keywords_xml(name, configs, features, refs=()):
    rows = [f'<Configuration id="{i}" Name="{c}" Description="" Type="ConfigurationManager"/>' for i, c in enumerate(configs)]
    rows += [f'<Feature id="{i + 10}" Name="{n}" Type="{t}"/>' for i, (n, t) in enumerate(features)]
    rows += [f'<Reference id="{i + 100}" Name="{r}" Type="{r.rsplit("-", 1)[0]}-"/>' for i, r in enumerate(refs)]
    return ('<?xml version="1.0" encoding="UTF-8"?>\r\n' f'<Keywords id="1700000000" Name="{name}">' + "".join(rows) + "</Keywords>").encode("utf-8")


def sw_xml(files, configs=()):
    f = "".join(f'<swFile id="{i + 3}" swDocType="{t}" swCreationTime="1700000000" swPath="{path}"/>' for i, (t, path) in enumerate(files))
    c = "".join(f'<swConfiguration id="{i + 50}" swName="{n}" swID="{i}" swMostRecentConfiguration="{"YES" if i == 0 else "NO"}"/>' for i, n in enumerate(configs))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\r\n<swSolidWorks xmlns="http://www.solidworks.com/sw2003/schema" swVersion="17000">'
        f'<swHeader swObjCount="{len(files)}">{f}</swHeader><swConfigurationList>{c}</swConfigurationList></swSolidWorks>'
    ).encode("utf-8")


def docprops(title, author, custom):
    core = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">'
        f"<dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><cp:lastModifiedBy>{author}</cp:lastModifiedBy>"
        "<dcterms:created>2026-11-20T09:00:00Z</dcterms:created><dcterms:modified>2026-11-26T09:30:00Z</dcterms:modified></cp:coreProperties>"
    ).encode("utf-8")
    app = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        "<Application>SOLIDWORKS</Application><AppVersion>24.0000</AppVersion></Properties>"
    ).encode("utf-8")
    props = "".join(f'<property name="{k}" pid="{i + 2}"><vt:lpstr>{v}</vt:lpstr></property>' for i, (k, v) in enumerate(custom))
    cust = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><propertySection name="UserDefinedProperties">'
        f"{props}</propertySection></Properties>"
    ).encode("utf-8")
    swinfo = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><propertySection name="UserDefinedProperties">'
        f'<property name="SW-File Name" pid="3"><vt:lpstr>{title}</vt:lpstr></property><property name="SW-Author" pid="9"><vt:lpstr>{author}</vt:lpstr></property>'
        '<property name="SW_UnitsLinear" pid="21"><vt:i4>0</vt:i4></property></propertySection></Properties>'
    ).encode("utf-8")
    return {"docProps/core.xml": core, "docProps/app.xml": app, "docProps/custom.xml": cust, "docProps/ISolidWorksInformation.xml": swinfo}


def modern_container(streams, key=b"\x5a\x31\xc4\x09"):
    """SolidWorks 2015+ container: 8-byte header, ZIP-shaped local headers/central directory/end
    record with per-file signatures, offsets counted from byte 8, names rotated by byte 7 & 7."""
    k = 4
    rot = lambda s: bytes(((c << k) | (c >> (8 - k))) & 0xFF for c in s.encode("utf-8"))
    sig_local, sig_central, sig_end = 0x7D3A11C5, 0x2B9E6F04, 0x51C0DE77
    body = bytearray(key + b"\x00\x00\x00\x04")
    central = bytearray()
    for name, data in streams:
        comp = zlib.compressobj(9, zlib.DEFLATED, -15)
        packed = comp.compress(data) + comp.flush()
        crc = zlib.crc32(data) & 0xFFFFFFFF
        n = rot(name)
        offset = len(body) - 8
        body += struct.pack("<IHHHIIIIHH", sig_local, 20, 6, 8, 0, crc, len(packed), len(data), len(n), 0) + n + packed
        central += struct.pack("<IHHHHIIIIHHHHHII", sig_central, 0, 20, 6, 8, 0, crc, len(packed), len(data), len(n), 0, 0, 0, 1 if name.endswith(".xml") else 0, 0, offset) + n
    dir_offset = len(body) - 8
    body += central
    body += struct.pack("<IIHHIIH", sig_end, 0, len(streams), len(streams), len(central), dir_offset, 0)
    return bytes(body)


# ---------------------------------------------------------------------------------------------
# OLE compound file writer (version 3, 512-byte sectors, mini stream for streams < 4096 bytes)

FREE, END, FATSECT = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD


def cfb(tree):
    """`tree` maps names to bytes (streams) or to dicts (storages)."""
    entries = [{"name": "Root Entry", "type": 5, "kids": [], "data": b""}]

    def add(node, parent):
        for name in sorted(node, key=lambda s: (len(s), s.upper())):
            v = node[name]
            e = {"name": name, "type": 1 if isinstance(v, dict) else 2, "kids": [], "data": b"" if isinstance(v, dict) else v}
            entries.append(e)
            parent["kids"].append(len(entries) - 1)
            if isinstance(v, dict):
                add(v, e)

    add(tree, entries[0])
    mini = bytearray()
    minifat = []
    for e in entries:
        if e["type"] == 2 and 0 < len(e["data"]) < 4096:
            n = (len(e["data"]) + 63) // 64
            e["start"] = len(mini) // 64
            for j in range(n):
                minifat.append(e["start"] + j + 1 if j < n - 1 else END)
            mini += e["data"] + bytes(n * 64 - len(e["data"]))
    big = [e for e in entries if e["type"] == 2 and len(e["data"]) >= 4096]
    sectors = lambda nbytes: (nbytes + 511) // 512
    n_dir = sectors(len(entries) * 128)
    n_minifat = sectors(len(minifat) * 4)
    n_mini = sectors(len(mini))
    n_big = sum(sectors(len(e["data"])) for e in big)
    n_fat = 1
    while n_fat * 128 < n_fat + n_dir + n_minifat + n_mini + n_big:
        n_fat += 1
    fat = [FREE] * (n_fat * 128)
    pos = 0

    def chain(count):
        nonlocal pos
        start = pos
        for j in range(count):
            fat[pos] = pos + 1 if j < count - 1 else END
            pos += 1
        return start if count else END

    for _ in range(n_fat):
        fat[pos] = FATSECT
        pos += 1
    dir_start = chain(n_dir)
    minifat_start = chain(n_minifat)
    mini_start = chain(n_mini)
    for e in big:
        e["start"] = chain(sectors(len(e["data"])))
    entries[0]["start"] = mini_start if n_mini else END
    entries[0]["size"] = len(mini)

    # Sibling links: each storage's children as a right-leaning chain.
    links = {i: [FREE, FREE, FREE] for i in range(len(entries))}
    for i, e in enumerate(entries):
        kids = e["kids"]
        if kids:
            links[i][2] = kids[0]
            for a, b in zip(kids, kids[1:]):
                links[a][1] = b
    d = bytearray()
    for i, e in enumerate(entries):
        nm = e["name"].encode("utf-16-le") + b"\x00\x00"
        size = e.get("size", len(e["data"]))
        start = e.get("start", END if e["type"] == 2 else 0)
        if e["type"] == 1:
            start, size = 0, 0
        d += nm + bytes(64 - len(nm)) + struct.pack("<HBB", len(nm), e["type"], 1) + struct.pack("<III", *links[i]) + bytes(16) + struct.pack("<I", 0) + bytes(16) + struct.pack("<II", start, size) + bytes(4)
    d += bytes(n_dir * 512 - len(d))
    hdr = bytearray(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + bytes(16) + struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + bytes(6))
    hdr += struct.pack("<IIIIIIIII", 0, n_fat, dir_start, 0, 4096, minifat_start if n_minifat else END, n_minifat, END, 0)
    difat = list(range(n_fat)) + [FREE] * (109 - n_fat)
    hdr += struct.pack("<109I", *difat)
    out = bytearray(hdr)
    out += struct.pack(f"<{len(fat)}I", *fat)
    out += d
    mf = struct.pack(f"<{len(minifat)}I", *minifat) if minifat else b""
    out += mf + bytes(n_minifat * 512 - len(mf))
    out += mini + bytes(n_mini * 512 - len(mini))
    for e in big:
        out += e["data"] + bytes(sectors(len(e["data"])) * 512 - len(e["data"]))
    return bytes(out)


def zlb(data):
    guid = bytes.fromhex("231dd571da8148a2a85898b21b89ef99")
    c = zlib.compress(data, 9)
    return guid + struct.pack("<II", len(data), len(c)) + c + bytes(8)


def property_set(sections):
    """MS-OLEPS stream. `sections` = [(fmtid bytes, [(id, vt, value)], dictionary or None)]."""

    def value(vt, v):
        if vt == 0x1E:
            s = v.encode("cp1252") + b"\x00"
            b = struct.pack("<II", vt, len(s)) + s
        elif vt == 0x40:
            b = struct.pack("<IQ", vt, v)
        elif vt == 2:
            b = struct.pack("<IhH", vt, v, 0)
        elif vt == 3:
            b = struct.pack("<Ii", vt, v)
        else:
            raise ValueError(vt)
        return b + bytes((4 - len(b) % 4) % 4)

    blobs = []
    for fmtid, props, names in sections:
        items = [(1, value(2, 1252))]
        if names:
            dct = struct.pack("<I", len(names))
            for pid, nm in names.items():
                s = nm.encode("cp1252") + b"\x00"
                dct += struct.pack("<II", pid, len(s)) + s
            items.append((0, dct + bytes((4 - len(dct) % 4) % 4)))
        items += [(pid, value(vt, v)) for pid, vt, v in props]
        head = 8 + 8 * len(items)
        offs, body = [], bytearray()
        for pid, b in items:
            offs.append((pid, head + len(body)))
            body += b
        sec = struct.pack("<II", head + len(body), len(items)) + b"".join(struct.pack("<II", a, b) for a, b in offs) + body
        blobs.append((fmtid, sec))
    out = bytearray(struct.pack("<HHI", 0xFFFE, 0, 0x00020006) + bytes(16) + struct.pack("<I", len(blobs)))
    off = 28 + 20 * len(blobs)
    for fmtid, sec in blobs:
        out += fmtid + struct.pack("<I", off)
        off += len(sec)
    for _, sec in blobs:
        out += sec
    return bytes(out)


def guid_bytes(s):
    import uuid

    return uuid.UUID(s).bytes_le


def filetime(y, mo, d, h=9, mi=0):
    import datetime

    t = datetime.datetime(y, mo, d, h, mi, tzinfo=datetime.timezone.utc)
    return int((t.timestamp() + 11644473600) * 10_000_000)


def make_solidworks():
    preview = bracket_png()
    part_features = [("Front Plane", "RefPlane"), ("Top Plane", "RefPlane"), ("Right Plane", "RefPlane"), ("Base-Extrude", "Extrusion"), ("Upright", "Extrusion"), ("Fillet1", "Fillet")]
    streams = [
        ("Contents/DisplayLists", boxes_mesh(BRACKET)),
        ("Contents/CusProps", bytes(16)),
        ("Header2", b"\xff\xff\x01\x00\x0a\x00moHeader_c" + bytes(32)),
        ("PreviewPNG", preview),
        ("_MO_VERSION_17000/History", history([(15000, 2022009, True), (17000, 2024157, False)])),
        ("_DL_VERSION_17000/DLUpdateStamp", bytes(6)),
        ("swXmlContents/KeyWords", b"\x86" + keywords_xml("Orca-Bracket", ["Default", "Long"], part_features)),
        ("swXmlContents/Features", sw_xml([("PART", r"C:\Samples\Orca-Bracket.SLDPRT")], ["Default", "Long"])),
    ]
    for k, v in docprops("Orca bracket", "File Preview", [("Material", "AISI 304"), ("PartNo", "FP-1001"), ("Revision", "B")]).items():
        streams.append((k, v))
    with open(p("sample.sldprt"), "wb") as f:
        f.write(modern_container(streams))

    # SolidWorks 2014 layout: OLE compound file.
    fmt_summary = guid_bytes("f29f85e0-4ff9-1068-ab91-08002b27b3d9")
    fmt_doc = guid_bytes("d5cdd502-2e9c-101b-9397-08002b2cf9ae")
    fmt_user = guid_bytes("d5cdd505-2e9c-101b-9397-08002b2cf9ae")
    summary = property_set([(fmt_summary, [(2, 0x1E, "Orca bracket (2014)"), (4, 0x1E, "File Preview"), (8, 0x1E, "File Preview"), (12, 0x40, filetime(2014, 6, 10)), (13, 0x40, filetime(2014, 6, 12)), (18, 0x1E, "SolidWorks")], None)])
    docsum = property_set([(fmt_doc, [], None), (fmt_user, [(2, 0x1E, "FP-1001"), (3, 0x1E, "AISI 304")], {2: "PartNo", 3: "Material"})])
    tree = {
        "SummaryInformation": summary,
        "DocumentSummaryInformation": docsum,
        "PreviewPNG": preview,
        "Header2": b"\xff\xff\x01\x00\x0a\x00moHeader_c" + bytes(32),
        "_MO_VERSION_7000": {"History": history([(7000, 2014161, True)])},
        "_DL_VERSION_7000": {"DLUpdateStamp": bytes(6)},
        "Contents": {"DisplayLists__ZLB": zlb(boxes_mesh(BRACKET)), "Config-0": b"\xff\xff\x01\x00\x08\x00moPart_c" + bytes(64)},
        "swXmlContents": {"KeyWords__ZLB": zlb(keywords_xml("Orca-Bracket", ["Default"], part_features))},
    }
    with open(p("sample-2014.sldprt"), "wb") as f:
        f.write(cfb(tree))

    # Assembly: references and instances; the component mesh has no placement (not drawn).
    files = [("ASSEMBLY", r"C:\Samples\Orca-Frame.SLDASM"), ("PART", r"C:\Samples\Orca-Bracket.SLDPRT"), ("PART", r"C:\Samples\Orca-Rail.SLDPRT")]
    asm = [
        ("PreviewPNG", bracket_png(bg=(240, 244, 255))),
        ("Contents/Config-0-MatesList", bytes(64)),
        ("Contents/DisplayLists", bytes(512)),
        ("FaceTessellations/000-000-001", boxes_mesh(BRACKET[:1])),
        ("_MO_VERSION_18000/History", history([(18000, 2025261, True)])),
        ("swXmlContents/COMPINSTANCETREE", sw_xml(files, ["Default"])),
        ("swXmlContents/KeyWords", keywords_xml("Orca-Frame", ["Default"], [("Mates", "MateGroup")], ["Orca-Bracket-1", "Orca-Bracket-2", "Orca-Rail-1"])),
    ]
    asm += list(docprops("Orca frame", "File Preview", [("Project", "Preview samples")]).items())
    with open(p("sample.sldasm"), "wb") as f:
        f.write(modern_container(asm))

    drw = [
        ("PreviewPNG", sheet_png(320, 226)),
        ("Images/Sheet_0", sheet_png()),
        ("SheetPreviews/SheetNames", b"\x01\x00" + mfc_string("Sheet1") + bytes(4)),
        ("_MO_VERSION_17000/History", history([(17000, 2024078, True)])),
        ("swXmlContents/xmlstream-2", sw_xml([("DRAWING", r"C:\Samples\Orca-Bracket.SLDDRW"), ("PART", r"C:\Samples\Orca-Bracket.SLDPRT")])),
    ]
    drw += list(docprops("Orca bracket drawing", "File Preview", [("DrawnBy", "FP"), ("Scale", "1:1")]).items())
    with open(p("sample.slddrw"), "wb") as f:
        f.write(modern_container(drw))

    # Unreadable: OLE signature with a broken header.
    with open(p("damaged.sldprt"), "wb") as f:
        f.write(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + bytes(20) + struct.pack("<H", 7) + b"Orca damaged part " * 40)


# ---------------------------------------------------------------------------------------------
# 7z writer (LZMA / LZMA2 via the standard lzma module)


def num7z(v):
    """7z variable-length number."""
    if v < 0x80:
        return bytes([v])
    for n in range(1, 9):
        if v < (1 << (7 * (n + 1))) or n == 8:
            first = (0xFF << (8 - n)) & 0xFF
            hi = v >> (8 * n)
            if n < 8:
                first |= hi
            return bytes([first]) + (v & ((1 << (8 * n)) - 1)).to_bytes(n, "little")
    raise ValueError(v)


def lzma1(data):
    filters = [{"id": lzma.FILTER_LZMA1, "dict_size": 1 << 16, "lc": 3, "lp": 0, "pb": 2}]
    props = bytes([(2 * 5 + 0) * 9 + 3]) + struct.pack("<I", 1 << 16)
    return lzma.compress(data, format=lzma.FORMAT_RAW, filters=filters), b"\x03\x01\x01", props


def lzma2(data):
    filters = [{"id": lzma.FILTER_LZMA2, "dict_size": 1 << 20}]
    return lzma.compress(data, format=lzma.FORMAT_RAW, filters=filters), b"\x21", bytes([16])


def folder_info(coder_id, props, unpack_size):
    f = b"\x01" + bytes([0x20 | len(coder_id)]) + coder_id + num7z(len(props)) + props
    return f, unpack_size


def streams_info(pack_pos, packs, folders, substreams=None):
    b = bytearray(b"\x06" + num7z(pack_pos) + num7z(len(packs)) + b"\x09" + b"".join(num7z(x) for x in packs) + b"\x00")
    b += b"\x07\x0b" + num7z(len(folders)) + b"\x00" + b"".join(f for f, _ in folders) + b"\x0c" + b"".join(num7z(u) for _, u in folders) + b"\x00"
    if substreams is not None:
        b += b"\x08\x0d" + b"".join(num7z(len(s)) for s in substreams)
        sizes = b"".join(num7z(x) for s in substreams for x in s[:-1])
        if sizes:
            b += b"\x09" + sizes
        b += b"\x00"
    b += b"\x00"
    return bytes(b)


def bits(flags):
    out = bytearray()
    for i in range(0, len(flags), 8):
        v = 0
        for j, f in enumerate(flags[i : i + 8]):
            if f:
                v |= 0x80 >> j
        out.append(v)
    return bytes(out)


def seven_zip(files, method="lzma", solid=False, encode_header=False):
    """files: [(path, bytes or None for a directory)]."""
    comp = lzma1 if method == "lzma" else lzma2
    real = [(n, d) for n, d in files if d]
    packed = bytearray()
    packs, folders, subs = [], [], []
    if solid:
        blob = b"".join(d for _, d in real)
        c, cid, props = comp(blob)
        packed += c
        packs.append(len(c))
        folders.append(folder_info(cid, props, len(blob)))
        subs.append([len(d) for _, d in real])
    else:
        for _, d in real:
            c, cid, props = comp(d)
            packed += c
            packs.append(len(c))
            folders.append(folder_info(cid, props, len(d)))
            subs.append([len(d)])
    h = bytearray(b"\x01\x04" + streams_info(0, packs, folders, subs))
    empty = [d is None or len(d) == 0 for _, d in files]
    fi = bytearray(num7z(len(files)))
    if any(empty):
        v = bits(empty)
        fi += b"\x0e" + num7z(len(v)) + v
        ef = bits([d is not None for (_, d), e in zip(files, empty) if e])
        fi += b"\x0f" + num7z(len(ef)) + ef
    names = b"\x00" + b"".join(n.encode("utf-16-le") + b"\x00\x00" for n, _ in files)
    fi += b"\x11" + num7z(len(names)) + names
    attrs = b"\x01\x00" + b"".join(struct.pack("<I", 0x10 if d is None else 0x20) for _, d in files)
    fi += b"\x15" + num7z(len(attrs)) + attrs + b"\x00"
    h += b"\x05" + fi + b"\x00"
    header = bytes(h)
    if encode_header:
        c, cid, props = lzma1(header)
        enc = b"\x17" + streams_info(len(packed), [len(c)], [folder_info(cid, props, len(header))])
        packed += c
        header = enc
    start = struct.pack("<QQI", len(packed), len(header), zlib.crc32(header) & 0xFFFFFFFF)
    sig = b"7z\xbc\xaf\x27\x1c\x00\x04" + struct.pack("<I", zlib.crc32(start) & 0xFFFFFFFF) + start
    return sig + bytes(packed) + header


# ---------------------------------------------------------------------------------------------
# EPLAN samples


def tiny_pdf(title, lines):
    text = "BT /F1 18 Tf 50 780 Td (" + title + ") Tj ET " + " ".join(f"BT /F1 11 Tf 50 {740 - 18 * i} Td ({l}) Tj ET" for i, l in enumerate(lines))
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(text)).encode() + b" >>\nstream\n" + text.encode("latin-1") + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offs = []
    for i, o in enumerate(objs):
        offs.append(len(out))
        out += f"{i + 1} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def terminal_png(w=240, h=180):
    def pixel(x, y):
        if 70 <= x <= 170 and 20 <= y <= 160:
            if 85 <= x <= 155 and (30 <= y <= 60 or 120 <= y <= 150):
                return (180, 180, 180)
            return (90, 160, 90)
        return (255, 255, 255)

    return png(w, h, pixel)


def make_eplan():
    part = (
        '<?xml version="1.0" encoding="utf-8" ?>\n<partsmanagement count="1" length-unit="mm" weight-unit="kg" type="EPLAN.PartsManagement" build="0">\n'
        ' <part P_ARTICLE_PARTNR="ORCA.TB-100" P_ARTICLE_TYPENR="TB-100" P_ARTICLE_ORDERNR="100-0001" P_ARTICLE_MANUFACTURER="ORCA" P_ARTICLE_SUPPLIER="ORCA"'
        ' P_ARTICLE_DESCR1="de_DE@Durchgangsklemme 2,5 mm²;en_US@Feed-through terminal 2.5 mm²;ko_KR@관통 단자 2.5 mm²;"'
        ' P_ARTICLE_NOTE="en_US@Synthetic sample made for the File Preview plugin;"'
        ' P_ARTICLE_WIDTH="5.2" P_ARTICLE_HEIGHT="48" P_ARTICLE_DEPTH="42" P_ARTICLE_WEIGHT="0.007" P_ARTICLE_PRODUCTGROUP="15"'
        ' P_ARTICLE_MACRO="$(MD_MACROS)\\Orca\\TB-100.ema" P_ARTICLE_GROUPSYMBOLMACRO="$(MD_MACROS)\\Orca\\TB-100.ema"'
        ' P_ARTICLE_PICTUREFILE="$(MD_IMG)\\Orca\\TB-100.png" P_ARTICLE_EXTERNAL_DOCUMENT_1="$(MD_DOCUMENTS)\\Orca\\TB-100_en.pdf" P_PART_CREATE="FP / 26.11.2026 09:00:00">\n'
        '  <freeproperty P_ARTICLE_FREE_DATA_DESCRIPTION="en_US@Rated voltage;ko_KR@정격 전압;" pos="1" P_ARTICLE_FREE_DATA_VALUE="??_??@800 V;"/>\n'
        '  <freeproperty P_ARTICLE_FREE_DATA_DESCRIPTION="en_US@Rated current;ko_KR@정격 전류;" pos="2" P_ARTICLE_FREE_DATA_VALUE="??_??@24 A;"/>\n'
        '  <variant P_ARTICLE_VARIANT="1"><functiontemplate pos="1"/><functiontemplate pos="2"/></variant>\n'
        " </part>\n</partsmanagement>\n"
    ).encode("utf-8")
    manu = b'<?xml version="1.0" encoding="utf-8" ?>\n<partsmanagement count="1" type="EPLAN.PartsManagement">\n <address class="12" P_PART_ADDRESS_SHORTNAME="ORCA" P_PART_ADDRESS_NAME1="Orca Sample Parts (synthetic)" P_PART_ADDRESS_CITY="Nowhere"/>\n</partsmanagement>\n'
    macro = (
        '<?xml version="1.0" encoding="utf-8" ?>\n<EplanPxfRoot Name="TB-100" Type="WindowMacro" Version="2.9.0" PxfVersion="1.23" Description="Synthetic macro">\n'
        ' <EplPxfDir><EplPxfDirEntry MacroFuncType="1" VariantId="0"/><EplPxfDirEntry MacroFuncType="4" VariantId="0"/></EplPxfDir>\n'
        ' <MacroVariant MacroFuncType="1" VariantId="0"/>\n <MacroVariant MacroFuncType="4" VariantId="0"/>\n</EplanPxfRoot>\n'
    ).encode("utf-8")
    manifest = (
        '<?xml version="1.0" encoding="utf-8" ?>\n<manifest version="2.0">\n <packages>\n'
        '  <package type="part" key="ORCA.TB-100" name="ORCA.TB-100">\n   <items>\n'
        '    <item type="partxml" name="part" locator="ORCA.TB-100.part.xml"/>\n'
        '    <item type="document" name="externalDocument1" locator="Orca\\TB-100_en.pdf"/>\n'
        '    <item type="macro" name="graphicmacro" locator="Orca\\TB-100.ema"/>\n'
        '    <item type="macro" name="groupsymbolmacro" locator="Orca\\TB-100.ema"/>\n'
        '    <item type="partxml" name="manufacturer" locator="ORCA.manufacturer.xml"/>\n'
        '    <item type="picture" name="picturefile" locator="Orca\\TB-100.png"/>\n'
        "   </items>\n  </package>\n </packages>\n</manifest>\n"
    ).encode("utf-8")
    files = [
        ("items", None),
        ("items/partxml/ORCA.TB-100.part.xml", part),
        ("items/partxml/ORCA.manufacturer.xml", manu),
        ("items/picture/Orca/TB-100.png", terminal_png()),
        ("items/document/Orca/TB-100_en.pdf", tiny_pdf("TB-100 feed-through terminal", ["Synthetic data sheet for the File Preview samples.", "Rated voltage 800 V, rated current 24 A."])),
        ("items/macro/Orca/TB-100.ema", macro),
        ("manifest.xml", manifest),
    ]
    with open(p("sample.edz"), "wb") as f:
        f.write(seven_zip(files, "lzma", solid=False))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in files:
            if d:
                z.writestr(n, d)
    with open(p("sample-zip.edz"), "wb") as f:
        f.write(buf.getvalue())

    def ml(**kw):
        return "".join(f"{k}@{v};" for k, v in kw.items())

    info_props = [
        (10011, "Project description", ml(de_DE="Prüfstand", en_US="Test bench", ko_KR="시험대")),
        (10013, "Project number", "FP-0001"),
        (10015, "Company name", "Orca File Preview (synthetic)"),
        (10020, "Creator", "FP"),
        (10021, "Creation date", "1764147600"),
        (10023, "Modification date", "1764151200"),
        (10043, "Last EPLAN version", "2026.0.3"),
        (10044, "Last EPLAN build", "25581"),
    ]
    pinfo = '<?xml version="1.0" encoding="utf-8" ?>\n<Properties>\n' + "".join(f' <Property name="{n}" id="{i}" index="0" type="7">{v}</Property>\n' for i, n, v in info_props) + "</Properties>\n"
    pages = [
        ml(de_DE="Deckblatt", en_US="Title page", ko_KR="표지"),
        ml(de_DE="Inhaltsverzeichnis", en_US="Table of contents", ko_KR="목차"),
        ml(de_DE="Einspeisung 400 V", en_US="400 V feed-in", ko_KR="400 V 인입"),
        ml(de_DE="Steuerspannung 24 V", en_US="24 V control voltage", ko_KR="24 V 제어 전압"),
        ml(de_DE="Klemmenplan", en_US="Terminal diagram", ko_KR="단자 도면"),
    ]
    eod = bytearray(b"\x00" * 64)
    for i, t in enumerate(pages):
        eod += struct.pack("<IIH", 0x2B, i + 1, 0x1A) + b"EPLSND1R5Q\x00" + struct.pack("<I", 0) + t.encode("utf-8") + b"\x00" + struct.pack("<II", 1764147600, 1764151200) + bytes(24)
    bak = b'<?xml version="1.0" encoding="utf-8" ?>\n<backupinfo><prodversion>2026.0.3.25581</prodversion><appvariant>Electric P8</appvariant><comment>Synthetic backup</comment></backupinfo>\n'
    elk = "\ufeffOrca_Sample.edb\n18.0\n".encode("utf-16-le")
    zw1 = [
        ("A_BAKINFO.XML", bak),
        ("_COMMENT.TXT", b"Synthetic EPLAN project backup for the File Preview samples."),
        ("_elkfile.elk", elk),
        ("ProjectInfo.xml", pinfo.encode("utf-8")),
        ("Page.eod", bytes(eod)),
        ("Images", None),
        ("Images/orca-logo.png", terminal_png(160, 120)),
    ]
    with open(p("sample.zw1"), "wb") as f:
        f.write(seven_zip(zw1, "lzma2", solid=True, encode_header=True))
    with open(p("sample.elk"), "wb") as f:
        f.write(elk)
    # Unreadable: a 7z signature, then the archive is cut off.
    with open(p("damaged.edz"), "wb") as f:
        f.write(seven_zip(files, "lzma")[:400])
    with open(p("damaged.zx1"), "wb") as f:
        f.write(b"ZX1?" + bytes(range(256)) * 3 + "Orca damaged backup".encode() * 4)


if __name__ == "__main__":
    make_solidworks()
    make_eplan()
    for n in sorted(os.listdir(OUT)):
        if n.split(".")[-1].lower() in {"sldprt", "sldasm", "slddrw", "edz", "zw1", "elk", "zx1"}:
            print(f"{os.path.getsize(p(n)):8d}  samples/{n}")
