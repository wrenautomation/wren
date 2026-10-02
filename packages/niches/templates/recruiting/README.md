# Recruiting templates

Syntax: `../sec_ria/README.md`.

Reader: the owner, CEO or MD of a midsize recruiting firm. Two cares:
more business (job orders, a pipeline that doesn't hang on one
rainmaker) and less busywork for the team.

Facts: bare keys from `person_facts` (first_name, company_name, title)
and `offer.*` keys from the arm's offer (`offer.name`, `offer.days`,
`offer.page`, `offer.goal`). `half` is the firm's A/B half. `link.*`
are this email's own tracked links: `{link.book}` (Cal.com via
/book), `{link.page}` (the pitch page), `{link.watch}` (the firm's demo,
else the offer's video). An email that quotes a link the firm can't
get is not composed.

`{call.times}` is two open times on Wren's Cal.com call, said in the
lead's clock ("Tuesday at 10am or Wednesday at 2pm ET"). It is filled
when the email sends, not when it is composed, and reads "early next
week" if the calendar can't answer. A reply that takes a time is booked
on Cal.com, which sends the invite (the event's location is Google Meet);
any other warm reply pings William. The inbox syncs every 2 minutes
(`WREN_DAEMON_SYNC_SECONDS`), so a warm reply is acted on in about 3.

## Arms

Every firm gets `book-first/` for now (William, 10-02), sequence
`book-first-days-0-5`:

- Opener subject: the first name plus a hinted loss ("Dana, you're
  missing out on dozens of placements"). A role inbox drops the name.
- Follow-up (day 5): a short human ping that restates the offer and the
  ask, under a new subject, as a fresh thread (a step with its own
  subject never rides the opener's thread).

`watch-first/` (demo ask, no call, no follow-up) is defined but off.
Turning it back on is one plan line in `src/recruiting.ts`.

Each email's clicks and bookings carry its link code, so results split
by arm.

- The pain family: BD hangs on one or two people, recruiters' weeks go
  to intake and scheduling, job orders come in waves. The example: past
  clients in the CRM who moved, got promoted, or are hiring now.
- The usual fix dissed: a BD push (Fridays blocked for calls, a
  newsletter to the whole list).
- The offer's terms are never typed here. `{offer.days}`,
  `{offer.goal}` and `{offer.page}` come from the registry, so the
  email, the page and the form say the same thing. A key the offer
  doesn't set refuses the niche at import.
- No links in a cold email (outbound-copy SOP). The sign-off links
  wrenautomation.com/recruiting/lead-reactivation (the niche's `lander`).
- Order (outbound-copy SOP): personalization, who William is, the
  offer, the ask. William's voice: short, plain, direct.
  - Personalization is a hard cold read: William has followed the firm
    for a while and, as a software student always recruiting for
    internships, relates to their work. The firm's own line
    (`{company.opener}`) goes first when there is one.
  - Who William is: a software engineer at a top Canadian university
    (University of Waterloo), with production systems at the Government
    of Canada (one used by 17,000 staff) and a U of A lab.
  - The pain is cold read and problem aware: "I'm sure you've got years of
    past clients in your CRM", probably hiring right now; the firm is
    missing out on hundreds of thousands in potential revenue.
  - The offer is plain words: a system that tracks past clients and books
    `{offer.goal}` meetings in `{offer.days}` days; no results, no pay.
    No "I know you're busy", no domain pre-objection, no scarcity line.
  - The ask holds frame: "Are you down to hop on a 30-minute call?", then
    `{call.times}`; William sends a Google Meet invite for one, or they
    name a time.
  - Follow-ups ride the opener's thread (the registry test holds every
    niche to it), not a new subject as the SOP suggests.
