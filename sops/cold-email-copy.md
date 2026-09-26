# Cold email copy

> Copied from the Python repo on 2026-09-20. Command names below are the old
> `emailsgen` ones; the wren equivalents:
> `senders list|pause|resume` → `pnpm wren email senders …` · `outreach status` → `pnpm wren email status` ·
> `inbox replies` → `pnpm wren email replies` · `suppress` → `pnpm wren email suppress` ·
> daily compose/approve → automatic (`ComposeScheduler/{niche}`) · `daemon status` → `POST …/SendScheduler/{inbox}/status` ·
> `outreach health` → the health table in `pnpm wren email status` · `postmaster` → `PostmasterScheduler/fleet/status` ·
> `outreach timezones` → runs inside every compose pass. Not ported yet: `preview`, `drafts/show/approve`, `senders check --send`, `outreach outcomes`
> (see `designs/2026-09-19-parity-gaps.md`).

*William's rules, 2026-09-11. Worked example:
`packages/niches/src/sec_ria/templates/`. His own emails get reverse
engineered into the Examples section as he sends them.*

## When

Writing a template, revising one, or opening a new arm (a new directory
under `templates/`). Nothing sends unread. Review mode is the default.

## Before you start

- Syntax is in the niche's `templates/README.md`. Four marks:
  `{fact|fallback}`, `[[a | b]]`, `((optional with a {fact}))`, `## note`.
- Facts: bare keys from `person_facts` (`first_name`, `title`,
  `company_name`), `company.*` keys from the niche's facts view. A missing
  fact refuses the draft, so anything that can be missing sits inside
  `((…))`.
- Offer terms: `offer.name`, `offer.days`, `offer.slots`, `offer.page`
  from the arm's offer in `packages/offers`. Never type a term the
  registry holds. A key the offer doesn't set refuses the niche at import.
- Subjects: all lowercase. It stands out in a sea of emails. No facts in
  the subject. A name renders capitalised and breaks the lowercase, and a
  refused fact kills the draft.

## The rules

- Hyperpersonalised subject and opener. Borderline absurd. For sec_ria
  the absurd thing is true: a stranger read their Form ADV.
- Handle the objections to the offer before they raise them.
- Organic scheduling: "send me some times, I'll book it". No calendar
  link, no "15 minutes".
- Low friction, short read. That is the ROI.
- Explain who I am.
- Give value instantly. One clear ask.
- Thank them at the end for reading this far.
- One follow-up if they don't reply. No more.
- No price, scope, stack, guarantees. Ends at "William"; the signature
  block is the sender's and compose appends it.

## The pain point

