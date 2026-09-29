export const meta = {
  name: 'gngrll-phase1-seed',
  description: 'Distill sampled emails + agendas + crawled website into seed/gngrll/ content (email templates, agenda templates, policies, per-role calendars/tasks, division/field reference)',
  phases: [
    { title: 'Extract', detail: 'per-theme email templates, per-phase agenda analysis, policy mining (emails+agendas+website), website reference' },
    { title: 'Synthesize', detail: 'agenda template + seasonal item map' },
    { title: 'Roles', detail: 'per-role calendar, task list, role description (informed by website board/divisions)' },
    { title: 'Critic', detail: 'coverage completeness check' },
  ],
}

const ROOT = '/mnt/hgfs/development/gngrll/ll-manager'
const SEED = `${ROOT}/seed/gngrll`
const WSITE = `${ROOT}/website/text`

const ROLES = ['president','secretary','treasurer','information_officer','vp_baseball','vp_softball','grounds_crew','equipment_coordinator','uniform_coordinator','safety_officer']
const THEMES = ['all_stars','board_meeting','conduct_safety','draft','fields_facilities','fundraising','merchandise','opening_day','photos','playoffs_tournament','practice','registration','schedule','sea_dogs_events','snack_shack','sponsorship','tryouts_assessments','umpires','uniforms','volunteer_certification','weather_cancellation']
const PHASES = ['oct','novdec','janfeb','mar','aprmay','junjul','augsep']
const AREAS = ['governance_roles','registration_assessment','equipment_uniforms_safety','finance_sponsorship','fields_capital','allstars_tournament']

// website slug prefixes/pages relevant to each policy area (agents ls website/text and read matches)
const AREA_WEB = {
  governance_roles: ['home__board-of-directors','home__about-gngrll','guidelines-documents'],
  registration_assessment: ['register-practices-assessments','frequently-asked-questions__playing-up','frequently-asked-questions__what-are-sandlot-games','frequently-asked-questions__game-changer'],
  equipment_uniforms_safety: ['coaches-corner','frequently-asked-questions__certified-volunteer','frequently-asked-questions__rainout-lightning-guidelines','guidelines-documents__annual-requirements'],
  finance_sponsorship: ['home__become-a-sponsor','home__our-sponsors','frequently-asked-questions__sponsorship'],
  fields_capital: ['field-directory','projects'],
  allstars_tournament: ['frequently-asked-questions__all-stars-tournaments','playoffs'],
}

const THEME_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ theme:{type:'string'}, owning_role:{type:'string'},
    templates:{type:'array', items:{type:'object', additionalProperties:false,
      properties:{ file:{type:'string'}, subject:{type:'string'}, weekOfFY:{type:'integer'} }, required:['file','subject','weekOfFY'] }},
    notes:{type:'string'} }, required:['theme','owning_role','templates'] }
const PHASE_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ phase:{type:'string'},
    standing_items:{type:'array', items:{type:'string'}},
    seasonal_items:{type:'array', items:{type:'object', additionalProperties:false,
      properties:{ item:{type:'string'}, weekOfFY:{type:'integer'}, owning_role:{type:'string'} }, required:['item','weekOfFY'] }},
    policy_notes:{type:'array', items:{type:'string'}} }, required:['phase','standing_items','seasonal_items'] }
const POLICY_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ area:{type:'string'}, file:{type:'string'}, title:{type:'string'}, sources:{type:'integer'} }, required:['area','file','title'] }
const ROLE_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ role:{type:'string'}, fragment_file:{type:'string'}, n_calendar:{type:'integer'}, n_tasks:{type:'integer'} }, required:['role','fragment_file'] }
const REF_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ kind:{type:'string'}, file:{type:'string'}, items:{type:'integer'} }, required:['kind','file'] }
const CRITIC_SCHEMA = { type:'object', additionalProperties:false,
  properties:{ coverage_ok:{type:'boolean'}, gaps:{type:'array',items:{type:'string'}}, stats:{type:'object', additionalProperties:true} }, required:['coverage_ok','gaps'] }

const rolesList = ROLES.join(', ')

