---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-15 @ 2ce041c3
entity: packages/core/src/channel-stats-schema.ts:92
---

# channel stats

Each channel's funnel per person: reached, saw, engaged, replied, booked, paid. View `profile_steps` (one row per profile, channel, source and step) and `channelStats`, which counts it. People → Channels; `wren channels`.

## Why this shape

One view over the sources we already keep, not a new store: the [[leads/sent-log]] by [[leads/profile-key]] (email, text, DMs), [[leads/touch]] rows by `handle:<platform>` keys, Wren's site forms, `source`/`channel` traits, and the timeline's bookings and payments. So every number is people we can name, and each one opens its list. Post views and `/go/` visits name nobody; they sit beside the funnel, never in it.

A channel shows only the steps it can prove (`provesOf`): a text has no open, a newsletter no reply. Those cells are null and read as a dash, never 0. Rows are cohorts: people first reached on the row in the window, then what they did after, so rates compare like with like. Booked and paid credit goes to any, the first or the last channel that reached them (`attribution`).

The same step is a segment condition (`kind: "step"`), so a number saves as a live segment and a segment filters the table.

## Shape

- `profile_steps` (`packages/core/src/channel-stats-schema.ts:92`): `profile_id`, `channel`, `source_kind`, `source`, `step`, `at`, `ref`, `cost_usd`, `sends`. A view in every workspace database (migration 0270).
- `FUNNEL_STEPS`, `STAT_CHANNELS` with names, `provesOf` (`:75`).
- `channelStats(db, {by: channel|source|trait:<key>, channel, days, segment, rule, attribution}, now)` (`packages/core/src/channel-stats.ts:255`): rows with people, rates, sends, cost, views, visits. Reads the view once (`steps`, materialized) and joins each cohort row to its later steps; 0.85 s on prod (2026-10-16), was 93 s with a subquery per row and step.
- `channelPeople` (`:331`): the people behind one row and step, latest 500. `stepRule` turns a row and step into a segment rule.
- Portal: `PeopleConsole` `channelStats`, `channelPeople` (read). Page `apps/portal/web/src/modules/people/channels.tsx`.

Citations: `packages/core/src/channel-stats-schema.ts:92`, `packages/core/src/channel-stats.ts:255`, `packages/core/src/channel-stats.ts:331`

## Connected to

- **reads:** [[leads/sent-log]], [[leads/profile-key]], [[leads/touch]], [[leads/profile]], [[calendar/booking]] (as timeline lines)
- **joins:** [[leads/segment]] (filter, and the `step` condition)
- **looks-like-but-is-not:** content analytics (per post, no people); `wren campaigns` (one campaign's sends)

## If you change this

- **Hits:** a migration for the view; `compileRule`'s `stepSql` and the `step` condition; `provesOf` when a channel gains a step
- **Does not hit:** sending; the sources (only read)

## Surfaces

| Surface | Role |
|---|---|
| People → Channels (portal) | reads |
| `wren channels` | reads |

## See

- Source: `packages/core/src/channel-stats.ts`
- Design: `designs/2026-10-15-channel-stats.md`
