"""Compares the preview's slide renders with PowerPoint's own export and writes the diagnosis report.

  python tools/pptx-images/compare.py --label before [--after after]

For every case in samples/pptx-images/cases.json: truth = samples/pptx-images/truth/<deck>/sN.png (PowerPoint,
1280x720), render = samples/pptx-images/render/<label>/<deck>/sN.png (resized to 1280x720). The label strip at the
top is ignored. Metrics on the picture area:
  diff   mean absolute RGB difference (0-255) after downscaling both to 160x90 (layout/colour fidelity)
  shown  whether the render has picture content where PowerPoint has some (not blank / not just background)
Verdict: PASS diff <= 12, CLOSE <= 24, DIFFERENT above, MISSING when the picture area is blank but should not be.
Writes docs/evidence/office/pptx-images/report.md (+ report.json) and side-by-side JPEGs
(PowerPoint | preview | difference) per case and label.
"""
import argparse
import json
import os

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
DIR = os.path.join(ROOT, "samples", "pptx-images")
OUT = os.path.join(ROOT, "docs", "evidence", "office", "pptx-images")
LABEL_STRIP = 80  # px of 720: the case label text box
W, H = 1280, 720

ap = argparse.ArgumentParser()
ap.add_argument("--label", default="before")
ap.add_argument("--after")
a = ap.parse_args()
os.makedirs(OUT, exist_ok=True)
cases = json.load(open(os.path.join(DIR, "cases.json"), encoding="utf-8-sig"))


def load(path):
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("RGB")
    return im if im.size == (W, H) else im.resize((W, H), Image.LANCZOS)


def area(im):
    return im.crop((0, LABEL_STRIP, W, H))


def content(im):
    """Fraction of the picture area that differs from its dominant (background) colour."""
    small = area(im).resize((160, 80))
    px = list(small.get_flattened_data()) if hasattr(small, 'get_flattened_data') else list(small.getdata())
    bg = max(set(px), key=px.count)
    far = sum(1 for p in px if sum(abs(p[i] - bg[i]) for i in range(3)) > 40)
    return far / len(px)


def measure(case, label):
    truth = load(os.path.join(DIR, "truth", case["deck"], f"s{case['slide']}.png"))
    ren = load(os.path.join(DIR, "render", label, case["deck"], f"s{case['slide']}.png"))
    if truth is None:
        return {"verdict": "NO TRUTH"}
    if ren is None:
        return {"verdict": "NOT RENDERED"}
    t, r = area(truth).resize((160, 80)), area(ren).resize((160, 80))
    diff = sum(ImageStat.Stat(ImageChops.difference(t, r)).mean) / 3
    ct, cr = content(truth), content(ren)
    if ct > 0.02 and cr < ct * 0.25:
        verdict = "MISSING"
    elif diff <= 12:
        verdict = "PASS"
    elif diff <= 24:
        verdict = "CLOSE"
    else:
        verdict = "DIFFERENT"
    side(case, label, truth, ren)
    return {"verdict": verdict, "diff": round(diff, 1), "contentTruth": round(ct, 3), "contentRender": round(cr, 3)}


def side(case, label, truth, ren):
    w, h = 480, 270
    d = ImageChops.difference(truth, ren).convert("L").point(lambda v: min(255, v * 3))
    canvas = Image.new("RGB", (w * 3 + 20, h + 26), "white")
    for i, (im, cap) in enumerate(((truth, "PowerPoint"), (ren, f"preview ({label})"), (d.convert("RGB"), "difference x3"))):
        canvas.paste(im.resize((w, h), Image.LANCZOS), (i * (w + 10), 26))
        ImageDraw.Draw(canvas).text((i * (w + 10) + 4, 6), cap, fill="black")
    canvas.save(os.path.join(OUT, f"{case['deck'][9:]}-{case['id']}.{label}.jpg"), quality=80)


# Cases where PowerPoint's own picture is not what the preview should match.
EXPECT = {
    "ico": "PowerPoint stores the .ico but cannot display it (its export shows a 'picture can't be displayed' box); the preview shows the icon.",
    "linked": "A linked picture is not inside the file; PowerPoint's export shows its broken-link graphic here, the preview shows a placeholder with the linked path (it has no file access).",
    "jpg-cmyk": "PowerPoint applies a press (SWOP-like) profile to untagged CMYK JPEGs, so its colours are muted; browsers convert CMYK naively.",
}
labels = [a.label] + ([a.after] if a.after else [])
rows = []
for c in cases:
    row = {"deck": c["deck"], "slide": c["slide"], "id": c["id"], "label": c["label"], "powerpoint": c["status"], "note": c["note"]}
    for lb in labels:
        row[lb] = measure(c, lb) if c["status"] == "ok" else {"verdict": "N/A (PowerPoint refused)"}
    rows.append(row)
json.dump(rows, open(os.path.join(OUT, "report.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)


def cell(m):
    v = m.get("verdict", "")
    icon = {"PASS": "✅", "CLOSE": "🟡", "DIFFERENT": "🟠", "MISSING": "❌"}.get(v, "")
    return f"{icon} {v}" + (f" ({m['diff']})" if "diff" in m else "")


lines = [
    "| Case | Deck · slide | " + " | ".join(labels) + " | Side by side |",
    "| --- | --- | " + " | ".join("---" for _ in labels) + " | --- |",
]
for r in rows:
    imgs = " ".join(f"[{lb}]({r['deck'][9:]}-{r['id']}.{lb}.jpg)" for lb in labels if "diff" in r[lb])
    note = f" ¹" if r["id"] in EXPECT else ""
    lines.append(f"| {r['label']}{note} | {r['deck'][9:]} · {r['slide']} | " + " | ".join(cell(r[lb]) for lb in labels) + f" | {imgs} |")
counts = {lb: {} for lb in labels}
for r in rows:
    for lb in labels:
        v = r[lb]["verdict"].split(" ")[0]
        counts[lb][v] = counts[lb].get(v, 0) + 1
lines.append("")
lines += [f"¹ {next(r['label'] for r in rows if r['id'] == k)}: {v}  " for k, v in EXPECT.items()]
open(os.path.join(OUT, "table.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
json.dump(counts, open(os.path.join(OUT, "counts.json"), "w"), indent=1)
print("\n".join(lines))
print(json.dumps(counts))
