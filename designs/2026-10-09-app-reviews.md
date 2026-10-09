# App reviews, 2026-10-09

William 10-09: the review plumbing is ours, as skills and CLIs; filing waits on his yes, with every
other public act. Client social (designs/2026-10-07-client-social.md) lists which platform needs
which review.

## What

- `packages/content/src/connect/app-reviews.ts`: `REVIEWS`, one row per review. Each has where it's
  filed, what it waits on, what it unlocks, the form's fields, a reason per permission (the
  scopes come from `SOCIAL`, so a new scope without a reason fails the test), the screencast shot
  list, and open items a machine can't check.
- Checks: each public page fetched once and searched for the words the platform looks for
  (Limited Use, YouTube's terms and revoke link, Facebook and the deletion steps), each
  `/oauth/social/<platform>` callback served, the app's keys present in prod SSM (names only), and
  `deploy/reviews/app-icon-1024.png` a 1024 square.
- `wren app-reviews` lists them with their state; `packet <id> [--out f]` prints the Markdown
  packet with checks; `check [id]` exits 1 while any check is to do.
- Mail apps: Google verification of "Wren mail" for send only (reading stays on Workspace trust,
  no CASA), and Microsoft publisher verification, in the same table.
- Lander branch `app-reviews-privacy` (local, not pushed): privacy covers the app's connected
  accounts and mailboxes, Limited Use (Google data only to models that don't train on it) and
  YouTube API Services; terms bind YouTube's terms; `/data-deletion` is Meta's instructions URL.
  Every check passes against its build. Push = deploy, so it waits.
- Reviewers sign in to the test client `wren_test` at portal.wrenautomationreviews.com as
  william+review@wrenautomation.com (owner) with a password, no code. The password is in autobrowse
  creds `wren-review` (`autobrowse creds copy wren-review` when filing).

## Open

- Limited Use: built as a rule, waiting on a model. A client's Google data (YouTube comments,
  Business Profile reviews, a Google mailbox's mail) reaches only `WREN_GOOGLE_LLM`: reply
  suggestions and auto-reply drafts refuse with `GOOGLE_HELD`, and mail triage falls back to the
  client's rules. Wren's own threads are untouched (no client app in between). Setting it to a
  model whose provider doesn't train on input is a paid key, William's call; then the Google
  rows' checks pass.
- Microsoft publisher verification needs a Partner ID from the AI Cloud Partner Program, which
  verifies the legal name and address: held with Meta Business Verification.
- Meta Business Verification needs William's document with the legal name and address.
- Screencasts: recorded on the reviewer login once each platform's test account is connected.

## Decision log

- 2026-10-09: the review table is code next to `SOCIAL`, so scopes and their reasons can't drift.
  Review state stays config (`WREN_SOCIAL_LIVE`); `filed` is set by the commit that files.
- 2026-10-09: the command is `app-reviews`, since Wren already has customer reviews.
- 2026-10-09: Google data gets its own model slot (`WREN_GOOGLE_LLM`, default none) over a
  per-call flag: the rule holds with no spend, and turning it on is one env value. Scoped to
  client threads; Wren's own data never passes through the app being reviewed.
