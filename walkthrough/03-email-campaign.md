# 3 · Email campaign

**Goal:** know the cold-email machine well enough to read it every morning
and feed it when it runs dry. It has run unattended since 2026-09-14.

```
import / fetch ──► companies ──► PoolScheduler/{niche}: discover → crawl → render → scan → extract → pick ──► leads
                                                                                                     │
ComposeScheduler/{niche} (daily): keeps 3 send days of approved openers queued ◄──────────────────────┘
SendScheduler/{inbox}: sends inside the window at the ramp (5 → 25 per inbox per day)
InboxScheduler/{inbox}: replies, bounces; kill switch pauses a domain at 2% bounces
PostmasterScheduler/fleet, OpensScheduler/fleet, DigestScheduler/fleet (07:00 Discord), ReportScheduler/weekly
```

## Every morning

```sh
walkthrough/demos/prod.sh email status       # queue, sent today, pool per niche, pauses, 7-day health per domain
walkthrough/demos/prod.sh email replies      # human replies, newest first
walkthrough/demos/prod.sh email outcomes     # funnel per niche/sequence, reply rate by arm and step
walkthrough/demos/prod.sh email senders list
```

Discord's 07:00 digest says the same. Health to watch: hard bounces per
domain (2% pauses it — `email senders resume <domain>` is the only way back),
Postmaster spam rate (`email postmaster`), replies.

## Windows and ramp

Weekdays, after lunch on the lead's clock (13:00–16:00 where the lead sits)
inside a 13:00–19:00 America/New_York fleet window. `WREN_SEND_*`,
`WREN_COLD_SENDS_RAMP_*` in `deploy/prod.env`. No sends on holidays
(`WREN_SEND_HOLIDAYS`, default `us,ca,year_end`).

## When the pool runs dry

`ComposeScheduler/{niche}` status `exhausted: true` = every company with a
sendable address is enrolled. Three feeds:

```sh
pnpm wren email formats                                          # every import format and its niche
pnpm wren email import export.csv --format agency-directory-csv  # a hand-saved directory export
pnpm wren email import data/agencies/clutch/design_agencies --format clutch-pages
pnpm wren fetch get firm-feed && pnpm wren email import <file> --format sec-firm-feed
```

then the research chain (`PoolScheduler/{niche}/start`; `WREN_POOL_MODEL_STAGES`
is the spend knob: `none` | `pick` | `all`). Verification (MillionVerifier)
stays by hand: it spends credits. `../docs/restate-operations.md` "Feeding
the pool" has every stage as a curl.

## Reviewing copy by hand

Drafts are auto-approved today. The seat is still there:

```sh
pnpm wren email drafts [--flagged]     # waiting drafts, address provenance, DUP? flags
pnpm wren email show 123
pnpm wren email approve 123 124        # also re-arms a FAILED step
pnpm wren email reject 123 --reason wrong_person --note "wrong segment"
pnpm wren email suppress add someone@x.com
```

## Where it breaks

| Symptom | Fix |
|---|---|
| a domain paused | bounces hit 2%: fix the list (`suppress`), then `email senders resume <domain>` |
| `senders check` exit 1 | the inbox's delegation token failed: Workspace user or DWD scope; autobrowse guide 9 |
| sent today 0 on a weekday | outside the window, or the loop stopped: `SendScheduler/<inbox>/status` |
| `exhausted: true` | feed the pool (above) |
