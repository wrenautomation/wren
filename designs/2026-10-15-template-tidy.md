# Template tidy

2026-10-15. William: "clear out the templates", "workflows feel mocked". Goal: the Library, the Shop and Workflows → New show only what code runs.

## Default files (`packages/templates/defaults/`)

| Files | Used by | Verdict |
|---|---|---|
| `dm/reach/*` (3) | `packages/core/src/follow.ts` | keep |
| `email/follow/*` (2) | `follow.ts` | keep |
| `email/reviews/*` (3) | `packages/channel-sms/src/components.ts` | keep |
| `email/recruiting/book-first/*` (3) | recruiting plan; `reply` by `inbox/reply.ts` | keep |
| `email/agencies/{marketing,build}/*` (4) | agencies plan (both arms) | keep |
| `email/sec_ria/operations/*` (2) | sec_ria plan | keep |
| `email/agencies/final_followup`, `email/sec_ria/final_followup` | only the 0-3-7 sequences; never enrolled; one follow-up is the rule | deleted |
| `email/sec_ria/documents/*` (2) | an A/B arm, never enrolled (A/B retired 10-13) | deleted |
| `email/agencies/README.md`, `email/sec_ria/README.md` | described the Python port | deleted |
| `post/*` (3) | `VIDEO_FOOTERS`, `packages/core/src/content/video.ts` | keep |
| `prompt/*` (4) | content and reactivation code | keep |
| `sms/texts/*` (9) | `packages/channel-sms` | keep |

The niches drop the same sequences: agencies and sec_ria keep only their `days-0-5` two-step ones.

## Rows without a file (main database)

`wren templates prune` (dry run) then `--apply`, from the main checkout: `node scripts/prod-wren.mjs templates prune`.

- Never sent: deleted with their versions. Expected: the two `final_followup`, `sec_ria/documents/*`, `recruiting/watch-first/*`.
- Sent: `agencies/operations/*`. Versions stay (sent messages pin them); the row is emptied and moved to `retired/`. `templates` has no archive column.
- Only email rows of a niche. SMS keys like `keyword.*` have no file on purpose (`KEYWORD_SLOTS`).

## Planned parts

One flag, `planned: true`: no code runs the part. It is in no Shop list, map, canvas palette or Claude's workflow prompt; its own page still opens by id (Voice reads `voice.agent` that way). `checkWorkflows` refuses a node on one. Trigger leads lost its site-visitors node. The `later` field (dialer and voicemail on Follow-up and Nurture) is gone.

## Workflows → New

The three hand-drawn graphs (`automation-templates.ts`) ran nowhere and are gone. New lists the Shop's templates (speed to lead, missed call, reviews, win back, plus any saved from the canvas); each opens its Shop page, which installs it. The keyword DM card and Made here stay.

## Left for William

- The agencies and sec_ria niches themselves: agencies leads may be recontacted (lead recycling); sec_ria was never sent. Delete either when he says.
- Run the prune on prod.
- `voice.agent` is planned, so it's off the Shop until the voice agent ships.

## Decision log

- 2026-10-15: Sent rows are retired, not deleted. Their versions are what went out.
- 2026-10-15: Hide planned parts in `typesFor`, not per page, so every list agrees.
- 2026-10-15: Keep `threeEmailSequence`. It's generic and tested; only the niche uses went.
