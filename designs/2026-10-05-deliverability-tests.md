# Deliverability tests: setup, plain, real; spam score; placement pauses (2026-10-05)

## Answer first

- Three tests, in order, each ruling out one cause (Mailscale's protocol, video W7lHPGZmZt4):
  1. **Setup.** The domain's DNS and lists (today's digest checks: SPF, DKIM, DMARC, MX, NS, Spamhaus DBL, SURBL, URIBL, the SMTP host IP) plus what the receiver said: SPF, DKIM and DMARC results from the `Authentication-Results` header of every seed copy.
  2. **Plain.** A short personal note ("are you still on for Sunday?") from every inbox to every seed. Low inbox rate here = the domain is the problem.
  3. **Real.** The inbox's newest opener, as today. Plain passes and real fails = the copy is the problem.
- A domain whose plain test lands under 80% inbox is paused for cold sends (source `placement`). Warmup keeps running in Instantly. The pause lifts itself after at least 7 days once the plain test is back at 80%. Bounce and complaint pauses still need a human.
- The spam score is SpamAssassin in Docker on the Mac, local rules only. `wren email spamcheck` scores every template option and the newest real drafts. The gates run it on the templates. Free, no third party, no per-check cost.
- `william@wrenautomation.com` joins the seeds (a Workspace inbox, next to William's two personal ones). It also warms in Instantly as of today.
- `wren email deliverability` prints all three tests per domain and the verdict.
- Copy: "ASAP" is gone from the recruiting templates; "If this sounds too good to be true" is gone from watch-first. No opt-out line (William).
- Cost: $0. Seed copies are 2 per inbox per seed per day (54 a day at 9 inboxes × 3 seeds), on the inboxes' own transports.

## 1. Seed copies

`PlacementScheduler/fleet` sends two copies per inbox per seed per send day at the window's open:

| kind | subject and body | proves |
|---|---|---|
| `plain` | one of `PLAIN_NOTES`, picked by day, the same for every inbox that day | the domain's reputation |
| `real` | the newest composed opener (today's behaviour) | the copy |

`PLAIN_NOTES` are human-written, short, no links, no signature beyond the first name. They never reach a lead.

`placement_checks` gains `kind` (`plain | real`, in the primary key) and `auth` (jsonb `{spf, dkim, dmarc}`, each the receiver's word: `pass`, `fail`, `softfail`, `none`, …). Prod has no rows yet, so the key change is free.

Reading a landing switches from `format=minimal` to `format=metadata`: the same one call returns the labels and the headers. The landing rules are unchanged (spam > promotions > inbox; not found = missing).

## 2. Verdict per domain

`placementVerdicts(db, now, senders)`, one per sending domain:

- **Window:** the domain's copies from its last 2 send days with a landing. Refused checks don't count.
- **Enough:** at least 6 landed copies of a kind, or the kind reads `not enough`.
- **Rate:** inbox / landed. Promotions, spam and missing are all misses.
- **Auth:** every copy whose `auth` has a value other than `pass` for SPF, DKIM or DMARC.

| plain | real | verdict | action |
|---|---|---|---|
| < 80% | any | domain problem | pause the domain (source `placement`) |
| ≥ 80% | < 80% | copy problem | warning naming the niche; no pause, since a pause can't fix copy |
| ≥ 80% | ≥ 80% | healthy | lift a placement pause that is 7+ days old |
| auth not pass | | setup problem | warning |

`HEALTHY_RATE = 0.8`, `MIN_LANDED = 6`, `WINDOW_DAYS = 2`, `MIN_PAUSE_DAYS = 7`, `REPLACE_AFTER_DAYS = 14` are constants in `inbox/placement.ts`. After 14 days paused and still failing, the warning says to consider a new domain.

The verdict runs at the end of every placement pass that read a landing. Pauses, lifts and warnings post to the email lane (`laneNotifier`, warning). The digest keeps its daily line, now per domain: `wren-automations.com: setup ok · plain 8/9 · real 7/9`.

## 3. Pauses

- `PAUSE_SOURCES` gains `placement`. `reason` names the numbers: `plain test inbox 5/9 = 56% < 80% over 2 d`.
- Automatic pauses follow the campaign kill switch: `deliver` lets a campaign with the switch off send past a `kill_switch` or `placement` pause. Only an operator pause stops everyone.
- `lifted_by = 'placement'` for a self-lift.
- The bounce window floors at the last lift of a pause that is **not** a placement pause. A placement self-lift is not a human weighing the bounces, so it must not wipe that evidence.
- Seed copies still go out while a domain is paused: the plain test is how it heals.

## 4. Spam score

`packages/channel-email/src/spam/` (Mac only; the Lambda never imports it):

- `deploy/spamassassin/Dockerfile`: `debian:bookworm-slim`, `spamassassin` + `spamc`, `sa-update` at build. Image `wren-spamassassin`, built by `docker build` (layer cache makes reruns instant).
- `startSpamd()`: one container per run, `spamd --local` (no network tests: lists are the setup test's job), `--rm`, and the process wrapped in `timeout 1800` so an orphan removes itself in 30 minutes. `score(raw)` pipes one message through `docker exec -i … spamc -R` and parses the score and the rules hit. `stop()` at the end.
- The message scored is `buildMime` output: the exact bytes a transport sends.
- **Templates:** for each template, render one email per option index (every variant point takes option `i`, or its last when it has fewer), forced through a one-hot `Allocation`. Every option is scored at least once, without the full product of combinations. Facts come from a fixed sample lead.
- **Drafts:** `--drafts N` scores the newest N composed openers per niche from the database (read only).
- **Pass:** score below `SPAM_LIMIT = 2.0` (SpamAssassin's spam line is 5.0). Every rule hit is printed, pass or fail.

`wren email spamcheck [--drafts N]` exits 1 on any fail. `scripts/gates.sh` runs `spamcheck` (templates only) after the integration tests, so a template edit that trips a rule fails the gates.

## 5. `wren email deliverability`

One block per sending domain: setup (DNS and lists from `domainStanding`, auth from the latest seed copies), plain, real, verdict, and any active pause with its reason. Reads only.

## Not now

- **Outlook seed.** Recruiting firms run on Microsoft 365 as often as Google. A seed there needs an Outlook account and a Graph reader. That's the next seed, after the fleet lands.
- **Spam score in the daily loop.** SpamAssassin on the Lambda means a container image or a spamd host. Copy changes go through the gates, and the real-copy placement test already catches a draft that lands in spam.

## Decision log

- 2026-10-05, William: remove "ASAP" and "too good to be true"; keep the money, offer and number lines; no opt-out line.
- 2026-10-05, William: placement should follow the video's protocol; MX belongs in the setup test (it already is); spam checks only if free and scalable; add william@wrenautomation.com to warmup and use it as a test inbox.
- 2026-10-05, William: shorten book-first. Two sentences a paragraph at most so it scans on a phone; cut technical detail first, keep the personalization and the hook. Length is a knob tuned per variant, not a rule.
- Placement pauses lift themselves. The evidence that set them is measured again every day, which isn't true of a bounce or a complaint.
- SpamAssassin over Postmark's free SpamCheck API: no third party gets the copy or a lead's name, and no unknown rate limit.
- Option coverage over every combination: book-first's opener alone has hundreds of combinations; rules fire on words, and every word gets scored.
