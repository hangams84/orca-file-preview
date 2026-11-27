"""Writes the EPLAN companion samples (synthetic, stdlib only):

  samples/eplan-project/Plant.elk          link file (UTF-16, "Plant.edb", database 18.0)
  samples/eplan-project/Plant.edb/         the project folder, shaped like EPLAN 2026's (see
                                           docs/evidence/companions-eng/README.md): ProjectInfo.xml, Page.eod
                                           with page descriptions, Article.eod with part records (plain and
                                           zlib-compressed, `33 e8 75 00 <id>` + tag `32 f3` part number),
                                           .eox index stubs, Images/orca-logo.png
  samples/sample-terminal.ema              a PXF window macro: two variants with lines, arcs, a curve,
                                           texts, a rectangle and a device black box

  python tools/make-eplan-project.py
"""
import importlib.util
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("prop", os.path.join(HERE, "make-prop-samples.py"))
prop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prop)

SAMPLES = os.path.join(HERE, "..", "samples")
OUT = os.path.join(SAMPLES, "eplan-project")
EDB = os.path.join(OUT, "Plant.edb")
os.makedirs(os.path.join(EDB, "Images"), exist_ok=True)


def ml(**kw):
    return "".join(f"{k}@{v};" for k, v in kw.items())


def article(rec_id, partnr, descr1, descr2):
    """One part record: class header, part number tag, a property block with multilingual strings."""
    b = bytearray(struct.pack("<HHI", 0xE833, 0x0075, rec_id))
    b += b"\x32\xf3" + partnr.encode("utf-8") + b"\x00"
    b += b"\x52\xf3" + b"1\x00"
    b += b"\x73\xe9" + struct.pack("<H", 3)
    b += struct.pack("<I", 0x560F) + b"0\x00"
    b += struct.pack("<I", 0x568F) + descr1.encode("utf-8") + b"\x00"
    b += struct.pack("<I", 0x572F) + descr2.encode("utf-8") + b"\x00"
    b += b"\xef\x56\x00\x00EPL\x00"
    return bytes(b)


def write(path, data):
    with open(path, "wb") as f:
        f.write(data)


def project():
    write(os.path.join(OUT, "Plant.elk"), "﻿Plant.edb\n18.0\n".encode("utf-16-le"))
    info_props = [
        (10011, "Project description", ml(de_DE="Abfüllanlage", en_US="Filling plant", ko_KR="충전 설비")),
        (10013, "Project number", "FP-0002"),
        (10015, "Company name", "Orca File Preview (synthetic)"),
        (10020, "Creator", "FP"),
        (10021, "Creation date", "1764147600"),
        (10023, "Modification date", "1764151200"),
        (10043, "Last EPLAN version", "2026.0.3"),
    ]
    pinfo = '<?xml version="1.0" encoding="utf-8" ?>\n<Properties>\n' + "".join(f' <Property name="{n}" id="{i}" index="0" type="7">{v}</Property>\n' for i, n, v in info_props) + "</Properties>\n"
    write(os.path.join(EDB, "ProjectInfo.xml"), pinfo.encode("utf-8"))
    pages = [
        ml(de_DE="Deckblatt", en_US="Title page", ko_KR="표지"),
        ml(de_DE="Einspeisung 400 V", en_US="400 V feed-in", ko_KR="400 V 인입"),
        ml(de_DE="Pumpenmotor", en_US="Pump motor", ko_KR="펌프 모터"),
        ml(de_DE="SPS Eingänge", en_US="PLC inputs", ko_KR="PLC 입력"),
    ]
    eod = bytearray(b"\x00" * 64)
    for i, t in enumerate(pages):
        eod += struct.pack("<IIH", 0x2B, i + 1, 0x1A) + b"EPLSND1R5Q\x00" + struct.pack("<I", 0) + t.encode("utf-8") + b"\x00" + struct.pack("<II", 1764147600, 1764151200) + bytes(24)
    write(os.path.join(EDB, "Page.eod"), bytes(eod))
    parts = [
        (3621, "ORCA.TB-100", ml(de_DE="Durchgangsklemme", en_US="Feed-through terminal", ko_KR="관통 단자"), ml(en_US="2.5 mm², 800 V")),
        (3622, "ORCA.MCB-C16", ml(de_DE="Leitungsschutzschalter", en_US="Circuit breaker", ko_KR="회로 차단기"), ml(en_US="C16, 1-pole")),
        (3623, "ORCA.PUMP-2K2", ml(de_DE="Pumpe", en_US="Pump motor", ko_KR="펌프 모터"), ml(en_US="2.2 kW, 400 V")),
        (3624, "ORCA.PLC-DI16", ml(de_DE="Digitaleingabe", en_US="Digital input module", ko_KR="디지털 입력 모듈"), ml(en_US="16 inputs, 24 V DC")),
        (3625, "ORCA.CABLE-3G1.5", ml(de_DE="Leitung", en_US="Cable", ko_KR="케이블"), ml(en_US="3G1.5, PVC")),
    ]
    art = bytearray(struct.pack(">HHHHHH", 0, 0x0E25, 0x75, 0x13, 0, 1) + bytes(52))
    for i, (rid, pn, d1, d2) in enumerate(parts):
        rec = article(rid, pn, d1, d2)
        if i % 2:
            art += struct.pack("<II", len(rec), 1) + zlib.compress(rec, 9)  # compressed records, as EPLAN stores many
        else:
            art += struct.pack("<II", len(rec), 0) + rec
    write(os.path.join(EDB, "Article.eod"), bytes(art))
    for name in ("Page.eox", "Article.eox", "Function.eod", "Function.eox"):
        write(os.path.join(EDB, name), b"\xfe\x53\x02\x02\x04\x04\x0f\xff" + bytes(56))
    write(os.path.join(EDB, "Images", "orca-logo.png"), prop.terminal_png(160, 120))


