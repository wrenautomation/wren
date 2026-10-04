# Unit economics

Living doc. Started 2026-10-04. William moved CAC, LTV and churn from "after the first paid month" to now on 10-04. With no paid invoices yet, the page shows what it can (spend and cost per stage) and fills the rest in on the first payment, with nothing to build then.

## What it answers

- What does a client cost to win, overall and by channel? (CAC)
- What is a client worth? (LTV, predicted and realized)
- Who leaves, and how much revenue leaves with them? (logo and revenue churn)
- How long until a client pays back its CAC?
- Before any clients: what does a reply, a booked call and a lead cost, per channel?

## Sources

| Need | From |
|---|---|
| Spend | `books.lines` on expense accounts, by `books.entries.posted_on`. Already in CAD (`cad_cents`). |
| Revenue | `delivery.invoices` with status `paid`, by `paid_on`. Converted to CAD with `books.rates` on `paid_on` (same day, else the closest earlier rate). |
| Clients and their life | `delivery.engagements`: `starts_on`, `status` (`onboarding`, `active`, `paused`, `done`). |
| Funnel counts | `pipeline_funnel` (leads, sent, replies), `call_invites` booked, `handoffs.meeting_booked_at`. |

Everything is in CAD on a cash basis: revenue counts when it's paid, spend when it's posted. That matches Books.

## What's missing, added in migration 0074

- `books.accounts.bucket`: `acquisition`, `delivery` or `overhead`. Defaults by key: outreach, email, domains and phone are acquisition; ai, code and hosting are overhead. Nothing is delivery until a client exists. William can change any of them in the Money app's account record.
- `books.accounts.channel`: nullable, one of the channel keys (`email`, `sms`, `ads`, `content`, `search`, `reach`). Defaults: outreach, email and domains go to `email`, phone to `sms`. Acquisition spend with no channel is shared across channels in proportion to the new clients each one won.
- `delivery.engagements.ended_on`: set when the status moves to `done`, cleared if it moves back.
- `delivery.engagements.source_channel` and `source_campaign`: how the client came in. They are set on the engagement form. The form suggests values from the lander's attribution (`/api/export` first touch, matched on the client's member emails) and from the reply thread when the client came from a campaign. Null means unknown, which counts as its own channel.

One bucket per account is a known ceiling: model spend for outbound and for client work share one account. Split it per line when there is client work to split.

## Definitions

A month is a calendar month in America/Toronto.

- **Paying client in a month**: has a paid invoice in that month, or an engagement in `active` or `paused` that has been paid before.
- **New client**: first paid invoice falls in that month.
- **Churned client**: their last open engagement got `ended_on` in that month, and they had paid before.
- **Revenue**: paid invoice CAD in the month. **Recurring revenue (MRR)**: invoices with a `period`, as a monthly amount. Setup fees and per-meeting units are revenue but not MRR.
- **ARPA**: revenue / paying clients, for the month and trailing 3 months.
- **Gross margin**: (revenue − delivery spend) / revenue.
- **CAC**: acquisition spend / new clients, over trailing 3, 6 and 12 months, blended and per channel. Zero new clients gives null, never infinity.
- **Logo churn**: churned / paying at the start of the month. **Revenue churn**: (MRR at the start from clients who had it − their MRR at the end) / MRR at the start. It goes negative with expansion.
- **Predicted LTV**: ARPA × gross margin / logo churn, over trailing 6 months. With zero churn it is null and the page says "no churn yet". It never invents a lifetime.
- **Realized LTV**: per client, paid revenue × gross margin to date. The average is over clients who churned, plus a second figure over everyone.
- **LTV:CAC** and **payback months** = CAC / (ARPA × gross margin).
- **Cost per stage**: acquisition spend per channel / leads, sends, replies, interested replies and booked calls in that channel, by month. This works now, with no clients.

William's own time isn't a cost here. The page says so in one line.

