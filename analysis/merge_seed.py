#!/usr/bin/env python3
"""Merge per-role fragments into roles.json / calendar.json / tasks.json and validate the seed."""
import os, json, glob, re

SEED = "/mnt/hgfs/development/gngrll/ll-manager/seed/gngrll"
FRAG = os.path.join(SEED, "_fragments")

NAME = {
    "president":"President", "secretary":"Secretary", "treasurer":"Treasurer",
    "information_officer":"Information Officer", "vp_baseball":"VP of Baseball",
    "vp_softball":"VP of Softball", "grounds_crew":"Grounds Coordinator",
    "equipment_coordinator":"Equipment Coordinator", "uniform_coordinator":"Uniform Coordinator",
    "safety_officer":"Safety Officer",
}

def clampweek(w):
    try: return max(0, min(51, int(w)))
    except (TypeError, ValueError): return None

roles, calendar, tasks, problems = [], [], [], []

for path in sorted(glob.glob(os.path.join(FRAG, "role-*.json"))):
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        problems.append(f"{os.path.basename(path)}: JSON parse error {e}"); continue
    key = d.get("role") or re.sub(r'^role-|\.json$', '', os.path.basename(path))
    roles.append({"key": key, "name": NAME.get(key, key.replace('_',' ').title()),
                  "description": (d.get("description") or "").strip()})
    for c in d.get("calendar", []):
        wk = clampweek(c.get("weekOfFY"))
        if wk is None: problems.append(f"{key}: calendar item bad weekOfFY: {c.get('title')}"); continue
        calendar.append({"roleKey": key, "title": (c.get("title") or "").strip(),
                         "weekOfFY": wk, "kind": c.get("kind") or "reminder",
                         "description": (c.get("description") or "").strip()})
    for t in d.get("tasks", []):
        wk = clampweek(t.get("dueWeekOfFY"))
        tasks.append({"roleKey": key, "title": (t.get("title") or "").strip(),
                      "dueWeekOfFY": wk, "description": (t.get("description") or "").strip()})

json.dump(roles,    open(os.path.join(SEED,"roles.json"),"w",encoding="utf-8"), indent=2)
json.dump(calendar, open(os.path.join(SEED,"calendar.json"),"w",encoding="utf-8"), indent=2)
json.dump(tasks,    open(os.path.join(SEED,"tasks.json"),"w",encoding="utf-8"), indent=2)

# validate email templates front-matter
et_bad = []
role_keys = {r["key"] for r in roles}
for md in glob.glob(os.path.join(SEED,"email-templates","*.md")):
    txt = open(md, encoding="utf-8").read()
    m = re.match(r'^---\s*\n(.*?)\n---', txt, re.S)
    if not m: et_bad.append(os.path.basename(md)+": no front-matter"); continue
    fm = m.group(1)
    if "roleKey:" not in fm or "subject:" not in fm: et_bad.append(os.path.basename(md)+": missing keys")

print(f"roles: {len(roles)}  |  calendar items: {len(calendar)}  |  tasks: {len(tasks)}")
print("roles:", ", ".join(r["key"] for r in roles))
print(f"email-templates: {len(glob.glob(os.path.join(SEED,'email-templates','*.md')))} (bad front-matter: {len(et_bad)})")
print(f"policies: {len(glob.glob(os.path.join(SEED,'policies','*.md')))}  reference: {len(glob.glob(os.path.join(SEED,'reference','*.md')))}  agenda-templates: {len(glob.glob(os.path.join(SEED,'agenda-templates','*.md')))}")
# calendar roleKey integrity
orphan = {c['roleKey'] for c in calendar} - role_keys
if orphan: problems.append(f"calendar references unknown roles: {orphan}")
if et_bad: problems.extend(et_bad[:5])
print("\nPROBLEMS:" if problems else "\nNo problems.")
for p in problems[:20]: print(" ", p)
