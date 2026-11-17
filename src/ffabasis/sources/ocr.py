"""OCR of report pages whose table text cannot be extracted.

Some Banchero Costa issues were uploaded to Hellenic Shipping News as
"_compressed" PDFs whose tables are set in font subsets with no Unicode map,
so their text extracts as symbols. Those pages are rendered with pdfium at
four times their size and read with Tesseract 5 (page segmentation mode 6, a
uniform block of text); the lines are then parsed by the same patterns as
extracted text. Every OCR figure is checked against what the page itself
prints beside it (ffabasis.panel): the week-on-week change and the premium
to the day's spot, so a misread digit is caught rather than used.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import pypdfium2 as pdfium

SCALE = 4
ENGINE = "tesseract"


def page_text(
    pdf_path: Path, page_index: int, left: float = 0.0, right: float = 1.0, top: float = 0.0, bottom: float = 1.0
) -> str:
    """Tesseract's text of a region of one page (fractions of the page's width and height)."""
    document = pdfium.PdfDocument(str(pdf_path))
    try:
        image = document[page_index].render(scale=SCALE).to_pil()
    finally:
        document.close()
    width, height = image.size
    crop = image.crop((int(left * width), int(top * height), int(right * width), int(bottom * height)))
    with tempfile.TemporaryDirectory() as folder:
        png = Path(folder) / "page.png"
        crop.save(png)
        result = subprocess.run(
            [ENGINE, str(png), "stdout", "--psm", "6", "-l", "eng"],
            check=True,
            capture_output=True,
            text=True,
        )
    return result.stdout


def available() -> bool:
    try:
        subprocess.run([ENGINE, "--version"], check=True, capture_output=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False
