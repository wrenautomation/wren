# Campaign ramp — every send day, from 5 to 25 per inbox

> Copied from the Python repo on 2026-09-20. Command names below are the old
> `emailsgen` ones; the wren equivalents:
> `senders list|pause|resume` → `pnpm wren email senders …` · `outreach status` → `pnpm wren email status` ·
> `inbox replies` → `pnpm wren email replies` · `suppress` → `pnpm wren email suppress` ·
> daily compose/approve → automatic (`ComposeScheduler/{niche}`) · `daemon status` → `POST …/SendScheduler/{inbox}/status` ·
> `outreach health` → the health table in `pnpm wren email status` · `postmaster` → `PostmasterScheduler/fleet/status` ·
> `outreach timezones` → runs inside every compose pass. Not ported yet: `preview`, `drafts/show/approve`, `senders check --send`, `outreach outcomes`
> (see `designs/2026-09-19-parity-gaps.md`).

The warmup protocol (`designs/2026-08-23-warmup-protocol.md` §2) says:
start real sends at 5 per inbox per day, add 2 to 3 per inbox every 2 to
3 days, stop at 25 to 30. Since 2026-09-11 that ramp is data
(`WREN_COLD_SENDS_RAMP_*`), the send walk reads it every tick, and
this is the daily routine around it. The campaign began Monday
2026-09-14: agencies, `operations-days-0-5`, 10 inboxes.

Sends go out on weekdays, after lunch on the lead's own clock: 13:00
to 16:00 where the lead sits, inside a 13:00 to 19:00 America/New_York
fleet window (`WREN_SEND_*` and `WREN_SEND_LEAD_WINDOW_*` in
`.env`, since 2026-09-14; people reply most after lunch;
`designs/2026-09-14-lead-window.md`). Nothing leaves outside the fleet
window, and the daemon sleeps until it opens. A lead with no zone, or
one whose afternoon never meets the fleet window (Hawaii), follows the
fleet window alone. Six hours holds the ceiling of 25 sends per inbox
at the average gap, so the window never needs widening.

The daemon runs in Docker, the `campaign` profile of `docker-compose.yml`
(`app` beside `db` and the nightly `backup`). It was started on
2026-09-11, ahead of day 1, with the whole first pool composed and
approved; it reads the inboxes every 5 minutes around the clock and
sends only inside the window. Composing ahead is safe: a follow-up is
timed from the day its opener actually went out, and the cap paces the
queue.

## When

Every weekday morning of a live campaign, from the first real send until
the fleet sits at the ceiling. Then keep the read steps and drop the
compose maths.

## Before you start

- The ramp is set. `grep -E '^WREN_COLD_SENDS' .env` shows
  `WREN_COLD_SENDS_RAMP_START=2026-09-14` and
  `WREN_COLD_SENDS_PER_INBOX_PER_DAY=25`. No start = flat cap, no
  ramp.
- The fleet is up. `uv run emailsgen senders list` shows 10 active, 0
  paused. `uv run emailsgen senders check --send` passes.
- Every lead has its zone. `uv run emailsgen outreach timezones --niche
  agencies` after every import; it touches only companies without one,
  so running it again costs nothing. Its table says which zones follow
  the fleet window alone today.
