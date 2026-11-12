"""Generates the preview test fixtures in samples/.

Needs: python-docx, python-pptx, openpyxl, Pillow (pip install python-docx python-pptx openpyxl pillow)
and LibreOffice (`soffice`) for the legacy binary formats (.doc, .ppt, .xls) and the PDF.
Usage: python tools/make-samples.py [--soffice PATH]
"""
import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "samples")
KO = "한글 미리보기 테스트 - 가나다라마바사"


def p(name):
    return os.path.join(OUT, name)


def png_bytes(w=320, h=180, label="Orca"):
    img = Image.new("RGB", (w, h), (36, 99, 235))
    d = ImageDraw.Draw(img)
    for i in range(0, w, 20):
        d.line([(i, 0), (i, h)], fill=(59, 130, 246))
    d.ellipse([w // 2 - 50, h // 2 - 50, w // 2 + 50, h // 2 + 50], fill=(250, 204, 21))
    d.text((10, 10), label, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def make_docx():
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor

    doc = Document()
    doc.add_heading("File Preview — Word sample", 0)
    doc.add_paragraph(KO)
    para = doc.add_paragraph("Mixed ")
    para.add_run("bold").bold = True
    para.add_run(", ")
    para.add_run("italic").italic = True
    r = para.add_run(" and coloured text.")
    r.font.color.rgb = RGBColor(0xC0, 0x26, 0x26)
    r.font.size = Pt(14)
    doc.add_heading("Table", level=1)
    t = doc.add_table(rows=4, cols=3)
    t.style = "Light Grid Accent 1"
    for i, row in enumerate([("항목", "수량", "가격"), ("사과", "3", "1,500"), ("배", "2", "3,000"), ("합계", "5", "4,500")]):
        for j, v in enumerate(row):
            t.cell(i, j).text = v
    doc.add_heading("Image", level=1)
    doc.add_picture(io.BytesIO(png_bytes()), width=Inches(3))
    doc.add_heading("List", level=1)
    for s in ["First bullet", "두 번째 항목", "Third bullet"]:
        doc.add_paragraph(s, style="List Bullet")
    doc.add_page_break()
    doc.add_heading("Page 2", level=1)
    for i in range(12):
        doc.add_paragraph(f"Paragraph {i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. {KO}")
    doc.save(p("sample.docx"))


def make_pptx():
    from pptx import Presentation
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = "File Preview — Slides"
    s.placeholders[1].text = KO
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Bullets"
    tf = s.placeholders[1].text_frame
    tf.text = "First point"
    for t in ["두 번째 요점", "Third point with a longer sentence to wrap"]:
        tf.add_paragraph().text = t
    s.notes_slide.notes_text_frame.text = "Speaker notes for slide 2"
    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Image and table"
    s.shapes.add_picture(io.BytesIO(png_bytes()), Inches(0.5), Inches(1.6), width=Inches(5))
    tbl = s.shapes.add_table(3, 3, Inches(6.5), Inches(1.6), Inches(6), Inches(1.5)).table
    for i, row in enumerate([("Q", "Sales", "Growth"), ("Q1", "120", "5%"), ("Q2", "150", "25%")]):
        for j, v in enumerate(row):
            tbl.cell(i, j).text = v
    box = s.shapes.add_textbox(Inches(0.5), Inches(5.6), Inches(12), Inches(1)).text_frame
    box.text = "A free text box — 텍스트 상자"
    box.paragraphs[0].runs[0].font.size = Pt(24)
    prs.save(p("sample.pptx"))


def make_xlsx():
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "매출"
    ws.append(["월", "제품", "수량", "단가", "금액"])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="2563EB")
    rows = [("1월", "사과", 10, 1500), ("1월", "배", 4, 3000), ("2월", "사과", 7, 1500), ("2월", "포도", 12, 5000)]
    for i, r in enumerate(rows, start=2):
        ws.append(list(r) + [f"=C{i}*D{i}"])
    ws.append(["합계", "", "=SUM(C2:C5)", "", "=SUM(E2:E5)"])
    ws.merge_cells("A6:B6")
    ws["A6"].alignment = Alignment(horizontal="center")
    ws.column_dimensions["B"].width = 14
    ws2 = wb.create_sheet("Data")
    ws2.append(["id", "value", "date", "note"])
    for i in range(1, 201):
        ws2.append([i, i * i, f"2026-01-{(i % 28) + 1:02d}", f"row {i}"])
    wb.create_sheet("Empty")
    wb.save(p("sample.xlsx"))


def make_text():
    lines = ["File Preview — text sample", KO, "", "Tabs:\tone\ttwo", "Long line: " + "word " * 60]
    lines += [f"line {i}" for i in range(1, 301)]
    with open(p("sample.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    with open(p("sample-euckr.txt"), "w", encoding="cp949", newline="\r\n") as f:
        f.write("EUC-KR(CP949) 인코딩 텍스트 파일입니다.\n" + KO + "\n")
    with open(p("sample.log"), "w", encoding="utf-8") as f:
        f.write("\n".join(f"2026-11-12T03:{i // 60:02d}:{i % 60:02d}Z INFO step {i}" for i in range(120)) + "\n")


def make_csv():
    rows = [["이름", "도시", "점수", "메모"], ["김철수", "서울", "92", 'quoted "text", with comma'], ["Jane Doe", "Busan", "88", "multi\nline"]]
    rows += [[f"사용자{i}", "대전" if i % 2 else "Daegu", str(50 + i % 50), f"note {i}"] for i in range(1, 501)]

    def enc(r, sep):
        out = []
        for v in r:
            if any(ch in v for ch in [sep, '"', "\n"]):
                v = '"' + v.replace('"', '""') + '"'
            out.append(v)
        return sep.join(out)

    body = "\r\n".join(enc(r, ",") for r in rows) + "\r\n"
    with open(p("sample.csv"), "w", encoding="utf-8-sig", newline="") as f:
        f.write(body)
    with open(p("sample-euckr.csv"), "w", encoding="cp949", newline="") as f:
        f.write(body)
    with open(p("sample.tsv"), "w", encoding="utf-8", newline="") as f:
        f.write("\n".join("\t".join(c.replace("\n", " ") for c in r) for r in rows[:50]) + "\n")
    with open(p("sample-semicolon.csv"), "w", encoding="utf-8", newline="") as f:
        f.write("a;b;c\n1;2,5;3\n4;5;6\n")


def make_html():
    html = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>HTML sample</title>
<style>
 body {{ font-family: sans-serif; margin: 24px; }}
 h1 {{ color: #2563eb; }}
 table {{ border-collapse: collapse; }} td, th {{ border: 1px solid #999; padding: 4px 8px; }}
 .box {{ padding: 12px; background: #fef3c7; border-radius: 8px; }}
</style></head>
<body>
<h1>File Preview — HTML sample</h1>
<p>{KO}</p>
<div class="box">Styled box. <a href="https://example.com">A link</a></div>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<svg width="80" height="80"><circle cx="40" cy="40" r="30" fill="#16a34a"/></svg>
<p id="js">Scripts must NOT run in the preview: this text stays.</p>
<script>document.getElementById('js').textContent = 'SCRIPT RAN (unsafe)';</script>
<img src="x" onerror="document.body.style.background='red'">
</body></html>
"""
    with open(p("sample.html"), "w", encoding="utf-8") as f:
        f.write(html)


def make_svg():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" width="400" height="240">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#9333ea"/></linearGradient></defs>
  <rect width="400" height="240" rx="16" fill="url(#g)"/>
  <circle cx="300" cy="120" r="70" fill="#facc15"/>
  <text x="24" y="70" font-size="32" font-family="sans-serif" fill="#fff">SVG 미리보기</text>
  <text x="24" y="110" font-size="16" font-family="sans-serif" fill="#e0e7ff">File Preview sample</text>
  <script>document.querySelector('text').textContent='SCRIPT RAN'</script>
</svg>
"""
    with open(p("sample.svg"), "w", encoding="utf-8") as f:
        f.write(svg)


def make_images():
    frames = []
    for i in range(12):
        im = Image.new("RGB", (160, 120), (15, 23, 42))
        d = ImageDraw.Draw(im)
        x = 10 + i * 10
        d.ellipse([x, 40, x + 40, 80], fill=(250, 204, 21))
        d.text((8, 8), f"frame {i + 1}", fill=(255, 255, 255))
        frames.append(im.convert("P"))
    frames[0].save(p("sample.gif"), save_all=True, append_images=frames[1:], duration=120, loop=0)
    im = Image.open(io.BytesIO(png_bytes(640, 360, "BMP sample"))).convert("RGB")
    im.save(p("sample.bmp"))


def soffice_convert(soffice, src, fmt, dest):
    tmp = tempfile.mkdtemp()
    profile = tempfile.mkdtemp()
    subprocess.run(
        [soffice, f"-env:UserInstallation=file:///{profile.replace(os.sep, '/')}", "--headless", "--convert-to", fmt, "--outdir", tmp, src],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=180,
    )
    out = [f for f in os.listdir(tmp)]
    if not out:
        raise RuntimeError(f"soffice produced nothing for {src} -> {fmt}")
    shutil.move(os.path.join(tmp, out[0]), dest)


def make_legacy(soffice):
    soffice_convert(soffice, p("sample.docx"), "doc:MS Word 97", p("sample.doc"))
    soffice_convert(soffice, p("sample.pptx"), "ppt:MS PowerPoint 97", p("sample.ppt"))
    soffice_convert(soffice, p("sample.xlsx"), "xls:MS Excel 97", p("sample.xls"))
    soffice_convert(soffice, p("sample.docx"), "pdf:writer_pdf_Export", p("sample.pdf"))
    soffice_convert(soffice, p("sample.pptx"), "pdf:impress_pdf_Export", p("sample-slides.pdf"))


def make_broken():
    with open(p("broken.docx"), "wb") as f:
        f.write(b"PK\x03\x04 this is not a real zip archive")
    with open(p("broken.pdf"), "wb") as f:
        f.write(b"%PDF-1.7\n garbage")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--soffice", default=shutil.which("soffice") or r"C:\Program Files\LibreOffice\program\soffice.exe")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    make_docx()
    make_pptx()
    make_xlsx()
    make_text()
    make_csv()
    make_html()
    make_svg()
    make_images()
    make_broken()
    if a.soffice and os.path.exists(a.soffice):
        make_legacy(a.soffice)
    else:
        print("LibreOffice not found: skipped .doc, .ppt, .xls and .pdf", file=sys.stderr)
    for f in sorted(os.listdir(OUT)):
        print(f"{f:28} {os.path.getsize(p(f)):>9,} B")


if __name__ == "__main__":
    main()
