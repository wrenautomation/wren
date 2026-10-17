# People depth: groups, a full profile, links on every touch, research, lead check

2026-10-17. Beads wa-cpj, wa-egn. William: "i don't know what add to segment means and im not
able to view the details of their profile, or run a exhaustive person search to find all their
cross platform information, or use jev to check if they are a potential viable lead or just some
random guy who likes my content". "instead of segments can just be called groups". "i also can't
directly open these comments / touch points with urls".

## What ships

1. **Groups.** Segments are Groups in every word a person reads: nav, pages, records, toasts, CLI
   help. Route `/people/groups`. CLI `wren groups`. Tables, record ids (`people.segment`,
   `people.member`) and handler names stay: a rename there buys nothing. "Add to group" picks a
   manual group from a list or makes a new one in the same box. One line of help: "A group is a
   saved list of people. A live group follows its rule; a manual group holds who you put in it."
2. **One profile page has it all.** Every handle is a link with its platform icon
   (`social_handles.url`, else built from the handle). Title, company and "On LinkedIn" from the
   research row the profile's `person` key names, the way `outreach.person` shows them. A page that
   fails to load says why and offers a retry; an empty part says so in one line.
3. **Every touch opens its item.** `touches.link` (new) is the item's own page: the LinkedIn
   comment (`feed/update/<activity>?commentUrn=`), the Reddit comment permalink, the X status, the
   Instagram or Facebook permalink, the DM thread. `touches.url` stays: the post or profile it sits
   on. One helper builds a link from what a source row holds; the writers and the backfill both
   call it. `person_touch_lines` gets a real `link` column and no longer pastes a URL into `what`.
   The timeline's link is `link`, its context `url`. A line with no link says "No link for this
   one" and shows its context link.
4. **Research this person.** An action on the profile. It maps the profile to a lookup subject
   (name, emails, handles, firm from the `person` key or a work email's domain) and runs
   `lookUpPerson` in Restate (`ProfileResearch`, keyed by workspace and profile, one at a time).
   `lookUpPerson` gets one more layer, `elsewhere`: a web search on the name and each handle that
   keeps profile pages on known platforms, name-matched, each with a confidence. Callers that do
   not ask for it run as before. Results land in `profile_findings` (kind, platform, value, url,
   source step, confidence) as `found`; he keeps or drops each. A kept handle becomes a profile
   key and a `social_handles` row. Progress is the `profile_lookups` row: state and each step
   tried. Reads go through the same pacing, Google day cap and LinkedIn read ledger as
   `enrich profiles`; no logged-in LinkedIn read past those caps.
5. **Lead check with Jev.** Decide kind `lead_fit`, subject `profile:<id>`: Lead / Unsure / Not
   a lead, with one line why. State: what they do (role, title, company, size, niche), touch kinds
   and their words, kept and found research, Wren's offers. Never a name or a handle. Runs from the
   profile ("Check with Jev") and in the Decide loop for profiles with a new inbound touch since
   their last check. His "Lead" / "Not a lead" on the profile is a `decision_calls` row (source
   `profile`) and a `lead` trait. Same daily cap.
6. **Decide spend beside model usage.** `email_model_records` and `llm_usage_by_month` take the
   `decisions` rows too (provider = backend, kind = `decide:<kind>`) and a `usd` column. Money →
   Model usage shows cost per row; other providers read $0 (free keys) until they report a price.
7. **SOPs stay in sync (wa-egn).** `library.sop` needs `team`. The private `sops/` repo gets a
   `post-commit` hook: for each SOP whose `SOP.md` the commit changed and that has a platform row
   in prod's `content_playbooks`, it runs `prod-wren.mjs sop push <name> --platform <p>`.

## Schema (migration 0289, one base commit)

- `touches.link text`.
- `profile_lookups`: id, profile_id, state (`queued`, `running`, `done`, `failed`), by, subject
  jsonb, tried jsonb, outcome, error, retry_at, started_at, finished_at, created_at.
- `profile_findings`: id, profile_id, lookup_id, kind (`handle`, `link`, `employer`), platform,
  value, url, source, confidence, detail jsonb, state (`found`, `kept`, `dropped`), decided_by,
  decided_at, ref (unique per profile), at. A merge moves both to the profile kept.
- `DECISION_KINDS` adds `lead_fit`; its spec is in `decide/kinds.ts`.

## Builds

| Brief | Items | Wave |
|---|---|---|
| A `groups-profile` | 1, 2 | 1 |
| B `touch-links` | 3, 6 | 1 |
| C `profile-research` | 4 | 2 |
| D `lead-fit` | 5 | 2 |
| planner | 7, base schema | 0 |

Wave 2 starts from wave 1 merged. Only B adds a migration (its views); C and D use the base tables.

## Decision log

- 2026-10-17: keep table names, record ids and handler names for groups. Only words and the route
  change. Why: a table rename touches every query and both databases for no reader gain.
- 2026-10-17: a separate `touches.link`, not a rewrite of `url`. Why: the post or profile is still
  worth a link ("where"), and old rows keep it when no permalink can be built.
- 2026-10-17: findings live per profile, not in research `findings`. Why: research findings key on
  a research `people` row, and most social people have none; making one would put fans into the
  lead pipeline.
- 2026-10-17: `elsewhere` is a layer of `lookUpPerson`, off unless asked. Why: one lookup, and the
  lead pipeline's runs stay as they were.
- 2026-10-17: `unsure` is not kept. Why: agreement counts on "is a lead"; unsure is no lead yet.
- 2026-10-17: other providers show $0 in Model usage. Why: they run on free keys; no price table
  exists, and a made-up price would mislead.
