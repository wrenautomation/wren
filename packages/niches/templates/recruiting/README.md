# Recruiting templates

Syntax: `../sec_ria/README.md`. Copy rules: `sops/cold-email-copy.md`.

Reader: the owner, CEO or MD of a midsize recruiting firm. Two cares:
more business (job orders, a pipeline that doesn't hang on one
rainmaker) and less busywork for the team.

Facts: bare keys from `person_facts` (first_name, company_name, title)
and `offer.*` keys from the arm's offer (`offer.name`, `offer.days`,
`offer.slots`, `offer.page`). No facts view yet.

## Arms

One arm, `reactivation/`, offer `recruiting-reactivation-pilot`.
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
- One door: the application at `wrenautomation.com{offer.page}`. A fit
  applicant books in the page.
