# People map

Bead wa-sf5. William, 10-15: track everyone, not just clients. Most important is warmth: is this a cold lead, or have they subscribed, replied, or seen our stuff before? A warm person never gets a cold opener.

Builds on B1 profiles (designs/2026-10-14-customerio-audit.md). Same People app, same `people.profile` record. No new page.

## What

One row per live profile in `profile_rollups`, rebuilt from the source tables. Plain columns, so segments, the list and the CLI read them without joins.

- **Stage**, the furthest reached: `stranger` (an address only), `lead` (we reached them, or they showed any warm sign), `replied` (wrote back on any channel, sent a form or chatted), `booked` (a call not cancelled), `client` (paid a pay link, signs in to a client workspace, or marked), `past_client` (marked).
- **Warmth**: `warm` once they did anything toward us, else `cold`. Each reason has a count, first and last time: `subscribed`, `replied`, `booked`, `form`, `visited`, `watched`, `opened`, `clicked`, `engaged`. Clients and past clients are warm.
- **Subscriptions**: every consent, as `topic (channel, state)`.
- **Replies**: count, first, last, last channel, every channel.
- **Touch**: first and last line either way (time, channel, what), and `came_from` (the source of their oldest address: `lead_import`, `site_form`, ...).
- **Persona**: `persona_role`, `persona_niche`, `persona_size`, and `persona` (`<niche> <role>`).

## Schema

`profile_rollups` (migration, `packages/core/src/people-map-schema.ts`), PK `profile_id`:

| Columns | Meaning |
|---|---|
| `stage`, `warmth`, `why`, `warmth_line`, `warm_since` | stage; warm or cold; reason keys, comma list; one line for people ("replied 2x, last Oct 3; opened 4x"); first warm sign |
| `<reason>_n`, `<reason>_first`, `<reason>_last` for subscribed, replied, booked, form, visited, watched, opened, clicked, engaged, contacted | counts and times. `contacted` is what we sent them |
| `subscriptions`, `replied_channels`, `replied_last_channel` | text |
| `first_touch_at`, `first_channel`, `first_touch`, `last_touch_at`, `last_channel`, `last_touch`, `came_from` | attribution |
| `persona`, `persona_role`, `persona_niche`, `persona_size` | persona |
| `refreshed_at` | last write |

`profile_site_reads`: per profile with a `visitor` key, page views and watch-page views (`/watch/`, `/v/`) counted from the lander's log: counts and first/last only, never the lines. Read by the refresh, at most 200 profiles a pass, oldest read first.

Traits mirrored: `stage` and `warmth`, only when not the default (absent means stranger and cold), so a Trait changed trigger hears "replied" or "warm".

Fixed lists: `STAGES`, `WARM_REASONS`, `PERSONA_ROLES` (owner, executive, manager, staff, unknown), `PERSONA_SIZES` (solo 1, small 2-9, mid 10-49, large 50+, unknown). Niche is `companies.niche`.

## For segments (built in parallel)

Read `profile_rollups` by `profile_id`. Every column above is plain: text keys, ints, timestamptz. Stage and warmth are also traits. No column holds JSON.

## Refresh

- `refreshPeople(db, {ids?})`: one set-based statement upserts every changed row; unchanged rows aren't written. Merged profiles lose their row.
- `PeopleMap/fleet` and `PeopleMap/<client>/fleet` (Restate objects, Segments' pattern): one pass on `wake`. `PeopleMapNet/all` wakes every workspace every 15 minutes. A pass: key loose handles, read site summaries (Wren's only), refresh, mirror traits.
- `wren people refresh` runs one pass by hand.

## Gap: handles with no key

`keyLooseHandles(db)`: every handle we touched or that touched us, from `social_handles`, `comments` authors, answered `reddit_threads`, commented `reach_posts` and `reach_contacts`, normalized, gets a `handle:<platform>` key through `resolveProfile` (with its person when the handle has one). Runs each pass; a handle already keyed is skipped.

Also fixed: a bare YouTube channel id (`UC...`) kept its case only from a URL, so the same channel keyed lowercase from text never matched its handle.

## Persona

Rules in SQL: role from the title (people row, else the `title` trait), niche from the company, size from the company row (`5A` employees, else `Company Size` / `agency.team_size`). A `persona_role` / `persona_niche` / `persona_size` trait wins over the rule (set by hand or by the model). `fillPersonas(db, model, {limit})` is the LLM hook: it asks a model for unknown roles from the title and headline and writes those traits. Never run on prod by this build.

## Warm gate

`coldOpenerRefusal(db, {personId, keys})` in core: null when cold, else "warm: replied 2x, last Oct 3". Live, never the rollup, so it's right at send time.

Wired: `leadRefusal` takes the contact's keys and calls it, so SMS enroll, DM enroll and People → DM refuse a warm person. Email: `sendDue` stops a warm opener's enrollment (`stopped_warm`), except the reactivation sequence, whose opener is written warm.

## CLI

`wren people show <who>`, `wren people list [--stage] [--warmth] [--persona] [--reason] [--subscribed] [--source] [--sort] [--limit] [--json]`, `wren people warm <who>`, `wren people refresh`, `wren people personas --model <m> [--limit] [--dry-run]`. `<who>` is an email, phone, `<platform>:<handle>` or profile id.

## Portal

People → People: columns name, stage, warmth, why, persona, last seen. Filters on stage, warmth, persona role, niche, size, first channel. Tabs: All, Warm, Replied, Booked, Clients (rest under More: Cold, Subscribed, With email, With phone, Merged). The person's page gets a Warmth section (stage, the line, each reason, subscriptions, first and last touch, persona) above the Timeline.

## Open calls (mine)

- A form, a site chat or a booking counts as a reply: they wrote to us.
- A comment on our post is `engaged`; a reply or a comment answering ours is `replied`.
- Our sends alone never make someone warm. An open or click on them does.
- Opens and clicks inside 2 minutes of sending are mail scanners, as the sent log counts them.
- Past client has no source yet; it's a mark (`lifecycle` trait) until CRM import can say it.
- Visit and watch counts are stored as counts only; the lines stay live reads (B7).
- Persona traits aren't mirrored: 106k trait rows for something segments can read from the table.
- The rollup runs every 15 minutes; the warm gate never waits for it.