## Where it lives

- `packages/books` owns `economics.ts` and the views `books.econ_months` (one row per month, every figure above) and `books.econ_channels` (per channel, trailing windows). They read `delivery.invoices` and `delivery.engagements` by name in SQL. No TypeScript import crosses products, and a schema test pins the columns they read.
- Records on ConsolePortal: `books.month` and `books.channel`. Stats through `recordsStats` `{value, prior, series}`.
- The engagement form gains source channel and campaign, with the suggestion.

## Console

In the Money app, on the console standard:

- An **Economics** Overview. Tiles: CAC, predicted LTV, LTV:CAC, payback, logo churn, revenue churn, MRR, ARPA, gross margin, each with its prior month and a 12-month series. Below them: cost per reply and cost per booked call by channel. With no paid invoice, the client tiles show "No paying clients yet" and the cost-per-stage tiles carry the page.
- **Months**: a List over `books.month`.
- **Channels**: a List over `books.channel`.
- **Cohorts**: clients by first paid month × months since. Each cell is the share still paying and the revenue kept.
- The account record gains bucket and channel as fields with an edit action.

Operator only, in Wren's workspace. The demo never sees it.

## Phases

1. Migration 0074. Views, with tests on synthetic invoices, engagements and lines that check every figure against hand-worked numbers, including zero churn, zero new clients, mixed currency and an engagement that ends and restarts.
2. Records, stats and the engagement form's source fields with the suggestion.
3. The Economics Overview, Months, Channels and Cohorts pages, plus the account edit. Screenshots at 1360 and 390 as the operator: one of the live page with no clients, and one on a local database seeded with the synthetic set.

## Done when

- Prod's Economics page shows cost per reply and per booked call per channel from real Books spend.
- On the synthetic set, every tile matches the hand-worked figures in the test.
- The first paid invoice fills CAC, ARPA and MRR with no code change.
- Gates pass.

## Decision log

- 2026-10-04: Written. William moved this from after the first paid month to now. Cash basis in CAD to match Books. Spend buckets are a column on accounts, not a mapping in code, so William can change them. Null where a ratio has no denominator, never a made-up lifetime.
- 2026-10-04, phase 1: The migration is 0073, the next free number. Default buckets the doc left open: ads is acquisition on `ads`; software, fees and other are overhead. MRR is each paying client's latest monthly bill less units at the contract's per-unit fee, carried while it pays and zero in the month it churns; paid-month MRR read a late bill as churn. Revenue stays cash, by `paid_on`. Paying at the start of a month is paying the month before. Predicted LTV is (revenue − delivery spend) per paying client-month over (churned / paying at start), each summed over 6 months; LTV:CAC and payback use the 6-month CAC, and payback is null when margin is not positive. Spend with no channel is shared by each channel's share of new clients in the same window; with none, it stays unshared. Funnel counts come from the base tables (`leads`, sent `messages`, reply `thread_events`, interested = `interested` or `meeting_booked`, `call_invites` booked by `updated_at`, and the SMS and reach tables), since `pipeline_funnel` has no months. `handoffs.meeting_booked_at` is a client's meeting, not ours, so it's out. Demo clients never count. Cohort revenue kept leaves out setup fees. A foreign invoice takes the closest earlier BoC rate, else the closest later one: Books has rates only for days it posted a bill.
- 2026-10-04, phase 2: The portal has no engagement form, so the CLI is it: `wren --client <id> delivery source [channel] [--campaign]` sets the source, and with no channel prints the current one and the suggestions (the lander's first touch on an application from a member's email, and campaigns a member replied to). `delivery engagement <state>` was added too, since nothing called `setEngagementStatus` and `done` is what dates the end. Tiles read a month's figure with `recordsStats` `pick` (the newest row up to now, the row before, the newest 12); a pick with no value is null, not zero. Accounts are a record over the `books.accounts` table, no view.
