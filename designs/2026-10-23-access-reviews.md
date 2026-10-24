# Access reviews: a log per client, 2026-10-23

William 10-23: "managing this is really important, and if other users do this stuff it probably
needs to be supported too." Before this, each review had one `filed` text in code: no history, no
ticket ids, no refusal reasons, Wren only. Reddit's two refusals lived only in agent notes.

## Target

- **Catalog in code** (`packages/content/src/connect/app-reviews.ts`, `REVIEWS`): what a review
  kind needs, its form text, screencast, live checks. Shared by every tenant.
- **State and history in Postgres** (main): `access_reviews` (one row per client and kind:
  state, ticket, last reason, filed, decided, next check) and `access_review_events` (each step,
  never changed: filed, more_info, answered, refused, passed, withdrawn, note, checked).
  Wren's own reviews are client `wren`. A kind not in the catalog takes a name and a where
  (a client's A2P 10DLC, a Business Profile check).
- **One write path**: `logReview` (`review-log.ts`). A step sets the state; a filing looks again
  in 7 days; a question is due now; a decision stops the rechecks.
- **CLI**: `wren app-reviews [--client id] list [--all] | log <kind> <event> [note] | history
  <kind> | due | packet | check`.

## Next

- Portal Account → Access: a client sees its reviews and steps; an operator sees all. Waits on a
  Design Language brief (artifact rules).
- Monitor: platform mail about a review (TikTok, Google, Meta, Reddit) logs a `note` itself.
- `due` in the daily digest.

## Decisions

- Needs stay in code, not the DB: they change with code (scopes, pages), and a test holds them.
- One row per client and kind; a refile is a step, not a new row. History keeps every ticket.
- `filed` dropped from code; the old values were logged as steps on prod.
