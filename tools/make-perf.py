"""Large inputs for performance checks of the Office renderers (outputs are git-ignored).

Writes samples/perf/:
  perf-300pages.docx  ~300 pages of text with 50 tables and 30 images
  perf-250slides.pptx 250 slides with pictures and tables
Spreadsheets are written by tools/make-perf-sheets.mjs (SheetJS handles 2M cells and merges faster).
Needs: python-docx, python-pptx, Pillow.   Usage: python tools/make-perf.py
"""
import io
import os
import random

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "samples", "perf")
os.makedirs(OUT, exist_ok=True)
random.seed(7)
WORDS = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore "
         "et dolore magna aliqua 한글 미리보기 성능 시험 문단 가나다라 마바사 아자차카").split()


def picture(i, w=640, h=360):
    img = Image.new("RGB", (w, h), (30 + (i * 37) % 200, 60 + (i * 53) % 180, 120 + (i * 29) % 130))
    d = ImageDraw.Draw(img)
    for k in range(12):
        d.ellipse([k * 50, (k * 23) % h, k * 50 + 80, (k * 23) % h + 80], fill=(255, 220 - k * 10, 40))
    d.text((12, 12), f"image {i}", fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    buf.seek(0)
    return buf


def sentence(n):
    return " ".join(random.choice(WORDS) for _ in range(n)).capitalize() + "."


def make_docx():
    from docx import Document
    from docx.shared import Inches
    from docx.enum.text import WD_BREAK

    doc = Document()
    doc.add_heading("Performance sample — 300 pages", 0)
    tables = images = 0
    for page in range(1, 301):
        doc.add_heading(f"Page {page}", level=1)
        for _ in range(5):
            doc.add_paragraph(sentence(60))
        if page % 6 == 0 and tables < 50:
            t = doc.add_table(rows=6, cols=4)
            t.style = "Light Grid Accent 1"
            for r in range(6):
                for c in range(4):
                    t.cell(r, c).text = f"R{r}C{c} {random.randint(0, 9999)}"
            tables += 1
        if page % 10 == 0 and images < 30:
            doc.add_picture(picture(page), width=Inches(4))
            images += 1
        doc.paragraphs[-1].add_run().add_break(WD_BREAK.PAGE)
    doc.save(os.path.join(OUT, "perf-300pages.docx"))
    print("docx", tables, "tables", images, "images")


def make_pptx():
    from pptx import Presentation
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    for i in range(1, 251):
        s = prs.slides.add_slide(prs.slide_layouts[5])  # title only
        s.shapes.title.text = f"Slide {i} — 슬라이드 {i}"
        s.shapes.add_picture(picture(i, 960, 540), Inches(0.5), Inches(1.6), width=Inches(6))
        rows, cols = 5, 3
        t = s.shapes.add_table(rows, cols, Inches(7), Inches(1.6), Inches(5.8), Inches(2.5)).table
        for r in range(rows):
            for c in range(cols):
                t.cell(r, c).text = f"{r}-{c} {random.randint(0, 999)}"
        tb = s.shapes.add_textbox(Inches(7), Inches(4.6), Inches(5.8), Inches(2))
        tb.text_frame.word_wrap = True
        tb.text_frame.text = sentence(30)
        tb.text_frame.paragraphs[0].runs[0].font.size = Pt(16)
        s.notes_slide.notes_text_frame.text = f"Notes {i}"
    prs.save(os.path.join(OUT, "perf-250slides.pptx"))
    print("pptx 250 slides")


if __name__ == "__main__":
    make_docx()
    make_pptx()
