"""Ground truth for the fidelity report, written to samples/fidelity/truth/<name>.json.

  .doc  -> from the reference PDF made by Word (tools/fidelity/make-doc-fixtures.ps1) or LibreOffice:
           page sizes and every text line (text, left, top, baseline, font size) in points; page 1 as PNG.
  .hwp  -> from Hangul's own saved layout inside the file: PAGE_DEF and PARA_LINE_SEG records of the
           top-level paragraphs (HWPUNIT, 100 per point), independent of the plugin's parser.
  .hwpx -> the same from <hp:pagePr>/<hp:margin> and <hp:lineseg> in Contents/section*.xml.
Needs: pip install pymupdf olefile.   Usage: python tools/fidelity/truth.py
"""
import glob
import json
import os
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FID = os.path.join(ROOT, "samples", "fidelity")
TRUTH = os.path.join(FID, "truth")
os.makedirs(TRUTH, exist_ok=True)


def write(name, data):
    with open(os.path.join(TRUTH, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


# --------------------------------------------------------------------------------------- PDF (.doc)
def pdf_truth():
    import pymupdf as fitz

    sources = {}
    sp = os.path.join(TRUTH, "sources.json")
    if os.path.exists(sp):
        sources = json.load(open(sp, encoding="utf-8"))
    for pdf in sorted(glob.glob(os.path.join(TRUTH, "*.pdf"))):
        name = os.path.splitext(os.path.basename(pdf))[0]
        doc = fitz.open(pdf)
        pages = []
        for pno, page in enumerate(doc):
            lines = []
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    spans = [s for s in line["spans"] if s["text"].strip()]
                    if not spans:
                        continue
                    text = "".join(s["text"] for s in line["spans"]).strip()
                    x0 = min(s["bbox"][0] for s in spans)
                    y0 = min(s["bbox"][1] for s in spans)
                    base = max(s["origin"][1] for s in spans)
                    size = max(s["size"] for s in spans)
                    lines.append({"text": text, "x": round(x0, 2), "y": round(y0, 2), "base": round(base, 2), "size": round(size, 2), "font": spans[0]["font"]})
            lines.sort(key=lambda l: (round(l["base"]), l["x"]))
            pages.append({"w": round(page.rect.width, 2), "h": round(page.rect.height, 2), "lines": lines})
            if pno == 0:
                page.get_pixmap(dpi=96).save(os.path.join(TRUTH, name + ".p1.png"))
        write(name, {"format": "doc", "source": sources.get(name, "Microsoft Word 2021 (PDF export)"), "pages": pages})
        print(f"pdf   {name}: {len(pages)} pages, {sum(len(p['lines']) for p in pages)} lines")


# --------------------------------------------------------------------------------------- HWP 5
HWPTAG_BEGIN = 0x10
PARA_HEADER, PARA_TEXT, PARA_LINE_SEG, PAGE_DEF = HWPTAG_BEGIN + 50, HWPTAG_BEGIN + 51, HWPTAG_BEGIN + 53, HWPTAG_BEGIN + 57
# Control characters that occupy 8 WCHARs in PARA_TEXT (extended and inline controls).
WIDE = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}


def records(data):
    i = 0
    while i + 4 <= len(data):
        (h,) = struct.unpack_from("<I", data, i)
        tag, level, size = h & 0x3FF, (h >> 10) & 0x3FF, h >> 20
        i += 4
        if size == 0xFFF:
            (size,) = struct.unpack_from("<I", data, i)
            i += 4
        yield tag, level, data[i : i + size]
        i += size


def wchars_to_text(raw):
    """PARA_TEXT -> list of (wchar position, character) for visible characters."""
    out = []
    n = len(raw) // 2
    k = 0
    while k < n:
        (c,) = struct.unpack_from("<H", raw, k * 2)
        if c < 32:
            if c in WIDE:
                k += 8
                continue
            if c in (10, 13):
                k += 1
                continue
            out.append((k, " " if c in (24, 25, 26, 27, 28, 29, 30, 31) else ""))
            k += 1
            continue
        out.append((k, chr(c)))
        k += 1
    return out


def lines_from_paragraph(chars, segs, unit):
    lines = []
    for idx, s in enumerate(segs):
        start = s["textpos"]
        end = segs[idx + 1]["textpos"] if idx + 1 < len(segs) else 1 << 30
        text = "".join(ch for pos, ch in chars if start <= pos < end).strip()
        lines.append({**s, "text": text})
    return lines


def page_lines(paras, page, unit):
    """Assigns paragraph lines to pages (a vertical position that jumps back up starts a new page)."""
    pages = [{"w": page["w"], "h": page["h"], "margins": page["margins"], "lines": []}]
    last = -1
    body_top = page["margins"]["top"] + page["margins"]["header"]
    left = page["margins"]["left"]
    for p in paras:
        for ln in p:
            if last >= 0 and ln["vertpos"] < last - unit * 2:
                pages.append({"w": page["w"], "h": page["h"], "margins": page["margins"], "lines": []})
            last = ln["vertpos"]
            if not ln["text"]:
                continue
            pages[-1]["lines"].append({
                "text": ln["text"],
                "x": round((left + ln["horzpos"]) / unit, 2),
                "y": round((body_top + ln["vertpos"] + ln["vertsize"] - ln["textheight"]) / unit, 2),
                "base": round((body_top + ln["vertpos"] + ln["baseline"]) / unit, 2),
                "size": round(ln["textheight"] / unit, 2),
                "lineHeight": round(ln["vertsize"] / unit, 2),
                "width": round(ln["horzsize"] / unit, 2),
            })
    return pages


def hwp_truth(path):
    import olefile

    name = os.path.splitext(os.path.basename(path))[0]
    ole = olefile.OleFileIO(path)
    header = ole.openstream("FileHeader").read()
    if not header.startswith(b"HWP Document File"):
        return write(name, {"format": "hwp", "refuse": "not-hwp5"})
    (version,) = struct.unpack_from("<I", header, 32)
    (flags,) = struct.unpack_from("<I", header, 36)
    if flags & 0x2:
        return write(name, {"format": "hwp", "refuse": "password"})
    if flags & 0x4:
        return write(name, {"format": "hwp", "refuse": "distribution"})
    compressed = bool(flags & 0x1)
    sections = sorted([e for e in ole.listdir() if e[0] == "BodyText"], key=lambda e: int(e[1].replace("Section", "")))
    page = None
    paras = []
    for sec in sections:
        data = ole.openstream(sec).read()
        if compressed:
            data = zlib.decompress(data, -15)
        chars, segs = None, None
        for tag, level, body in records(data):
            if tag == PAGE_DEF and page is None:
                w, h, l, r, t, b, hd, ft, gt = struct.unpack_from("<9I", body, 0)
                page = {"w": w / 100, "h": h / 100, "margins": {"left": l, "right": r, "top": t, "bottom": b, "header": hd, "footer": ft, "gutter": gt}}
            # Top-level body paragraphs only: their PARA_HEADER is level 0 and its records level 1;
            # paragraphs inside tables, boxes and notes nest deeper and have their own frames.
            if tag == PARA_HEADER:
                if chars is not None and segs:
                    paras.append(lines_from_paragraph(chars, segs, 100))
                chars, segs = ([], []) if level == 0 else (None, None)
            elif level != 1:
                continue
            elif tag == PARA_TEXT and chars is not None:
                chars = wchars_to_text(body)
            elif tag == PARA_LINE_SEG and segs is not None:
                for k in range(len(body) // 36):
                    v = struct.unpack_from("<I7iI", body, k * 36)
                    segs.append(dict(zip(["textpos", "vertpos", "vertsize", "textheight", "baseline", "spacing", "horzpos", "horzsize", "flags"], v)))
        if chars is not None and segs:
            paras.append(lines_from_paragraph(chars, segs, 100))
    if page is None:
        return write(name, {"format": "hwp", "refuse": "no-page-def"})
    pages = page_lines(paras, page, 100)
    for p in pages:
        p["w"], p["h"] = page["w"], page["h"]
        p["margins"] = {k: v / 100 for k, v in page["margins"].items()}
    write(name, {"format": "hwp", "version": f"{version >> 24}.{(version >> 16) & 255}.{(version >> 8) & 255}.{version & 255}", "source": "Hangul layout saved in the file (PARA_LINE_SEG)", "pages": pages})
    print(f"hwp   {name}: {len(pages)} pages, {sum(len(p['lines']) for p in pages)} lines")


# --------------------------------------------------------------------------------------- HWPX
HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def hwpx_truth(path):
    name = os.path.splitext(os.path.basename(path))[0]
    z = zipfile.ZipFile(path)
    secs = sorted([n for n in z.namelist() if n.startswith("Contents/section") and n.endswith(".xml")], key=lambda n: int("".join(c for c in n if c.isdigit()) or 0))
    page = None
    paras = []
    for s in secs:
        root = ET.fromstring(z.read(s))
        if page is None:
            pp = root.find(f".//{HP}pagePr")
            if pp is not None:
                m = pp.find(f"{HP}margin")
                g = lambda k: int(m.get(k, 0)) if m is not None else 0
                page = {"w": int(pp.get("width")), "h": int(pp.get("height")), "margins": {k: g(k) for k in ("left", "right", "top", "bottom", "header", "footer", "gutter")}}
        for p in root.findall(f"{HP}p"):  # top-level paragraphs of the section
            text = []
            for run in p.findall(f"{HP}run"):
                for t in run.findall(f"{HP}t"):
                    text.append("".join(t.itertext()))
            plain = "".join(text)
            chars = list(enumerate(plain))
            segs = []
            arr = p.find(f"{HP}linesegarray")
            if arr is not None:
                for ls in arr.findall(f"{HP}lineseg"):
                    segs.append({k: int(ls.get(k, 0)) for k in ("textpos", "vertpos", "vertsize", "textheight", "baseline", "spacing", "horzpos", "horzsize", "flags")})
            if segs:
                paras.append(lines_from_paragraph(chars, segs, 100))
    if page is None:
        return write(name, {"format": "hwpx", "refuse": "no-page-def"})
    pages = page_lines(paras, page, 100)
    for p in pages:
        p["w"], p["h"] = page["w"] / 100, page["h"] / 100
        p["margins"] = {k: v / 100 for k, v in page["margins"].items()}
    write(name, {"format": "hwpx", "source": "Hangul layout saved in the file (<hp:lineseg>)", "pages": pages})
    print(f"hwpx  {name}: {len(pages)} pages, {sum(len(p['lines']) for p in pages)} lines")


if __name__ == "__main__":
    pdf_truth()
    for f in sorted(glob.glob(os.path.join(FID, "hwp", "*.hwp"))):
        try:
            hwp_truth(f)
        except Exception as e:  # report and continue
            print(f"hwp   {os.path.basename(f)}: ERROR {e}", file=sys.stderr)
    for f in sorted(glob.glob(os.path.join(FID, "hwpx", "*.hwpx"))):
        try:
            hwpx_truth(f)
        except Exception as e:
            print(f"hwpx  {os.path.basename(f)}: ERROR {e}", file=sys.stderr)
