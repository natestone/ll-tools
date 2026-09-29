#!/usr/bin/env python3
"""Phase 0: extract board-meeting agenda .docx files to plain text.

python-docx is unavailable; a .docx is a zip, so we read word/document.xml and
convert block/paragraph/table structure to readable text. Also parses the date
from each filename and computes fiscal-year timing.

Outputs:
  analysis/agendas_txt/<YYYY-MM-DD>.txt
  analysis/agenda_index.csv   (date, weekOfFY, month, phase, source_filename)
"""
import os, re, csv, zipfile
from datetime import date
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "meeting agendas GNGRLL")
OUT_DIR = os.path.join(ROOT, "analysis", "agendas_txt")
OUT_IDX = os.path.join(ROOT, "analysis", "agenda_index.csv")

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PHASE_BY_MONTH = {10:"oct",11:"novdec",12:"novdec",1:"janfeb",2:"janfeb",3:"mar",
                  4:"aprmay",5:"aprmay",6:"junjul",7:"junjul",8:"augsep",9:"augsep"}

def docx_to_text(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    out = []
    def para_text(p):
        return "".join(t.text or "" for t in p.iter(W + "t"))
    for el in root.iter():
        tag = el.tag
        if tag == W + "p":
            txt = para_text(el).strip()
            if txt:
                out.append(txt)
        elif tag == W + "tr":  # table row -> tab-joined cells
            cells = []
            for tc in el.iter(W + "tc"):
                cells.append(" ".join(para_text(p).strip() for p in tc.iter(W + "p")).strip())
            line = " | ".join(c for c in cells if c)
            if line:
                out.append(line)
    # de-dup consecutive identical lines (tables can double-emit)
    dedup = []
    for ln in out:
        if not dedup or dedup[-1] != ln:
            dedup.append(ln)
    return "\n".join(dedup)

def parse_date(fn):
    m = re.match(r'(\d{1,2})[_-](\d{1,2})[_-](\d{2,4})', fn)
    if not m:
        return None
    mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if yy < 100:
        yy += 2000
    try:
        return date(yy, mm, dd)
    except ValueError:
        return None

def fiscal(d):
    fy_start = date(d.year if d.month >= 10 else d.year - 1, 10, 1)
    return max(0, min(51, (d - fy_start).days // 7)), d.month

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    idx, ok, fail = [], 0, 0
    for fn in sorted(os.listdir(SRC)):
        if not fn.lower().endswith(".docx"):
            continue
        d = parse_date(fn)
        try:
            text = docx_to_text(os.path.join(SRC, fn))
        except Exception as e:
            print(f"FAIL {fn}: {e}"); fail += 1; continue
        stamp = d.isoformat() if d else re.sub(r'[^\w.-]', '_', fn)[:20]
        with open(os.path.join(OUT_DIR, stamp + ".txt"), "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        wk, mon = fiscal(d) if d else ("", "")
        idx.append(dict(date=(d.isoformat() if d else ""), weekOfFY=wk, month=mon,
                        phase=PHASE_BY_MONTH.get(mon, "") if mon else "",
                        chars=len(text), source_filename=fn))
        ok += 1
    with open(OUT_IDX, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["date","weekOfFY","month","phase","chars","source_filename"])
        w.writeheader(); w.writerows(sorted(idx, key=lambda r: r["date"]))
    print(f"extracted {ok} agendas ({fail} failed) -> analysis/agendas_txt/")
    thin = [r for r in idx if r["chars"] < 200]
    if thin:
        print(f"WARN {len(thin)} agendas extracted <200 chars (image-heavy?):",
              [r["source_filename"] for r in thin][:5])

if __name__ == "__main__":
    main()
