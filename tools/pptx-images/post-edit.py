"""Post-edits the PowerPoint-built picture decks where COM has no API (run by tools/make-pptx-images.ps1):
  - placements: fill the picture placeholder (python-pptx insert_picture)
  - specs: negative crop (srcRect < 0), duotone recolour, 50 % picture transparency (alphaModFix)
  - extracts the EMF/WMF parts of the formats deck to inputs/ so Word can insert the same metafiles.
PowerPoint then re-exports the truth from the edited files, so the ground truth stays PowerPoint's."""
import json
import os
import shutil

from lxml import etree
from pptx import Presentation
from pptx.enum.shapes import PP_PLACEHOLDER

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
DIR = os.path.join(ROOT, "samples", "pptx-images")
IN = os.path.join(DIR, "inputs")
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
cases = json.load(open(os.path.join(DIR, "cases.json"), encoding="utf-8-sig"))


def slide_of(deck, case_id):
    for c in cases:
        if c["deck"] == deck and c["id"] == case_id:
            return c["slide"]
    raise KeyError(case_id)


def first_blip(slide):
    for pic in slide.shapes:
        el = pic._element
        blips = el.findall(f".//{{{A}}}blip")
        if blips:
            return pic, blips[0]
    raise LookupError("no picture")


# ---- placements: picture placeholder
path = os.path.join(DIR, "pptx-img-placements.pptx")
prs = Presentation(path)
s = prs.slides[slide_of("pptx-img-placements", "placeholder") - 1]
for ph in s.placeholders:
    if ph.placeholder_format.type == PP_PLACEHOLDER.PICTURE:
        ph.insert_picture(os.path.join(IN, "png-rgb.png"))
        break
else:
    raise LookupError("no picture placeholder")
prs.save(path)
print("placements: placeholder filled")

# ---- specs: negative crop, duotone, alpha
path = os.path.join(DIR, "pptx-img-specs.pptx")
prs = Presentation(path)
pic, blip = first_blip(prs.slides[slide_of("pptx-img-specs", "crop-negative") - 1])
blip_fill = blip.getparent()
src = blip_fill.find(f"{{{A}}}srcRect")
if src is None:
    src = etree.SubElement(blip_fill, f"{{{A}}}srcRect")
    blip_fill.remove(src)
    blip_fill.insert(list(blip_fill).index(blip) + 1, src)
for k, v in (("l", "-25000"), ("r", "-25000"), ("t", "-10000"), ("b", "-10000")):
    src.set(k, v)

pic, blip = first_blip(prs.slides[slide_of("pptx-img-specs", "duotone") - 1])
duo = etree.fromstring(
    f'<a:duotone xmlns:a="{A}"><a:prstClr val="black"/><a:schemeClr val="accent1"><a:tint val="45000"/><a:satMod val="400000"/></a:schemeClr></a:duotone>'
)
blip.insert(0, duo)

pic, blip = first_blip(prs.slides[slide_of("pptx-img-specs", "alpha-50") - 1])
# the backdrop rectangle is the first shape; the picture comes after it
blips = [b for sh in prs.slides[slide_of("pptx-img-specs", "alpha-50") - 1].shapes for b in sh._element.findall(f".//{{{A}}}blip")]
amf = etree.SubElement(blips[-1], f"{{{A}}}alphaModFix")
amf.set("amt", "50000")
blips[-1].remove(amf)
blips[-1].insert(0, amf)
prs.save(path)
print("specs: negative crop, duotone, alpha")

# ---- metafiles for Word
prs = Presentation(os.path.join(DIR, "pptx-img-formats.pptx"))
for cid in ("emf-shapes", "emf-bitmap"):  # the WMF inputs are hand-written already
    c = next(c for c in cases if c["id"] == cid)
    if c["status"] != "ok":
        continue
    slide = prs.slides[c["slide"] - 1]
    for sh in slide.shapes:
        if sh.shape_type == 13:  # picture
            part = sh.image
            ext = str(part.partname).rsplit('.', 1)[-1]  # part.ext misreports EMF as wmf
            open(os.path.join(IN, f"{cid}.{ext}"), "wb").write(part.blob)
            print(f"extracted {cid}.{ext} ({len(part.blob):,} bytes, {part.content_type})")
            break