function themePrompt(t){ return `You extract reusable EMAIL TEMPLATES for a youth baseball/softball league (GNGRLL) from historical *outbound* emails, for the theme "${t}".

Data access (all bash allowed):
1. Get this theme's sample file paths:  python3 -c "import json;[print(x['path']) for x in json.load(open('${ROOT}/analysis/sample_manifest.json')) if x['theme']=='${t}']"
2. Read each listed file under ${ROOT}/ (header block: Date/Time Sent, From, To, Subject, then body). Read all of them (usually 8-40).

Task:
- Identify the 1-4 RECURRING, reusable communications in this theme (skip pure one-offs).
- For each write a template: a Subject line and a Markdown body using {{placeholders}} for variable bits (dates, times, names, divisions, links, amounts). REMOVE personal names, emails, phone numbers and one-off specifics.
- Pick the owning officer role (one of: ${rolesList}).
- Estimate typical fiscal-year timing as weekOfFY (0-51; FY week 0 = week containing Oct 1) from the source dates.

WRITE each template to ${SEED}/email-templates/${t}__<short-slug>.md with YAML front-matter then body:
---
roleKey: <role>
category: ${t}
weekOfFY: <int>
subject: <subject line>
---
<markdown body with {{placeholders}}>

Return the JSON summary.` }

function agendaPhasePrompt(p){ return `You analyze GNGRLL board-meeting agendas for the fiscal-year phase "${p}" (FY starts Oct 1).

Data:
1. python3 -c "import csv;[print(r['date'],r['weekOfFY'],r['source_filename']) for r in csv.DictReader(open('${ROOT}/analysis/agenda_index.csv')) if r['phase']=='${p}']"
2. Read the matching text files in ${ROOT}/analysis/agendas_txt/ (named <date>.txt). Read 3-8 spanning years.

Extract standing_items (every-meeting sections), seasonal_items (phase-specific, each with weekOfFY and owning_role from ${rolesList} when clear), and policy_notes (motions, $ thresholds, rules; cite meeting date). Return JSON. Do not write files.` }

function agendaSynthPrompt(phaseResults){ return `Synthesize ONE reusable board-meeting agenda template + a seasonal-item map for GNGRLL (FY Oct 1 - Sep 30) from per-phase analysis.

Per-phase analysis (JSON):
${JSON.stringify(phaseResults.filter(Boolean), null, 1)}

Write:
1. ${SEED}/agenda-templates/board-meeting-agenda.md — recurring agenda skeleton (front-matter title; standing sections with {{placeholders}}; "Motions / Votes" and "Action Items" sections).
2. ${SEED}/agenda-templates/seasonal-agenda-items.md — seasonal items keyed by fiscal-year phase + weekOfFY, with owning_role where known.

Return JSON (phase:"ALL", merged standing_items, seasonal_items, policy_notes).` }

function policyPrompt(area){ const web = (AREA_WEB[area]||[]); return `Draft a POLICIES & PROCEDURES section for GNGRLL for area "${area}", grounded in real sources with citations.

Sources (use all three):
- WEBSITE (authoritative current policy — often ready-made): list & read matching pages:
    ls ${WSITE} 2>/dev/null ; then read files whose name starts with any of: ${web.join(', ')}
    (e.g. cat "${WSITE}/${web[0]||'home__about-gngrll'}.txt"). These are the league's own published FAQ/guidelines.
- AGENDAS: read a spread in ${ROOT}/analysis/agendas_txt/ for motions/thresholds/procedures.
- EMAILS: python3 -c "import csv;[print(r['path']) for r in csv.DictReader(open('${ROOT}/analysis/manifest.csv')) if r['theme'] in ('conduct_safety','volunteer_certification','sponsorship','fields_facilities','board_meeting') and r['is_noise']=='False' and r['is_dup']=='False'][:40]" then read ~6-12 relevant ones.

Write ${SEED}/policies/${area}.md with YAML front-matter (slug, title) then Markdown policy prose in subsections. Every concrete policy statement (thresholds, requirements, deadlines, procedures) MUST cite its source inline, e.g. "(source: website all-stars-tournaments)", "(source: agenda 2023-03-15)", "(source: email <subject>)". Prefer the website as the current source of truth; use agendas/emails for detail and history. Do NOT invent unsupported policy. Return the JSON summary.` }

