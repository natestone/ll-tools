#!/usr/bin/env python3
"""Merge per-role task fragments into seed/gngrll/tasks.json.
Matches by (roleKey, title); validates every link ref against the inventory."""
import os, json, glob, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'seed', 'gngrll')
FRAG = os.path.join(SEED, '_task_fragments')

tasks = json.load(open(os.path.join(SEED, 'tasks.json'), encoding='utf-8'))
inv = json.load(open(os.path.join(ROOT, 'analysis', 'link_inventory.json'), encoding='utf-8'))
valid = set(p['slug'] for p in inv['policies']) | set(r['slug'] for r in inv['references']) | set(t['key'] for t in inv['templates'])

frag = {}
for f in sorted(glob.glob(os.path.join(FRAG, '*.json'))):
    role = os.path.basename(f).split('__')[0]
    try:
        arr = json.load(open(f, encoding='utf-8'))
    except Exception as e:
        print('BAD fragment', f, e); continue
    for e in arr:
        frag[(role, (e.get('title') or '').strip())] = e

enriched, missing, no_steps, dropped = [], [], [], 0
for t in tasks:
    nt = dict(t)
    e = frag.get((t['roleKey'], t['title'].strip()))
    if e:
        nt['details'] = (e.get('details') or '').strip()
        nt['steps'] = [s for s in (e.get('steps') or []) if str(s).strip()]
        links = []
        for l in (e.get('links') or []):
            if not isinstance(l, dict):
                continue
            if l.get('type') == 'url' and str(l.get('ref', '')).startswith('http'):
                links.append(l)
            elif l.get('ref') in valid:
                links.append(l)
            else:
                dropped += 1
        nt['links'] = links
        if not nt['steps']:
            no_steps.append(t['title'])
    else:
        missing.append((t['roleKey'], t['title']))
        nt.setdefault('details', ''); nt.setdefault('steps', []); nt.setdefault('links', [])
    enriched.append(nt)

json.dump(enriched, open(os.path.join(SEED, 'tasks.json'), 'w', encoding='utf-8'), indent=1)
have = sum(1 for t in enriched if t.get('steps'))
print(f"tasks total: {len(tasks)} | enriched with steps: {have} | missing fragment: {len(missing)} | no-steps: {len(no_steps)} | invalid links dropped: {dropped}")
if missing: print('  missing:', missing[:10])
if no_steps: print('  no-steps:', no_steps[:10])
