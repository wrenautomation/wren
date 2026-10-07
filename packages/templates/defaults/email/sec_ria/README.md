# Writing templates

Each `*.email` file here IS one email, named by its filename
(`opener.email` → template "opener"). Edit the file, rerun the command —
the words load automatically at startup. A syntax mistake refuses the
whole niche loudly at import; nothing broken can ever send.

## Layout — an arm is a directory

    templates/
      final_followup.email      ← root: shared by every arm
      documents/
        opener.email            ← template "documents/opener"
        followup.email
      operations/
        opener.email
        followup.email

A file at the root is shared by every arm; a file inside `<arm>/` belongs
to that arm and to nothing else, and its template name is `<arm>/<file>`.
One level only — deeper nesting refuses at import. The arm is declared
nowhere: a sequence's arm IS the directory its opener lives in, its name
derives from it (`documents/opener` → `documents-days-0-5`, no `name=`),
a step from another arm refuses at import, every enrollment snapshots the
arm, and `reply_by_arm_step.arm` reports it. A new offer is a new
directory with an opener inside, and nothing else has to learn its name
(D48, `designs/2026-09-11-arms-as-directories.md`).

## Syntax — the file is the email, plus four marks

- `{first_name}` — fact slot. If the fact is missing for a recipient,
  their draft is refused (never "Hi ,").
- `{first_name|there}` — fact slot with a fallback. `{key|}` renders
  nothing when the fact is missing.
- `[[option a | option b | option c]]` — a variant point: each recipient
  deterministically gets one option (spread across recipients, stable
  per recipient). Variant points are auto-named v1, v2, … in document
  order; every pick is recorded per message for analysis.
- `((optional sentence with {facts}))` — vanishes for recipients missing
  a fact inside; must contain at least one `{fact}` or `[[variants]]`.

Rules:

- First line `subject: …` sets the subject. **No subject line = this
  step rides the thread** as a reply to the previous step. Subjects are
  all lowercase and carry no facts (William's rule):
  lowercase stands out in a full inbox, a rendered name comes back
  capitalised, and a refused fact kills the draft.
- Variant points may sit inside `((…))`; nothing nests further.
- Comments: a line starting `##` is an authoring note — stripped before
  anything else, never sent, never stored. Whole lines only; a mid-line
  `#` (or a line like "#1 rated…") is plain prose. A line starting `# `
  or a lone `#` is refused loudly as a probable mistyped comment — the
  parser never guesses between a note that would send and copy that
  would vanish.
- No escapes — the file is only the email. Single parens
  and single braces outside `{…}`/`[[…]]`/`((…))` are plain prose. `|`
  is different: inside `[[ … ]]`, every top-level `|` is ALWAYS an
  option separator — a `|` inside a `{key|fallback}` nested there is
  still safe, since it belongs to the fallback, not the bank. Outside
  `[[ ]]`, `|` is plain prose. An accidental extra `|` inside a bank
  silently adds an option, so `preview` (below) prints each variant
  point's option count — read it after every edit as the check that
  catches the mistake.

## Facts you can use

Bare keys come from `person_facts` (first_name, last_name, full_name,
title, company_name, company_domain, …). `company.*` keys come from this
niche's facts view — `firm_facts` here (company.segment,
company.employees, company.name, …; `\d firm_facts` in psql for the full
list).

Values are made **sentence-ready** on the way out (D39,
`outreach/readable.py`): the SEC files names and titles in block capitals
and AUM as a bare integer, so `company_name` renders "Hays Financial
Group, LLC" rather than "HAYS FINANCIAL GROUP, LLC", `title` renders
"Chief Compliance Officer" (and leaves "CCO" alone), `company.aum`
renders "$342M" beside the untouched `company.aum_usd` that targeting
queries use, and a count renders "23,100" rather than "23100". A value it can't state refuses instead of guessing — a first
name filed as a single initial ("D") goes absent, so `{first_name|there}`
falls back rather than sending "Hi D,"; a `title` over 80 characters
refuses too (`readable.TITLE_MAX_CHARS` — one real filing runs to 127),
so a `((… {title}))` clause drops instead of taking three lines. A
count filed as 0 refuses, because `((…))` drops on missing, not on zero.
The filed value is never changed; this is derived at render time, and
every refusal is pinned on the draft (`provenance.facts_refused`) and
printed by `preview --person`, so "Hi there," to a person with a name on
file is never a mystery.

## Preview loop

    uv run emailsgen outreach preview documents/opener --niche sec_ria
    uv run emailsgen outreach preview documents/opener --niche sec_ria --variants
    uv run emailsgen outreach preview documents/opener --niche sec_ria --person 123

Placeholder mode renders «first_name»-style tokens so you can review
structure without data; `--variants` enumerates every variant
combination (the QA pass — read the whole authored space once);
`--person` renders against a real person's facts, exactly what compose
would produce.

## Cadence

Sequences live in `../__init__.py` (one entry each). Two shapes per arm:
day 0, +3, +7 business days (opener, follow-up, breakup), or day 0 and +5
business days — a calendar week, so the one follow-up lands on the same
weekday as the opener — with nothing after it (D47). The one-follow-up
shape reuses the arm's `followup` file; if a week-later single nudge
wants different words from a day-3 one, write a new `.email` and point
the entry at it. Editing a sequence never affects already-enrolled
people — the cadence is snapshotted at enrollment.

## Arms

This niche has two arms, an A/B on the opener's HOOK, not on its wording:

| Arm | Sequences | Opener | Follow-up |
|-----|-----------|--------|-----------|
| documents | `documents-days-0-3-7`, `documents-days-0-5` | `documents/opener` | `documents/followup` |
| operations | `operations-days-0-3-7`, `operations-days-0-5` | `operations/opener` | `operations/followup` |

`final_followup` is shared — a breakup email reads the same either way —
and only the `0-3-7` shape sends it. Each arm keeps its own follow-up so
a thread never argues with itself.

**One arm at a time (P2-D9, 2026-09-11).** The sample gate wants roughly
1,140 opened enrollments per arm before a 2% → 4% difference is readable,
and the reachable list has not been counted. Until it is, enrol one arm —
operations — and keep the other's copy on disk, unenrolled.
`reply_by_arm_step` reads the split the day there are two.

All five files are DRAFT 8 copy (2026-09-11), written to William's
rules: lowercase subjects, each subject
option a different tool from the toolbox, the pain asserted, the same
honest bio and both case studies in every opener, one-door CTA (free
consultation + audit), and one follow-up that gives a free tip and implies the last chance. Nothing either
arm promises has to be built first.

## The sign-off is not here

Templates carry copy and end at the typed sign-off line ("William") —
that line IS part of the copy and belongs here. The block below it, `--`
/ name / title / domain, does not: it is the SENDER's identity, so it
lives once in `senders_config.toml` under `[signature]`, in both a `text`
and an `html` form, and compose appends it to every body (C-D11).

Its domain line links this niche's page on the site (`LANDER` in
`../__init__.py`, so `wrenautomation.com/ria`); the html form carries
the same link. `outreach preview` shows it, so what you read is what
ships. Don't paste it into a template — every email would then carry it
twice.
