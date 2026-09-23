"""Pull the PO number and pre-tax total out of a folder of vendor invoice PDFs.

    pip install pypdf
    python extract-invoices.py C:\\Users\\AntonioClair\\ap-invoices

Writes invoices.csv next to the PDFs: file, po, net, gross, invoice_no.

Why this exists: having a model read 48 PDFs to find two numbers each is slow
and expensive. A script does it in seconds, and the model then looks at 48 rows
instead of 48 documents.

It reads only. It never writes to the ERP.

Fields it cannot find are left blank rather than guessed — a blank is a prompt
to look, a wrong number is a wrong invoice.
"""

import csv
import re
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf not installed.  Run:  pip install pypdf")

# Talius POs are PO26xxxx / 26xxxx. Vendors write them many ways:
#   "PO260639"  "PO 260639"  "Purchase Order No. 260650"  "Cust PO#: 260624"
PO_PATTERNS = [
    re.compile(r"\bPO[\s#:\-]*?(\d{6})\b", re.I),
    re.compile(r"purchase\s+order\s*(?:no\.?|number|#)?[\s:]*?(\d{6})\b", re.I),
    re.compile(r"cust(?:omer)?\s*(?:order)?\s*(?:ref|po)?[\s#:]*?(\d{6})\b", re.I),
    re.compile(r"\b(26\d{4})\b"),          # last resort: a bare 26xxxx
]

# Pre-tax total. Deliberately NOT the grand total — Seradex computes its own tax,
# so the net is what has to agree.
NET_PATTERNS = [
    re.compile(r"(?:total\s+)?net\s+amount[\s:]*\$?([\d,]+\.\d{2})", re.I),
    re.compile(r"sub[\s\-]?total[\s:]*\$?([\d,]+\.\d{2})", re.I),
    re.compile(r"net\s+value[\s:]*\$?([\d,]+\.\d{2})", re.I),
]
GROSS_PATTERNS = [
    re.compile(r"total\s+amount[\s:]*\$?([\d,]+\.\d{2})", re.I),
    re.compile(r"(?:please\s+remit\s+this\s+amount|amount\s+due|grand\s+total)"
               r"[\s:]*\$?([\d,]+\.\d{2})", re.I),
]
INV_PATTERNS = [
    re.compile(r"invoice\s*(?:no\.?|number|#)[\s:]*([A-Z0-9][A-Z0-9\-/]{3,})", re.I),
    re.compile(r"document\s+number[\s:]*([A-Z0-9][A-Z0-9\-/]{3,})", re.I),
]


def first_match(patterns, text):
    for pat in patterns:
        m = pat.search(text)
        if m:
            return m.group(1).strip()
    return ""


def money(raw):
    return raw.replace(",", "") if raw else ""


def read_pdf(path):
    try:
        return "\n".join((page.extract_text() or "") for page in PdfReader(path).pages)
    except Exception as exc:
        print(f"  !! could not read {path.name}: {exc}")
        return ""


def main(folder):
    folder = Path(folder)
    pdfs = sorted(folder.glob("*.pdf"))
    if not pdfs:
        sys.exit(f"No PDFs in {folder}")

    rows = []
    for pdf in pdfs:
        text = read_pdf(pdf)
        rows.append({
            "file":       pdf.name,
            "po":         first_match(PO_PATTERNS, text),
            "net":        money(first_match(NET_PATTERNS, text)),
            "gross":      money(first_match(GROSS_PATTERNS, text)),
            "invoice_no": first_match(INV_PATTERNS, text),
        })
        flag = "" if rows[-1]["po"] and rows[-1]["net"] else "   <-- check by hand"
        print(f"  {pdf.name:<45} PO {rows[-1]['po'] or '?':<8} "
              f"net {rows[-1]['net'] or '?':>12}{flag}")

    out = folder / "invoices.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["file", "po", "net", "gross", "invoice_no"])
        w.writeheader()
        w.writerows(rows)

    missing = sum(1 for r in rows if not r["po"] or not r["net"])
    print(f"\n{len(rows)} invoices -> {out}")
    if missing:
        print(f"{missing} need a manual look (PO or net not found).")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
