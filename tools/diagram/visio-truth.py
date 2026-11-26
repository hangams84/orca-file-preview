"""Second-opinion renders of the Visio samples with LibreOffice (libvisio), since Microsoft Visio is
not installed here: each .vsdx → PDF (soffice --headless) → one PNG per page at 96 dpi (PyMuPDF).

    python tools/diagram/visio-truth.py <evidence dir> [files...]

Writes <dir>/truth/<file>.p<N>.png, the naming tools/diagram/fidelity.mjs uses for our renders.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]) / "truth"
out.mkdir(parents=True, exist_ok=True)
files = [Path(f) for f in sys.argv[2:]] or sorted((ROOT / "samples" / "diagram").glob("*.vsdx")) + [ROOT / "samples" / "sample.vsdx"]
soffice = shutil.which("soffice") or r"C:\Program Files\LibreOffice\program\soffice.exe"

with tempfile.TemporaryDirectory() as tmp:
    for f in files:
        # A private profile keeps the run independent of (and from disturbing) a running LibreOffice.
        subprocess.run([soffice, f"-env:UserInstallation=file:///{tmp}/profile".replace("\\", "/"), "--headless", "--convert-to", "pdf", "--outdir", tmp, str(f)],
                       check=True, capture_output=True, timeout=180)
        pdf = Path(tmp) / (f.stem + ".pdf")
        doc = fitz.open(pdf)
        for i, page in enumerate(doc):
            page.get_pixmap(dpi=96, alpha=False).save(out / f"{f.name}.p{i + 1}.png")
        print(f"{f.name}: {len(doc)} page(s)")
        doc.close()
