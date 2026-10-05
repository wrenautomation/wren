---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-05 @ f21d65f
entity: packages/channel-email/src/spam/spamassassin.ts:67
---

# spam-score

SpamAssassin's score for an email's exact bytes: every template option, and the newest real openers. Runs in Docker on the Mac (`wren-spamassassin`, `spamd --local`); `wren email spamcheck`; the integration gate runs it on the templates (designs/2026-10-05-deliverability-tests.md).

## Why this shape

Free, no third party ever sees the copy or a lead's name. Local rules only: the block lists are the setup test's job ([[email/placement-check]], the digest's domain checks), and network tests would make a template's score drift. One render per option index (`coveringRenders`, `spam/coverage.ts:10`) scores every word without the full product of combinations. The scored message is `buildMime` output, follow-ups in their multipart thread shape.

## Shape

- `startSpamd({dockerDir})` → `score(raw)`, `stop()`; container `--rm`, spamd under `timeout 1800`, label `wren.spamcheck=1` (`spam/spamassassin.ts:67`)
- `SPAM_LIMIT = 2.0` (SpamAssassin's own line is 5.0); `parseReport` (`:36`)

Citations: `packages/channel-email/src/spam/spamassassin.ts:67`, `apps/cli/src/deliverability.ts`

## Connected to

- **joins:** [[email/template]] (every option), [[email/message]] (`--drafts`, read only)
- **looks-like-but-is-not:** [[email/placement-check]] (where a copy really landed)

## If you change this

- **Hits:** `scripts/gates.sh` integration (`spam`), `wren email spamcheck`
- **Does not hit:** the Lambda (never imports `@wren/channel-email/spam`), any table

## Surfaces

| Surface | Role |
|---|---|
| `wren email spamcheck [--drafts N] [--niche] [-v]` | runs |
| `./scripts/gates.sh integration` | runs on templates |

## See

- Source: `packages/channel-email/src/spam/`
