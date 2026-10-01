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

`{call.times}` is two open times on Wren's Cal.com call, said in the
lead's clock ("Tuesday at 10am or Wednesday at 2pm ET"). It is filled
when the email sends, not when it is composed, and reads "early next
week" if the calendar can't answer. A reply that takes a time is booked
on Cal.com, which sends the invite; any other warm reply pings William.

## Arms

Two arms, one offer (`reactivation`), split by `half`:

- `book-first/` (half a), sequence `book-first-days-0-5`: both emails
  offer `{call.times}`.
- `watch-first/` (half b), sequence `watch-first-days-0-5`: the opener
  offers to send a walkthrough (or a call at `{call.times}`); the
  follow-up sends it (`{link.watch}`) and offers the times again. No
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
- No links in a cold email (outbound-copy SOP). The one exception is
  the watch-first follow-up, which sends the walkthrough the opener
  offered.
- Order (outbound-copy SOP): personalization, who William is (Waterloo,
  Government of Canada, U of A lab), the offer, the ask with two times.
  Follow-ups ride the opener's thread (the registry test holds every
  niche to it), not a new subject as the SOP suggests.
