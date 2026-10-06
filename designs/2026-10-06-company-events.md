# Company events: dated news as a reason to call (2026-10-06, built)

William, 10-06: "could be exa, but also google search as well. i want it be free for now." Approved: Google signed-out first, then Exa's free daily credit, nothing paid.

## Answer first

- A new `crm run` stage, `events`, after movers and before score. It searches each firm a CRM person works at now for an acquisition, merger, funding round or new leader in the last 6 months.
- Each dated hit is a `news` finding with its date, headline and link. The latest one adds 25 points and makes the person a "reach out".
- A rename alone never counts. A hit with no date never counts.
- Cost: $0. Google's page runs on the desk inside its shared daily budget (200 searches, 8:00 to 20:00). When Google is out, Exa's `/search` runs from the keys' free credit (330 mills a day per key). Exa's cap parks the rest until it lifts.

## As built

- **Firms:** every CRM company, plus a mover's new firm once their address there is found (`mover_addresses.outcome = found`, by domain). A mover without a found address can't be written to, so their new firm isn't searched.
- **Search:** `searchEvents` (`packages/research/src/companies/events.ts`). Google: `"<firm>" acquired OR acquisition OR merger OR funding OR raises OR appoints OR "new CEO"`. Exa: the same words as a sentence, dated by `publishedDate`.
- **Read:** `readEvents` keeps a hit when it names the firm as whole words (or sits on the firm's own site), has a date within 6 months, and matches one of 4 keyword rules. Confidence 0.6: keyword reads, not a model's.
- **State:** `company_event_checks`, one row per company (found, none, unresolved, capped). Searched again after 30 days. Its `tried` counts toward Google's daily budget with the lookups.
- **Score:** `newsFinding` picks the latest dated news at the firm they work at now. Reason: "Acme Staffing in the news (Aug 2026): <headline>", cited to the finding. Briefs get the same finding as a fact.
- **Loop:** the reactivation loop doesn't run it (no sites there). `crm run` does.

## Hypothesis for the next use

- False hits will come from the keyword rules ("acquires talent", "names a new office"). Expected knob: a model pass over kept hits (free model), behind the same `EventHit` shape.
- Layoffs after a merger are not a reason to call a recruiter's contact with a pitch. Expected knob: per-event points, so a client can zero mergers.
- Other clients will want other events (new office, award). Expected knob: the kinds list as a setting.

## Decision log

- 2026-10-06: Built as approved. Free sources only.
