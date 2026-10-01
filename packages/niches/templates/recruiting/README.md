# Recruiting templates

Syntax: `../sec_ria/README.md`.

Reader: the owner, CEO or MD of a midsize recruiting firm. Two cares:
more business (job orders, a pipeline that doesn't hang on one
rainmaker) and less busywork for the team.

Facts: bare keys from `person_facts` (first_name, company_name, title)
and `offer.*` keys from the arm's offer (`offer.name`, `offer.days`,
`offer.slots`, `offer.page`, `offer.goal`). `half` is the firm's A/B half. `link.*`
are this email's own tracked links: `{link.book}` (Cal.com via
/book), `{link.page}` (the pitch page), `{link.watch}` (the firm's demo,
else the offer's video). An email that quotes a link the firm can't
get is not composed.

## Arms

Two arms, one offer (`reactivation`), split by `half`:

- `book-first/` (half a), sequence `book-first-days-0-5`: the opener
  asks for a call (`{link.book}`), the follow-up asks again.
- `watch-first/` (half b), sequence `watch-first-days-0-5`: the opener
  sends the video (`{link.watch}`), the follow-up asks for a call. No
  firm demo and no offer `video` yet, so this arm composes nothing
  until one exists.

Each email's clicks and bookings carry its link code, so results split
by arm.

- The pain family: BD hangs on one or two people, recruiters' weeks go
  to intake and scheduling, job orders come in waves. The example: past
  clients in the ATS who moved, got promoted, or are hiring now.
- The usual fix dissed: a BD push (Fridays blocked for calls, a
  newsletter to the whole list).
- The offer's terms are never typed here. `{offer.days}`,
  `{offer.slots}`, `{offer.goal}` and `{offer.page}` come from the registry, so the
  email, the page and the form say the same thing. A key the offer
  doesn't set refuses the niche at import.
- One link per email. The CTA lines are drafts for William.
- Order (outbound-copy SOP): opener line, a short-version line with the
  offer, the pain, who William is (Waterloo, Government of Canada, U of A
  lab), the plan, what it takes from them, the ask. Follow-ups ride the
  opener's thread (the registry test holds every niche to it).