- The copy passed its checks (`sops/cold-email-copy.md`, "Checks before
  it can send") for the arm you enrol.
- The stack is up. `docker compose ps` shows `app`, `db` and `backup`
  all `Up`. The Mac stays plugged in with the lid open (on battery it
  sleeps after a minute), and Docker Desktop is set to start at sign-in,
  or a reboot ends the campaign quietly.

## Steps

1. Read yesterday. `uv run emailsgen outreach health --days 7`. The
   daily table has a `cap` column beside `sent`: `sent` under `cap` on
   a day the daemon ran means it was held back (gap, pause, no approved
   drafts). Any red cell: stop here, see "When it goes wrong".
2. Read Postmaster. `uv run emailsgen outreach postmaster sync`, then
   `uv run emailsgen outreach postmaster domains`. Spam rate over 0.1%
   on any domain: halve the ceiling and restart the daemon. Over 0.3%:
   stop the daemon.
3. Know today's cap. `uv run emailsgen daemon status` prints the policy
   line: `N/inbox/day today (send day k, ramp …)`. Fleet cap = N × active
   inboxes. Day 1: 5 × 10 = 50.
4. Keep the queue ahead of the cap. `uv run emailsgen outreach status`
   counts messages by state; `approved` is what is waiting to send
   (`outreach drafts` lists only the unreviewed). When fewer openers are
   approved than tomorrow's fleet cap, compose more: `uv run emailsgen outreach compose
   --niche agencies --sequence marketing-days-0-5 --where company.segment=marketing --kind person --limit
   <n>`. A big `--limit` is fine; the cap paces it. The first pool (132
   founders) was composed on 2026-09-11 and runs out on day 3. When
   `outreach people --enrollable` lists no people, compose the role
   inboxes: `--kind role_inbox`. Preview the nameless reading first
   (`outreach preview marketing/opener --niche agencies --company
   <id>`); "Hi there," is right, a line that assumes a name is not. 250
   role inboxes were composed and approved on 2026-09-15 (day 2).
5. Read and approve. `uv run emailsgen outreach drafts`, `outreach show
   <id>` for a few, `outreach reject <id> --reason "…"` for anything off,
   then `uv run emailsgen outreach approve --all`. The daemon picks
   approved drafts up on its next tick; nothing to restart.
6. Check the daemon, do not start it. `docker compose ps` shows `app`
   `Up`; `docker compose logs app --since 24h | grep -v httpx` shows
   the ticks and the sleeps. It sends inside the window only, 8 to 20
   minutes apart per inbox, up to today's cap per inbox, follow-ups
   before openers. To pause: `docker compose stop app`. To resume, or
   after any `.env` change: `docker compose --profile campaign up -d
   app`. After a code change: add `--build`.
7. Evening read. `uv run emailsgen outreach outcomes` (reply rate by arm
   and step). `uv run emailsgen daemon status` for the day's tick stats.
   Replies to answer by hand: `uv run emailsgen outreach drafts`.

The numbers the ramp produces, fleet of 10:

| Send day | Per inbox | Fleet |
|----------|-----------|-------|
| 1 to 3 | 5 | 50 |
| 4 to 6 | 7 | 70 |
| 7 to 9 | 9 | 90 |
| 10 to 12 | 11 | 110 |
| 13 to 15 | 13 | 130 |
| 16 to 18 | 15 | 150 |
| 31 on | 25 | 250 |

Send days, not calendar days: a weekend advances nothing. When the cap
reaches 15 (send day 16), lower the Instantly warmup limits to about 15
by hand (protocol, 2026-09-04 row). That is the only Instantly change.

## Done looks like

- `outreach health` shows `sent` = `cap` for every inbox on every send
  day, 0 hard bounces, 0 complaints, bounce rate under 2%.
- Postmaster spam rate under 0.1% on every domain.
- Reply rate (`outreach outcomes`) at or above 5%. Under 2% after about
  100 opened sends: stop composing, fix the copy or the list.
- No day sends more than twice the day before. The ramp cannot, by
  construction.

## When it goes wrong

- **A domain paused** (`outreach health` pauses table, `senders list`):
  hard bounces at or over 2% with at least 2 in 7 days, or any
  complaint. Find the cause (a bad address source, an unverified batch),
  fix it, then `uv run emailsgen senders resume <domain>` by hand. It
  re-enters at today's ramp cap, not at the ceiling.
- **Spam rate over 0.1%:** halve `WREN_COLD_SENDS_PER_INBOX_PER_DAY`,
  restart the daemon. Over 0.3%: stop the daemon, wait two clean days.
- **Reply rate under 2%, or mostly auto-replies and unsubscribes:** stop
  composing openers, let queued follow-ups finish, fix the copy.
- **`sent` well under `cap` on a day the daemon ran:** `daemon status`
  shows the tick stats. `senders_capped` = the cap did its job.
  `gap_waiting` = the window was too short for the cap at 8 to 20
  minutes a send. `outreach drafts` still full = nobody approved them.
- **Instantly placement under 80%:** stop composing openers for two
  days, keep sending follow-ups.
- **The policy will not parse** (`outreach health` exits 1 with the
  variable named): fix `.env`, nothing sends until it parses.
- **`app` is not `Up`:** `docker compose logs app --tail 50`. The start
  fails loudly on a broken wire, roster, policy or notifier (U-D4); fix
  it, then `docker compose --profile campaign up -d app`. If the Mac
  slept or Docker Desktop was closed, nothing was sent and nothing was
  lost: `up -d` again and the queue resumes where it stopped.
- **Replies arrive unlabelled:** the classifier runs only when
  `WREN_LLM` names a real provider; the campaign runs
  `cohere:command-a-03-2025`. The daemon's first log line says
  `llm cohere:…`; `docker compose logs app | grep classify` shows the
  runs. A provider failure is announced and retried next cycle. Sync
  stops the enrollment on any reply, bounce or opt-out either way.
