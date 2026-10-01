# Agencies templates

Syntax and the preview loop: see `../../sec_ria/templates/README.md`,
same authoring format (D38), same commands with `--niche agencies`.

Facts here: bare keys from `person_facts` (first_name, company_name,
title, …) and `agency.*` keys from `agency_facts` (agency.services,
agency.team_size, agency.industries, agency.min_budget,
agency.hourly_rate, agency.founded, agency.rating). Directory values
render exactly as stored: services and industries are comma-joined
lists, team_size is the floor of a range. Keep them out of sentences
until a fact-quality gate exists (D45 candidate). The DRAFT 12 openers
use name, company and title only. `agency_facts.segment` (marketing or
build, the larger share of the listed services; a9c4e17d5b62) is read by
`compose --where`, not by the templates.

## Arms

Two arms since 2026-09-16, one per segment (D48). Both share the family
of pains (the same client in five tools, a person as the integration,
timesheets, invoices, check-ins), the bio, the usual-fix paragraph's
turn and the one door; they differ in the example and the usual fix:

- `marketing/` for shops whose mix is ads, SEO, social, email, content.
  Example: month end, ad accounts into a spreadsheet into a deck. Usual
  fix: the Zapier zap and the onboarding template.
- `build/` for shops that sell scoped projects (development, design,
  branding, video, e-commerce, IT). Example: the scope typed into the
  proposal, the SOW, the project tool and the invoice, hours that don't
  match the timesheet. Usual fix: the quiet week that never comes.

DRAFT 12 (2026-09-16) is a full direct response rewrite of both arms,
humanized: a scene for the first line (someone typed the same client
into a fifth tool this week), the chain of tools, the math in one
sentence (one new client is five setups) ending on hours that never
reach an invoice, the arm's example ending on what it costs, an open
loop over the bio (the zap didn't fix it either, and I'll say why),
the usual fix closing the loop, the "we're small" turn, one door that
says what comes back. DRAFTs 10 and 11 were in William's documents
voice, reverse
engineered from his examples. The templates carry
no `##` comment lines (stripped 2026-09-16); the notes live here and in
the old copy SOP (git history). The trust line
reads both ways since 2026-09-15: `{first_name|This address} is listed
on the {company_name} site` gives a named person "Sarah is listed on
the X site, as CEO." and a role inbox "This address is listed on the X
site." The follow-up gives one free tip (the Claude connectors for
HubSpot, ClickUp and Asana as a drift check across the CRM, projects,
hours and invoices) and implies the last chance without announcing it.

| Arm | Sequences | Opener | Follow-up | Compose gate |
|-----|-----------|--------|-----------|--------------|
| marketing | `marketing-days-0-3-7`, `marketing-days-0-5` | `marketing/opener` | `marketing/followup` | `--where company.segment=marketing` |
| build | `build-days-0-3-7`, `build-days-0-5` | `build/opener` | `build/followup` | `--where company.segment=build` |

`final_followup` is shared at the root and only the `0-3-7` shape sends
it. William's rule is one follow-up, so the live cadences are the
`0-5` pair. The gate is what keeps a build shop out of the marketing
arm: nothing in the sequence itself knows the segment, and a compose
run without `--where` would enroll both. A company the view leaves
unsegmented (a tie, or no classifiable service) is skipped by both
gates and counted under `skipped_where`.

The one-arm `operations/` (DRAFT 8, the first 100 sends, 2026-09-14 to
15) is retired; git history and `template_versions` keep it.

The pilot / free / value offer arms (2026-09-04) are gone: they priced
the work in the email, which the copy rules forbid. Git history keeps
them; `designs/2026-09-04-offer-and-copy.md` records the switch.

## The sign-off is not here

Templates end at the typed sign-off line ("William"). The block below
it, `--` / name / title / domain, is the SENDER's identity and lives
once in `senders_config.toml` under `[signature]`; compose appends it
to every body (C-D11). Its domain line links this niche's page on the
site (`LANDER` in `../__init__.py`, so `wrenautomation.com/agencies`);
the html form carries the same link. `outreach preview` shows it, so
what you read is what ships. Don't paste it into a template.
