# Project Goal

- Build a league operations manual, calendar, and template system for incoming board members
  - Roles: president, secretary, treasurer, information officer
  - Fiscal year: October 1 through September 30
- Longer term: turn this into a reusable, multi-tenant system any league can adopt

# Source Data Gathered

Raw material collected for analysis (all under `ll-manager/`):

- **League emails** — 170 messages exported from the Sports Connect "Email Statistics" page
  - Location: `league emails/` (one date/time-labeled `.txt` per message, plus `INDEX.md`)
- **Sent mail** — 37,900 messages across three league Gmail accounts (Google Takeout, parsed to date/time-labeled `.txt`)
  - Location: `sent emails/<account>/parsed/`, with per-account `INDEX.md` and top-level `ALL_INDEX.md`
  - president — 30,864 messages (2018–2026)
  - information officer — 6,192 messages (2022–2026)
  - treasurer — 844 messages (2018–2026)
  - Note: the president export arrived as `Sent-002.mbox`; the numbering is a Takeout artifact from discarded folders — no `Sent-001` exists, so the export is complete
- **Board meeting agendas** — 104 "Agenda & Record" documents (`.docx`, 2016–2026) plus 1 spreadsheet
  - Location: `meeting agendas GNGRLL/`

# Technical Architecture

- MySQL-backed React web application, hosted online, serving as the home for all generated output

# Delivery Phases

## Phase 1 — Analyze sources and build GNGRLL's core content

Distill the gathered emails and meeting agendas into:

- Email templates per board member role
- Meeting agenda templates keyed to week of fiscal year
- Task lists for officers
- Calendars and an email calendar (role-specific due dates by week)
- Policies and procedures document (distilled from policy-related emails and agendas)
- Sportsmanship/behavior email templates (pulled from relevant past correspondence)
- Role descriptions for:
  - Grounds crew, VP of Baseball, VP of Softball
  - Uniform and equipment coordinators
  - Any additional roles surfaced through email and agenda review

## Phase 2 — Multi-tenant online system built on the Phase 1 content

- A user can create a "league" and modify its templates, policy documents, etc. for their own organization
- Invite officers and assign them to roles
- Each role has its own template and calendar set
- Members log in by role and view their role-specific content:
  - Calendar (syncs to phone) with due dates by week
  - Role-specific email templates
  - Document library: policies and procedures, past meeting agendas
- The "president"/"owner" of each league can view all roles, their task lists, etc., in a dashboard
- Integrate with the existing scheduling app to create a full league management system

# Future Enhancements

- AI agents trained on policies, procedures, and historical email Q&A
  - Provide quick answers to support requests across league email channels
- Goal: reusable year-over-year system supporting a well-run, well-supported league
