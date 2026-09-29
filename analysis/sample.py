#!/usr/bin/env python3
"""Phase 0: stratified sampling of template-worthy emails.

Pool = clean (non-noise, non-dup), league-OUTBOUND emails
       (from_league True OR folder == 'league' i.e. the Sports Connect bulk sends).
Per theme, allocate a frequency-tuned quota and pick a spread across
author role, fiscal phase, and source, preferring curated bulk sends and
template-length bodies (150-4000 chars).

Output: analysis/sample_manifest.json
"""
import os, csv, json
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAN = os.path.join(ROOT, "analysis", "manifest.csv")
OUT = os.path.join(ROOT, "analysis", "sample_manifest.json")

TARGET_TOTAL = 450
MIN_Q, MAX_Q = 8, 40

PHASE_BY_MONTH = {10:"oct", 11:"novdec", 12:"novdec", 1:"janfeb", 2:"janfeb",
                  3:"mar", 4:"aprmay", 5:"aprmay", 6:"junjul", 7:"junjul",
                  8:"augsep", 9:"augsep"}

def phase_of(month):
    try:
        return PHASE_BY_MONTH.get(int(month), "unknown")
    except (ValueError, TypeError):
        return "unknown"

def score(r):
    """Higher = better template candidate."""
    s = 0.0
    if r["folder"] == "league":
        s += 3          # curated Sports Connect bulk sends are prime templates
    bl = int(r["body_len"] or 0)
    if 150 <= bl <= 4000:
        s += 2
    elif bl < 60:
        s -= 3
    elif bl > 8000:
        s -= 2
    if r["from_role"] not in ("external", "unknown", "league_other"):
        s += 1
    return s

def main():
    rows = list(csv.DictReader(open(MAN, encoding="utf-8")))
    pool = [r for r in rows
            if r["is_noise"] == "False" and r["is_dup"] == "False"
            and (r["from_league"] == "True" or r["folder"] == "league")]

    by_theme = defaultdict(list)
    for r in pool:
        by_theme[r["theme"]].append(r)

    # quotas proportional to sqrt-ish frequency, clamped
    total_pool = len(pool)
    quotas = {}
    for t, rs in by_theme.items():
        q = round(TARGET_TOTAL * len(rs) / total_pool)
        quotas[t] = max(MIN_Q, min(MAX_Q, q, len(rs)))

    sample = []
    for t, rs in sorted(by_theme.items(), key=lambda kv: -len(kv[1])):
        q = quotas[t]
        # bucket by (role, phase) for spread; round-robin best-scored from each bucket
        buckets = defaultdict(list)
        for r in rs:
            buckets[(r["from_role"], phase_of(r["month"]))].append(r)
        for b in buckets.values():
            b.sort(key=score, reverse=True)
        picked, bkeys, i = [], list(buckets.keys()), 0
        while len(picked) < q and any(buckets[k] for k in bkeys):
            k = bkeys[i % len(bkeys)]
            if buckets[k]:
                picked.append(buckets[k].pop(0))
            i += 1
        for r in picked:
            sample.append(dict(path=r["path"], theme=t, from_role=r["from_role"],
                               folder=r["folder"], weekOfFY=r["weekOfFY"],
                               month=r["month"], phase=phase_of(r["month"]),
                               subject=r["subject"], body_len=int(r["body_len"] or 0)))

    json.dump(sample, open(OUT, "w", encoding="utf-8"), indent=1)
    # report
    from collections import Counter
    print(f"pool: {len(pool)}  ->  sample: {len(sample)}")
    print("per-theme:")
    for t, c in Counter(s["theme"] for s in sample).most_common():
        print(f"  {c:3}  {t}")
    print(f"\nwrote {os.path.relpath(OUT, ROOT)}")

if __name__ == "__main__":
    main()
