#!/usr/bin/env python3
"""Build the inventory of linkable seed resources for task enrichment.
Output: analysis/link_inventory.json  { policies:[{slug,title}], references:[{slug,title}],
templates:[{key,category,roleKey,subject}] }  — agents may only link to these refs."""
import os, re, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'seed', 'gngrll')

def fm(path):
    txt = open(path, encoding='utf-8').read()
    m = re.match(r'^---\s*\n(.*?)\n---', txt, re.S)
    d = {}
    if m:
        for line in m.group(1).split('\n'):
            mm = re.match(r'^([A-Za-z0-9_]+):\s?(.*)$', line)
            if mm: d[mm.group(1)] = mm.group(2).strip()
    return d

policies = []
for f in sorted(glob.glob(os.path.join(SEED, 'policies', '*.md'))):
    d = fm(f); slug = d.get('slug') or os.path.basename(f)[:-3]
    policies.append({'slug': slug, 'title': d.get('title', slug)})

references = []
for f in sorted(glob.glob(os.path.join(SEED, 'reference', '*.md'))):
    d = fm(f); slug = os.path.basename(f)[:-3]
    references.append({'slug': slug, 'title': d.get('title', slug)})

templates = []
for f in sorted(glob.glob(os.path.join(SEED, 'email-templates', '*.md'))):
    d = fm(f); key = os.path.basename(f)[:-3]
    templates.append({'key': key, 'category': d.get('category', key.split('__')[0]),
                      'roleKey': d.get('roleKey', ''), 'subject': d.get('subject', key)})

out = {'policies': policies, 'references': references, 'templates': templates}
json.dump(out, open(os.path.join(ROOT, 'analysis', 'link_inventory.json'), 'w', encoding='utf-8'), indent=1)
print(f"policies={len(policies)} references={len(references)} templates={len(templates)} -> analysis/link_inventory.json")
