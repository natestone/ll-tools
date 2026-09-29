#!/usr/bin/env python3
"""Phase 0: build a manifest of the whole email corpus.

Reads every .txt under "league emails/" and "sent emails/<account>/parsed/",
parses the header block (multi-line aware), classifies theme, maps authorship
to a league role by From/Sent-By address, flags noise and duplicates, and
computes fiscal-year timing (FY starts Oct 1; week containing Oct 1 = week 0).

Output: analysis/manifest.csv
"""
import os, re, csv, hashlib
from datetime import datetime, date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # ll-manager/
SRC_DIRS = [
    ("league", os.path.join(ROOT, "league emails")),
    ("president", os.path.join(ROOT, "sent emails", "president", "parsed")),
    ("info_officer", os.path.join(ROOT, "sent emails", "info_officer", "parsed")),
    ("treasurer", os.path.join(ROOT, "sent emails", "treasurer", "parsed")),
]
OUT = os.path.join(ROOT, "analysis", "manifest.csv")

DIVIDER = re.compile(r'^-{20,}\s*$')
EMAIL_RE = re.compile(r'[\w.+-]+@[\w.-]+\.\w+')
LEAGUE_DOMAIN = "gnglittleleague.org"
# local-part of a gnglittleleague.org address -> role key
ROLE_BY_LOCALPART = {
    "president": "president", "info": "information_officer",
    "secretary": "secretary", "treasurer": "treasurer",
    "registrar": "information_officer", "merch": "treasurer",
    "umpires": "umpire_in_chief", "safety": "safety_officer",
}

# Theme keyword rules (subject, lowercased). Order = priority; first hit wins.
THEMES = [
    ("weather_cancellation", ["cancel", "postpone", "rain", "weather", "snow", "delay"]),
    ("registration", ["registration", "register", "sign up", "signup", "sign-up", "roster spot"]),
    ("tryouts_assessments", ["tryout", "try-out", "assessment", "evaluation", "eval "]),
    ("draft", ["draft", "team assignment", "team placement", "player selection"]),
    ("uniforms", ["uniform", "jersey", "hat", "pants", "sizing", "size"]),
    ("photos", ["photo", "picture", "pics", "portrait", "team photo"]),
    ("all_stars", ["all star", "all-star", "allstar", "all stars"]),
    ("playoffs_tournament", ["playoff", "tournament", "championship", "bracket", "invitational"]),
    ("schedule", ["schedule", "game time", "reschedule", "makeup", "make-up", "gamechanger"]),
    ("practice", ["practice", "clinic", "workout", "training session"]),
    ("umpires", ["umpire", "ump ", "umpiring"]),
    ("fields_facilities", ["field", "facility", "batting cage", "lights", "maintenance", "work day", "field prep", "bennett", "intervale"]),
    ("fundraising", ["fundrais", "raffle", "donation", "bottle drive", "calendar raffle"]),
    ("sponsorship", ["sponsor", "sponsorship", "banner"]),
    ("merchandise", ["merch", "store", "apparel", "order has been received", "spirit wear"]),
    ("volunteer_certification", ["volunteer", "certif", "background check", "jdp", "little league data", "coach application"]),
    ("conduct_safety", ["conduct", "abuse awareness", "safesport", "safe sport", "concussion", "code of conduct", "behavior", "sportsmanship"]),
    ("opening_day", ["opening day", "opening ceremon", "parade"]),
    ("snack_shack", ["snack shack", "concession"]),
    ("board_meeting", ["board meeting", "agenda", "minutes", "board of directors", "annual meeting", "elections"]),
    ("sea_dogs_events", ["sea dogs", "seadogs", "hadlock"]),
]

BOUNCE_HINTS = ["delivery status notification", "undeliverable", "undelivered mail",
                "mail delivery failed", "returned mail", "failure notice",
                "delivery incomplete", "delivery delay"]
SYSTEM_SENDERS = ["mailer-daemon", "postmaster", "mail delivery subsystem"]