def macro():
    def line(i, a, b, w="0.25"):
        return f'  <O31 Build="7352" A1="31/{i}" A3="0" A404="1" A411="100" A412="0" A413="L" A414="{w}" A531="{a[0]}/{a[1]}" A532="{b[0]}/{b[1]}"/>\n'

    def arc(i, c, r, a0, a1):
        return f'  <O32 Build="7352" A1="32/{i}" A3="0" A414="0.25" A553="{a0}" A554="{a1}" A555="{c[0]}/{c[1]}" A556="{r}/0" A557="1" A558="0" A559="0"/>\n'

    def text(i, at, s, h):
        return f'  <O30 Build="7352" A1="30/{i}" A3="0" A501="{at[0]}/{at[1]}" A503="0" A506="22" A511="{s}">\n   <S54x505 A961="{h}" A966="10"/>\n  </O30>\n'

    v1 = ""
    # A two-level terminal: body, two connection circles, a jumper curve, labels, and a device black box.
    for k, (a, b) in enumerate([((100, 200), (120, 200)), ((120, 200), (120, 160)), ((120, 160), (100, 160)), ((100, 160), (100, 200)), ((100, 180), (120, 180)), ((110, 210), (110, 202)), ((110, 158), (110, 150))]):
        v1 += line(10 + k, a, b, "0.35" if k < 4 else "0.25")
    v1 += arc(20, (110, 190), 2, 0, 6.283185307179586) + arc(21, (110, 170), 2, 0, 6.283185307179586)
    v1 += arc(22, (124, 180), 4, 4.71238898038469, 1.5707963267948966)
    v1 += '  <O34 Build="7352" A1="34/23" A414="0.25" A621="100/150;104/146;116/146;120/150" A622="0;0;0;0" A623="1" A624="1"/>\n'
    v1 += text(30, (101, 203), ml(en_US="-X1", de_DE="-X1"), 2.5) + text(31, (113, 189), "??_??@1;", 2) + text(32, (113, 169), "??_??@2;", 2)
    v1 += text(33, (126, 179), ml(en_US="Jumper", de_DE="Brücke", ko_KR="점퍼"), 1.8)
    v1 += '  <O17 Build="8366" A1="17/40" A3="1" A190="0/-60" A191="40/0">\n   <S40x1201 A762="95/215"><S39x761 A751="1"/></S40x1201>\n   <S89x5 A1651="0/-70" A1652="40/0"/>\n  </O17>\n'
    v2 = '  <O89 Build="7352" A1="89/50" A414="0.35" A1651="0/0" A1652="5.2/48"/>\n' + text(51, (0.5, 50), ml(en_US="TB-100 (panel)", ko_KR="TB-100 (패널)"), 2)
    v2 += line(52, (0, 6), (5.2, 6)) + line(53, (0, 42), (5.2, 42))
    xml = (
        '<?xml version="1.0" encoding="utf-8" ?>\n<EplanPxfRoot Name="Orca-Terminal" Type="WindowMacro" Version="2.9.0" PxfVersion="1.23" Description="Synthetic macro for the File Preview samples">\n'
        ' <EplPxfDir>\n  <EplPxfDirEntry MacroFuncType="1" VariantId="0"/>\n  <EplPxfDirEntry MacroFuncType="4" VariantId="0"/>\n </EplPxfDir>\n'
        ' <MacroVariant MacroFuncType="1" VariantId="0" ReferencePoint="100/200/0" Description="" SelectionArea="95/215/135/145">\n'
        '  <ESymLib Name="SPECIAL" ID="0"/>\n' + v1 + " </MacroVariant>\n"
        ' <MacroVariant MacroFuncType="4" VariantId="0" ReferencePoint="0/0/0" Description="Panel layout">\n' + v2 + " </MacroVariant>\n</EplanPxfRoot>\n"
    )
    write(os.path.join(SAMPLES, "sample-terminal.ema"), xml.encode("utf-8"))


if __name__ == "__main__":
    project()
    macro()
    for root, _dirs, files in os.walk(OUT):
        for n in sorted(files):
            print(f"{os.path.getsize(os.path.join(root, n)):8d}  {os.path.relpath(os.path.join(root, n), SAMPLES)}")
    print(f"{os.path.getsize(os.path.join(SAMPLES, 'sample-terminal.ema')):8d}  sample-terminal.ema")