function refPrompt(kind){
  if(kind==='divisions') return `Build a DIVISIONS reference for GNGRLL from the crawled website.
Read: ls ${WSITE} | grep '^divisions' ; cat each "${WSITE}/divisions*.txt".
Write ${SEED}/reference/divisions.md with YAML front-matter (title) then one subsection per division (T-Ball, Coach Pitch/A, Player Pitch/AA, Minors/AAA, Majors, Juniors/Seniors, Senior Tournament Team). For each: age range, format/rules highlights, and any notable notes. Cite "(source: website divisions/<x>)". Return JSON {kind:"divisions", file, items:<# divisions>}.`
  return `Build a FIELDS reference for GNGRLL from the crawled website (feeds the grounds crew role).
Read: ls ${WSITE} | grep '^field-directory' ; cat each "${WSITE}/field-directory*.txt".
Write ${SEED}/reference/fields.md with YAML front-matter (title) then one row/subsection per field: name, town/location, and notes (surface, lights, maintenance, which divisions use it). Cite "(source: website field-directory/<x>)". Return JSON {kind:"fields", file, items:<# fields>}.`
}

function rolePrompt(role, themeResults, agendaSynth){
  const mine = (themeResults||[]).filter(Boolean).filter(r=>r.owning_role===role)
  return `Build the seed content fragment for the GNGRLL officer role "${role}" (FY Oct 1 - Sep 30).

Email templates already assigned to this role (theme extraction):
${JSON.stringify(mine, null, 1)}

Seasonal agenda items / timing map:
${JSON.stringify(agendaSynth||{}, null, 1)}

Website context — read what's relevant to this role:
- Role/board definitions: cat "${WSITE}/home__board-of-directors.txt" (find this role's responsibilities if listed).
- If role is vp_baseball/vp_softball: also read ${WSITE}/divisions*.txt. If grounds_crew: read ${WSITE}/field-directory*.txt. If safety_officer: read ${WSITE}/coaches-corner*.txt and ${WSITE}/*annual-requirements.txt.
- You may also: ls ${SEED}/email-templates/ and read any that belong to this role.

Produce a role fragment: description (2-4 sentence Markdown), calendar (array of {title, weekOfFY 0-51, kind: "due"|"meeting"|"reminder", description}), tasks (array of {title, dueWeekOfFY 0-51, description}). Spread timing realistically across the year.

WRITE JSON to ${SEED}/_fragments/role-${role}.json:
{"role":"${role}","description":"...","calendar":[...],"tasks":[...]}
Return the JSON summary.` }

phase('Extract')
const [themeResults, phaseResults, policyResults, refResults] = await Promise.all([
  parallel(THEMES.map(t => () => agent(themePrompt(t), {label:`theme:${t}`, phase:'Extract', schema:THEME_SCHEMA}))),
  parallel(PHASES.map(p => () => agent(agendaPhasePrompt(p), {label:`agenda:${p}`, phase:'Extract', schema:PHASE_SCHEMA}))),
  parallel(AREAS.map(a => () => agent(policyPrompt(a), {label:`policy:${a}`, phase:'Extract', schema:POLICY_SCHEMA}))),
  parallel(['divisions','fields'].map(k => () => agent(refPrompt(k), {label:`ref:${k}`, phase:'Extract', schema:REF_SCHEMA}))),
])

phase('Synthesize')
const agendaSynth = await agent(agendaSynthPrompt(phaseResults), {label:'agenda-synth', phase:'Synthesize', schema:PHASE_SCHEMA})

phase('Roles')
const roleResults = await parallel(ROLES.map(r => () => agent(rolePrompt(r, themeResults, agendaSynth), {label:`role:${r}`, phase:'Roles', schema:ROLE_SCHEMA})))

phase('Critic')
const critic = await agent(`Completeness critic for GNGRLL seed content at ${SEED}.
Inspect: ls -R ${SEED} ; count files per subdir ; read a few. Also confirm website was used: policies should contain "(source: website" citations and reference/divisions.md + reference/fields.md should exist and be non-trivial.
Check: (a) every role in [${rolesList}] has _fragments/role-*.json with non-empty calendar+tasks; (b) email-templates cover major themes; (c) policies exist for all areas and cite website; (d) agenda templates exist; (e) reference/divisions.md and reference/fields.md exist.
Return coverage_ok, concrete gaps, and stats (counts per dir).`,
  {label:'critic', phase:'Critic', schema:CRITIC_SCHEMA})

return {
  themes: themeResults.filter(Boolean).length,
  agendaPhases: phaseResults.filter(Boolean).length,
  policies: policyResults.filter(Boolean).length,
  reference: refResults.filter(Boolean).length,
  roles: roleResults.filter(Boolean).length,
  critic,
}