Prime them on the whole family first, then one example. For documents:
handoffs between people, pipelines, manual sheets, no version history,
brittle edits. Then the AUM figure in five documents. One story told too
well narrows them to "not us". The example makes it concrete. A jab at
the end lands ("Have fun with the manual edits and the mental
bookkeeping.").

## The default order

must-click subject → opener → build trust (why are you reading this, you
get a ton of spam) → pain point → the typical fix, dissed (pre-objection)
→ me, my agency, my cred → easy CTA → thanks

## The toolbox

Mix and match. Any of these can lead. Start with hyperpersonalisation,
or with shock, or with a question.

- **Ultra-personalisation.** Their own filing, their own number, their
  own words. "Name, saw your crazy idea for X."
- **Relatability.** "You probably get a ton of these." "That's all I
  know about you, so this is a guess."
- **Shock.** The uncomfortable picture of their week. "Same client,
  typed four times."
- **Open loop.** The subject asks, the body answers.
- **Stand out.** Say the thing nobody else in the inbox would say.
  Lowercase subject. A guess specific enough to be wrong.
- **Ask their take.** "Saw xyz doing this, thoughts?"
- **Assert it.** "You've definitely experienced this:" instead of "this
  is a guess". No hedge, no "one line saying it's wrong is fine".
- **Low friction CTA.** "Let me know if you're interested." "Send two
  times and I'll book it." "Reply not us and I stop."
- **One door.** "If you're interested, reply with a few times that work
  and I'll book it. First step is a free consultation and an audit."
- **Last chance, implied.** "If you're still open to the call and the
  audit, I've got room for two more this month before I'm heads down on
  builds." Scarcity with a reason, never announced. Once, in the
  follow-up. Not "this is the last one from me".
- **Free value.** One tip they can use without us. Name the tool, what
  to point it at, what comes out. "Microsoft Document Intelligence reads
  a form into fields; a short script pushes them into the CRM." In the
  follow-up.

## Who I am

Honest about who I am and what I want. "I'm William, of Wren
Automation. I'm a software engineering student at the University of
Waterloo, and this is the business I'm building. My work has been data
cleaning, pipelines that connect systems, and CRMs." Then proof, real
numbers only:

- Government of Canada: an internal policy chatbot, 17,000 staff use it
  instead of searching 220+ directives by hand, about 6 to 7 hours a
  week each.
- University of Alberta lab: a tool that cut 200+ hours of manual
  lookups across 7,000+ records of messy fuel cell data, terabytes of
  it, in outdated file types.

Never round up. Never call adjacent work "the same". It sits after the
pain, before the usual fix.

## The follow-up

One. Rides the thread, no subject. Shape: "just checking you saw my
last email", one free tip (a named tool, what to point it at, what comes
out), the last chance implied ("if you're still open to the call and the
audit, I've got room for two more this month"), the same one-door CTA,
no hard feelings. Under ~110 words. Not a new pitch, not a breakup,
never "last one from me". The `<arm>-days-0-5` cadence does this.

## Later, on purpose

- **The fakeout offer.** A worse, smaller option beside the real one so
  the real one is the obvious pick. Not in the first campaign. One ask
  per arm so the reply rate means one thing.
- **The second arm.** Enrol `documents-days-0-5` when the list clears
  the sample gate.
- **Case-study site.** Case studies on the Wren Automation site, then
  one sentence after the bio: "More at <link>." Not before the site
  exists.

## Checks before it can send

    uv run emailsgen outreach preview operations/opener --niche sec_ria
    uv run emailsgen outreach preview operations/opener --niche sec_ria --variants
    uv run emailsgen outreach preview operations/opener --niche sec_ria --person <id>

- `--variants` prints each variant point's option count. Read it after
  every edit. A stray `|` silently adds an option.
- `--person` renders a real person and prints `facts_refused`. "Hi
  there," to someone with a name on file is a refusal, not a bug.
- Length as rendered: opener under ~220 words, follow-up under ~120.
- Every subject option is lowercase.
- Read it once on a phone, as them.
- `uv run pytest tests/unit -q`. A syntax mistake fails the suite.

## Ship

One arm, review mode, one follow-up. The live pool is agencies (sec_ria
has no verified address yet). Compose as many as you have read; the
daemon's cap paces them (`sops/campaign-ramp.md`):

    uv run emailsgen outreach compose --niche agencies --sequence marketing-days-0-5 --where company.segment=marketing --kind person --limit 200
    uv run emailsgen outreach compose --niche agencies --sequence build-days-0-5 --where company.segment=build --kind person --limit 200
    uv run emailsgen outreach compose --niche sec_ria --sequence operations-days-0-5 ...

Agencies runs one arm per segment (`agency_facts.segment`), and the
`--where` gate is what keeps each arm to its segment; a compose without
it enrolls both.

Read `reply_by_arm_step` (`outreach outcomes`) after a week.

## Done looks like

Every template in the arm parses. `--variants` shows the counts you
meant. `--person` on three real people shows no surprise refusals. Every
subject is lowercase. The sequence you name in `compose --sequence`
exists in the niche registry.

## When it goes wrong

- `AuthoringError` at import: the whole niche refuses. Fix the file.
- A draft missing for someone: `preview --person <id>`, read
  `facts_refused`. Fix with `((…))` or a `|fallback`, never a guessed
  value.
- "Hi there," with a name on file: the name refused (one initial). Leave
  it.

## Examples

William's own edits of `sec_ria/templates/documents/` (opener DRAFT 6,
follow-up 2026-09-14), reverse engineered. Agencies DRAFT 9 is written
to these.

- **Spoken sentences.** He joins clauses with "but", "and", "or" where
  a draft had two clipped sentences. "It works until years down the
  line a new hire gets complacent, or you do." Not "It works until the
  year it's four out of five."
- **The jab is at them.** "or you do", "you guys", "Have fun with the
  manual edits and the mental bookkeeping."
- **Turn the "we're small" objection.** "At a small scale, this might
  not matter, but it's burning hours of your time every week with the
  amount of data you guys handle." Name the objection, then their
  scale.
- **Follow-up filter.** "If not, skip it unless you have been having
  issues keeping track of your documents and data in a clean, principled
  way (think copy pasting back and forth between 5 different
  spreadsheets. If that's you, this email should be of interest to
  you)." Permission to skip, the pain in brackets.
- **Softer scarcity.** "a call and an audit", "room for a few more",
  never "the call" or "two more".
- **Two-beat CTA.** "Let me know if you're interested, and reply with a
  few times that work." The ask restated, then the mechanics.
- **Plain words.** "don't match" over "disagree"; "from Wren
  Automation" over "of"; "whether or not we talk more".
- **Length.** His opener runs about 340 words, the follow-up about 170.
  The ~220 / ~120 caps above are the floor of his patience, not the
  ceiling.

## Decision log

- 2026-09-11 — William's framework adopted for every template: the
  default order, one follow-up, easy CTA, organic scheduling, thanks at
  the end of the opener.
- 2026-09-11 — DRAFT 4: concise register, both case studies in every
  opener, "on the Form ADV" not "on Schedule A" (Item 1J CCOs are not on
  Schedule A).
- 2026-09-11 — DRAFT 5: subjects all lowercase, no facts in them (the
  `{company_name}` subject option went). SOP rewritten in William's
  words as a toolbox to mix and match; jargon out.
