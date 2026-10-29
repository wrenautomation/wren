# Auto likes and follows: park a failed act, hold a broken flow

2026-10-29 (WA-966). Trigger: the desk ledger since 10-15. One Instagram follow target got 21 sends, another 16, all "no Follow button". One TikTok like target got 12. LinkedIn acts went out again 3–4 times each against a bucket switched off (`cap 0`).

## Cause

- `autoActs` marks a post only on success. A failed act leaves `liked_at`/`followed_at` null, so every pass picks the same post again.
- A `cap 0` answer is a 429 with no "retry after". `capWaitMs` read it as no cap, so nothing held the act.

## Options

| | How | For | Against |
|---|---|---|---|
| A. Park per post, plus a breaker (chosen) | `like_fails`, `follow_fails`, `act_error` on `reach_posts`; park at 2; 3 failures in a row in a pass hold the act for the day | Same shape as `liked_at`; stops one bad target and a broken flow | Only the auto-acts loop |
| B. Shared park table | `act_parks` keyed by (platform, act, target) for every send path | One place for all sends | Only auto-acts loop today: an abstraction ahead of need |
| C. Breaker only | A streak hold in loop state, no schema | No migration | One bad target still gets a send every day |

Ranked by: no repeated sends to one person, then a broken flow stops the same day, then the least new surface. A beats C on the first, and B on the third.

## Rule

- A failed like or follow adds 1 to its post's count and keeps the error words. At `ACT_TRIES` (2), the act is parked. A parked follow parks for the author on every post.
- A busy profile (503) counts nothing: nothing reached the site.
- `ACT_BREAK` (3) failures in a row in one pass, or a `need_login` or `platform_blocked` code, hold `<platform> <act>` until the next UTC midnight. autobrowse's day caps reset then.
- A `cap 0` answer holds until the next UTC midnight (`capWaitMs`), for every caller of it.
- To clear a park, set the count to 0. His own Like or Follow click (`planPostAct`) ignores the count.

## Decision log

- 2026-10-29: chose A (William). No text match on "needs a person": autobrowse sends a write's failure as a 502 with no code, so 2 tries park any failure.