def parse_headers(lines):
    """Return (headers dict lowercased keys, body str). Multi-line aware."""
    headers, body_start, last_key = {}, len(lines), None
    for i, ln in enumerate(lines):
        if DIVIDER.match(ln):
            body_start = i + 1
            break
        m = re.match(r'^([A-Za-z/][A-Za-z /]*?):\s?(.*)$', ln)
        if m:
            last_key = m.group(1).strip().lower()
            headers[last_key] = m.group(2).strip()
        elif last_key and ln.strip():          # continuation line
            headers[last_key] += " " + ln.strip()
    body = "\n".join(lines[body_start:]).strip()
    return headers, body


def fiscal(dt):
    fy_start = date(dt.year if dt.month >= 10 else dt.year - 1, 10, 1)
    wk = max(0, min(51, (dt.date() - fy_start).days // 7))
    return wk, dt.month


def norm_subject(s):
    s = s.lower()
    s = re.sub(r'^\s*((re|fwd|fw)\s*:\s*)+', '', s)
    s = re.sub(r'\bgngrll?\b|\bgng ll\b|\bgngll\b', '', s)
    s = re.sub(r'\d+', '', s)
    s = re.sub(r'[^a-z& ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def classify(subject, body):
    hay = (subject + " " + body[:200]).lower()
    for theme, kws in THEMES:
        if any(k in hay for k in kws):
            return theme
    return "other"


def role_of(from_email):
    if not from_email:
        return "unknown"
    local, _, dom = from_email.lower().partition("@")
    if dom == LEAGUE_DOMAIN:
        return ROLE_BY_LOCALPART.get(local, "league_other")
    return "external"


def parse_date(s):
    for fmt in ("%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return None


def main():
    rows, seen = [], set()
    for folder, d in SRC_DIRS:
        if not os.path.isdir(d):
            print(f"WARN missing {d}")
            continue
        n = 0
        with os.scandir(d) as it:
            for entry in it:
                if not entry.name.endswith(".txt"):
                    continue
                n += 1
                with open(entry.path, encoding="utf-8", errors="replace") as fh:
                    lines = fh.read().split("\n")
                h, body = parse_headers(lines)
                subject = h.get("subject", "")
                sender_raw = h.get("from", "") or h.get("sent by", "")
                em = EMAIL_RE.search(sender_raw)
                from_email = em.group(0) if em else ("" if "@" not in sender_raw else sender_raw)
                dt = parse_date(h.get("date/time sent", ""))
                wk, mon = fiscal(dt) if dt else ("", "")
                nsub = norm_subject(subject)
                sha1 = hashlib.sha1(body.encode("utf-8", "replace")).hexdigest()

                # noise detection
                noise, reason = False, ""
                low_sender = sender_raw.lower()
                if any(b in subject.lower() for b in BOUNCE_HINTS) or any(s in low_sender for s in SYSTEM_SENDERS):
                    noise, reason = True, "bounce_system"
                elif not nsub:
                    noise, reason = True, "empty_subject"

                theme = classify(subject, body)
                dup_key = (theme, sha1)
                is_dup = dup_key in seen
                if not is_dup:
                    seen.add(dup_key)

                rows.append(dict(
                    path=os.path.relpath(entry.path, ROOT), folder=folder,
                    date=(dt.isoformat() if dt else ""), weekOfFY=wk, month=mon,
                    from_email=from_email, from_role=role_of(from_email),
                    from_league=(role_of(from_email) not in ("external", "unknown")),
                    subject=subject, norm_subject=nsub, theme=theme,
                    body_len=len(body), body_sha1=sha1,
                    is_noise=noise, noise_reason=reason, is_dup=is_dup,
                ))
        print(f"{folder}: {n} files")

    cols = ["path", "folder", "date", "weekOfFY", "month", "from_email", "from_role",
            "from_league", "subject", "norm_subject", "theme", "body_len",
            "body_sha1", "is_noise", "noise_reason", "is_dup"]
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"\nwrote {len(rows)} rows -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
