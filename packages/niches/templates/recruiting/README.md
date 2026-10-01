# Recruiting templates

Syntax: `../sec_ria/README.md`.

Reader: the owner, CEO or MD of a midsize recruiting firm. Two cares:
more business (job orders, a pipeline that doesn't hang on one
rainmaker) and less busywork for the team.

Facts: bare keys from `person_facts` (first_name, company_name, title)
and `offer.*` keys from the arm's offer (`offer.name`, `offer.days`,
`offer.slots`, `offer.page`). No facts view yet.

## Arms

One arm, `reactivation/`, offer `reactivation`.
Sequence `reactivation-days-0-5`: opener, one follow-up.

- The pain family: BD hangs on one or two people, recruiters' weeks go
  to intake and scheduling, job orders come in waves. The example: past
  clients in the ATS who moved, got promoted, or are hiring now.
- The usual fix dissed: a BD push (Fridays blocked for calls, a
  newsletter to the whole list).
- The offer's terms are never typed here. `{offer.days}`,
  `{offer.slots}` and `{offer.page}` come from the registry, so the
  email, the page and the form say the same thing. A key the offer
  doesn't set refuses the niche at import.
- One door: reply with a few times, I book it. Fewest actions from
  email to call. The page (`wrenautomation.com{offer.page}`) is there
  for anyone who wants to read first; it isn't the ask.