- 2026-09-11 — documents opener: the guess primes the family of
  document pains before the AUM example. William: the story was too
  strong and too specific on its own.
- 2026-09-11 — DRAFT 6, William's edit of the documents opener: hedge
  out, pain asserted, bio before the usual fix, honest student bio, 6 to
  7 hours not 10, "Government of Canada", fuel cell detail, one-door
  CTA (free consultation + audit). The 2A diff offer is gone, so the
  documents arm is no longer blocked on it. Same bio in both openers.
- 2026-09-11 — DRAFT 7: the operations opener takes the same shape
  (assert the pain, family then example, bio, one door). Both follow-ups
  are the last-chance note: did you see my last email, heading in a
  different direction after this batch, last one from me.
- 2026-09-11 — DRAFT 8: William did not like the follow-up wording.
  The last chance is implied ("if you're still open to the call and the
  audit, I've got room for two more this month"), never announced, and
  the follow-up gives one free tip (Microsoft Document Intelligence and
  how to wire it). Agencies gets the same shape as one arm,
  `operations/`; its priced pilot/free/value arms are retired. Agencies
  is the first live pool (sec_ria has no verified address yet); the
  campaign's daily routine is `sops/campaign-ramp.md`.
- 2026-09-16 — William's documents edits reverse engineered into
  Examples. Agencies DRAFT 9: opener and follow-up reworded completely
  in that voice (new subjects, month-end example, the small-scale
  objection turned, follow-up filter, two-beat CTA). The follow-up tip
  is Looker Studio on the month-end report, not Document Intelligence:
  the tip has to hit the opener's example, and agencies have ad
  accounts, not forms. The 100 DRAFT 8
  sends stay on record as DRAFT 8 (`template_versions`).
- 2026-09-16 — Agencies DRAFT 10, two arms by segment: `marketing/`
  (month end example, zap dissed) and `build/` (scope and hours
  example, the quiet week dissed). The family of pains widened to the
  deal, the project, the timesheets, the invoice and the check-in
  (William: "even stuff like manual timesheets"). The follow-up tip is
  the Claude connectors drift check (HubSpot, ClickUp, Asana) on the
  tools the offer targets, not Document Intelligence (agencies have no
  forms) and not Looker Studio (a reporting tool for a CRM offer; and a
  dashboard pitch to a build shop is mansplaining). The `## William:`
  markers were stripped the same day; the templates carry no comments.
- 2026-09-16 — Agencies DRAFT 11, direct response pass over DRAFT 10
  (Schwartz/Sugarman/Halbert toolbox, William's voice kept): each
  example paragraph ends on what the pain costs (the late report and
  the question about the wrong number; eating the timesheet gap or the
  awkward call); the "we're small" turn lands on hours that never reach
  an invoice; the CTA says what comes back (one page, where the hours
  go, what to fix first, theirs either way); one shock subject per arm;
  the follow-up tip ends on what the list is worth (done, not billed).
  Bio and the one door unchanged. No new numbers.
- 2026-09-16 — Agencies DRAFT 12, full rewrite of both arms from the
  direct response toolbox (William: DRAFT 11 changed too little). Scene
  first line, the chain, the math in one sentence, example ending on the
  cost, an open loop carried over the bio, the usual fix closing it, one
  door with what comes back. Humanized after: no run-ups ("Count it."),
  no one-word paragraph openers, no restating closers, no dashes. Same
  bio, same one door, no new numbers. Openers run ~390 to ~425 words.
  Also found: `build/` was git-ignored (packaging rule), so the build arm
  was never in `921a2eb`; `.gitignore` now un-ignores that directory.
- 2026-09-26 — Recruiting DRAFT 1, one arm `reactivation/` on the free
  pilot (`recruiting-reactivation-pilot`), written from William's brief
  without his edit pass. Reader: owner, CEO or MD of a midsize firm.
  Pain family: BD hangs on one or two people, the week goes to intake
  and scheduling, job orders come in waves. Example: past clients in the
  ATS who moved, got promoted, or are hiring now. Usual fix dissed: a BD
  push. Follow-up tip: pull placed-with contacts silent six months,
  check the top 20 on LinkedIn for moves.
- 2026-09-26 — Two rules bent for recruiting, on purpose. (1) The one
  door is the page, not "send me some times": William routed the
  campaign to `/recruiting`, where the application screens fit and a
  fit applicant books in the page. (2) The email states the pilot's
  terms (free, days, slots, what each side gives), because they are the
  offer. Still no price, stack or guarantee. The numbers come from the
  registry as `offer.*` facts, so email, page and form can't disagree.
- 2026-09-26 — No utm on email links. The link is the domain plus the
  offer's page, like the sign-off; the application stores the offer id
  and the enrollment stamps it, so attribution doesn't need the query.
- 2026-09-26 — A niche's page (the sign-off link) must be a live
  offer's page, checked at import. sec_ria moved from the retired
  `/ria` to `/`.
